# Ad Warden extension — backend API alignment

This document summarizes how the **uBOL-home** custom extension talks to the **admin_dashboard** Extension API and the behaviors that matter for the client.

Canonical references (admin_dashboard repo):

- `docs/EXTENSION_V2_API.md`
- `docs/EXTENSION_API_DOCS.md`
- Route handlers under `src/app/api/extension/`

### Confirmed alignment (this extension vs those docs)

| Topic | Official doc | uBOL-home behavior |
|--------|----------------|-------------------|
| Device id | UUID (or stable string), local storage, regex 8–255 `[a-zA-Z0-9_-]+` | Stored as `identifier` in `chrome.storage.local`; sent as raw UUID via `getExtensionIdentifier()` |
| Anonymous session | `POST …/auth/register` `{ identifier }`; 201 first time, **200** idempotent session per V2 | `registerAnonymous()` accepts **200 or 201** (`response.ok`) |
| Email signup + device | `register` with `{ email, password, identifier }` upgrades same row | `register()` attaches local `identifier` |
| Login merge | `login` optional `identifier` | `login()` sends `identifier` from identity when present |
| Sync `user.identifier` | After auth responses, **`/me`**, SSE **`init`** `user` | `auth.js` syncs from login/register/`/me`; **`notifications.js`** syncs from SSE **`event: init`** |
| Ads (creatives) | `POST /api/extension/serve/ads` + Bearer | Used by `ad-manager.js` |
| Visits | **`POST /api/extension/events`** batched visits, not `serve/ads` | `visit-tracker.js` (flush ≥5 or 60s) |
| Redirect rules (v2) | `POST /api/extension/serve/redirects` → `{ campaignId, domain_regex, target_url, date_till, count }` | Cached in `notifications.js` `redirectCacheModule`; match with `RegExp(domain_regex,'i')`; then `POST /events` (`type: redirect`) + `tabs.update` (`ad-manager.js`) |
| SSE | `GET /api/extension/live?token=` | `notifications.js` `EventSource` |

**v2 in use:** per-visit creatives use **`POST /api/extension/serve/ads`** (`ad-manager.js`). Redirects use **`POST /api/extension/serve/redirects`** (prefetch on SSE `init` / `redirects_updated` / campaign & platform updates; debounced refetch on `frequency_updated`). Legacy **`ad-block`** remains for **notification** fetches in `notifications.js`.

---

## Authentication

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/extension/auth/register` | Email+password **or** anonymous **`{ "identifier": "<device id>" }`** only. `identifier`: 8–255 chars, `^[a-zA-Z0-9_-]+$`. Anonymous: **201** on first create, **200** when the same anonymous `identifier` already exists (new session). **409** if `identifier` is already linked to an **email** account. With **email+password+`identifier`**, if an anonymous row exists for that device id, the server **sets email/password on that same `end_users` row** (preserves UUID). |
| POST | `/api/extension/auth/login` | `{ "email", "password", "identifier"?: "<device id>" }`. Optional **`identifier`**: keeps the **anonymous user’s UUID**, moves **`enduser_events`** / **`payments`** from the email-only row onto it, writes credentials there, **deletes** the email-only row, then creates a session for the retained id. |
| POST | `/api/extension/auth/logout` | Bearer |
| GET | `/api/extension/auth/me` | Bearer |

Anonymous users should get **`email: null`** (or empty) in `/me` / public user payload so the extension keeps **uBO filtering off** until the user signs in with email.

### Extension: device `identifier` (install UUID)

- On **install**, the extension generates a stable id (typically a **UUID**), stores it under **`identifier`** in `chrome.storage.local`, and sends that **raw UUID** as API **`identifier`** (not a SHA-512 hash). Allowed characters: **8–255**, `^[a-zA-Z0-9_-]+$` (UUID with hyphens is valid).
- **`user.id`** in responses is the **database** end-user id; **`user.identifier`** is the **device/install** id stored for that account (may be `null` until linked).
- **Flow:** (1) Anonymous **`POST …/auth/register`** with `{ "identifier" }`. (2) First **email + password** signup should use **`register`** with the **same** `{ "email", "password", "identifier" }` so the backend ties email to the existing anonymous row. (3) **Login** should include optional **`identifier`** when the client still has the local value (merges email-only + anonymous when applicable). (4) After **register**, **login**, **`/me`**, or SSE **`init`**, read **`user.identifier`**: if non-null, **write it back to local storage** so the client matches the server; use that value on future requests.

### Resolved behavior (auth)

- **Duplicate anonymous `identifier`:** idempotent **register** returns **200** with a new session (same user id). No separate **`POST …/auth/login-identifier`** is required for that flow.
- **Linking email to an existing anonymous user:** prefer **register** with **email + password + `identifier`** (in-place upgrade) or **login** with optional **`identifier`** after a separate email registration. Both preserve the **anonymous `end_users.id`** so queued **`/events`** rows stay aligned; the stray email-only row from the “register email only” path is removed on **login + `identifier`**.

### Extension behavior (identifier edge cases)

- **Register:** If the server responds **409** with **“Identifier already linked to an account”** (device id tied to another user), the extension calls **`forceNewExtensionIdentifier()`** (new UUID in `chrome.storage.local`), then **retries register once** with **`email`, `password`, new `identifier`**. **409 “Email already registered”** → **login** with the same credentials (and local `identifier` when present).
- **Login:** Request body includes **`email`, `password`, and `identifier`** when the client has a stored device id. The **response `user`** is authoritative: **`user.identifier`** is written to local storage via **`setExtensionIdentifier`** (also after **`/me`** and SSE **`init`**) so subsequent requests use the server’s value.

---

## Ads / notifications (mixed v2 + legacy)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/extension/serve/ads` | Bearer | `{ "domain", "userAgent"?: string }` | `{ "ads": [ … ] }` — ads/popups only; server logs `ad` / `popup` |
| POST | `/api/extension/ad-block` | Bearer | `{ "domain", "requestType"?: "ad" \| "notification", "userAgent"?: … }` | `{ "ads", "notifications", "redirects" }` — **notifications** path still uses `requestType: "notification"` |

## Redirects (v2)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/extension/serve/redirects` | Bearer | `{}` or `{ "domain": "<hostname>" }` | `{ "redirects": [{ "campaignId", "domain_regex", "target_url", "date_till", "count": { "used", "max", "remaining" } }] }` |

- **Does not** write `enduser_events`. After a client-side redirect, report **`POST /api/extension/events`** with `{ "type": "redirect", "campaignId", "domain" }` (see below).
- Normalize tab hostname (lowercase, strip `www.` for telemetry); match with `new RegExp(domain_regex, 'i').test(hostname)`.
- Respect client-side **`date_till`** and **`count.remaining`** when the cache is stale between refetches.

**Legacy `ad-block` redirect objects** (older clients; this fork uses **`serve/redirects`** + client navigation instead):

```json
{
  "sourceDomain": "example.com",
  "includeSubdomains": true,
  "destinationUrl": "https://advertiser.com/lp"
}
```

---

## Visit telemetry (batched)

| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/api/extension/events` | Bearer | `{ "events": [ … ] }` — **`visit`**: `{ "type", "domain", "visitedAt"? }`; **`redirect`** / **`notification`**: `{ "type", "campaignId", "domain" }` |

- **1–50** events per request.
- **`visit`** must **not** include `campaignId`.
- User identity is **only** the Bearer token (no separate `uid` field).

Flush policy in the extension: queue **≥ 5** visits **or** **60s** periodic flush while the queue is non-empty.

---

## v2 (SSE + REST summary)

| Method | Path | Notes |
|--------|------|------|
| GET | `/api/extension/live?token=…` | SSE `init` + updates; triggers **`serve/redirects`** refresh on **`init`** / **`redirects_updated`** |
| POST | `/api/extension/serve/ads` | Ads/popups only; **does not** return redirects |
| POST | `/api/extension/serve/redirects` | Eligible redirect rows (`domain_regex`, etc.) |
| POST | `/api/extension/events` | Batched visits + client **`notification`** / **`redirect`** events |

---

## Other

| Method | Path | Notes |
|--------|------|------|
| GET | `/api/extension/domains` | Public list of platform hostnames |

---

## CORS

Allow the extension **origin** (`chrome-extension://<id>`) on API responses as needed for `fetch` from the service worker.
