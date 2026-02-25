# uBlock Origin Lite: Permissions & Filtering Levels

## Filtering levels (0–3)

| Level | Name     | What it does | Permissions needed |
|-------|----------|---------------|--------------------|
| 0     | None     | No blocking   | None               |
| 1     | Basic    | Network blocking only (DNR) | **None** – no host permission |
| 2     | Optimal  | Network + specific cosmetic/scriptlets | Host permission for site |
| 3     | Complete | Network + specific + generic cosmetic/scriptlets | Host permission for site |

## Platform permission model

### Chromium (Chrome, Edge)

- **Manifest:** `host_permissions: ["<all_urls>"]` – full host access at install
- **Effect:** Extension has permission for all sites from install; no runtime prompts

### Firefox (Ad Warden custom build)

- **Manifest:** `host_permissions: ["<all_urls>"]` – full host access at install (patched by merge-manifest.js)
- **Effect:** Extension requests full host permission at install; no runtime prompts
- **Build:** merge-manifest.js moves `<all_urls>` from optional_permissions to host_permissions

## Flow when switching 0 → 3 (popup-adwarden.js)

1. `newLevel > 1 && beforeLevel <= 1` → request permission for `*://*.${hostname}/*`
2. If `granted === false` → fall back to `beforeLevel` (0), never call `setFilteringMode(3)`
3. If granted → call `setFilteringMode(hostname, 3)`
4. Background: `applyFilteringMode` adds hostname to `complete` set
5. Background: `registerInjectables()` re-registers content scripts with new matches
6. Scripting manager: registers generic/specific scriptlets and cosmetic filters for `complete` hostnames

## Why level 3 might fail when switching from 0

### 1. Permission denied or error

- `browser.permissions.request()` can return `false` if the user denies or cancels
- On Chromium, `request()` can reject if the extension is in a restricted state
- If `granted` is false, `newLevel` is reset to `beforeLevel` (0), so `setFilteringMode(3)` is never called

### 2. Bare domain vs `*.hostname`

- Pattern used: `*://*.${hostname}/*` (e.g. `*://*.yahoo.com/*`)
- For `https://yahoo.com` (no subdomain), `*.yahoo.com` should match `yahoo.com` per Chrome/MDN docs
- If there’s a browser-specific mismatch, the permission might not cover the current tab

### 3. Race: permission listener vs popup

- `permissions.onAdded` fires when the user grants
- Background uses `onPermissionGrantedThruExtension` with `pendingPermissionRequest`
- If `setPendingFilteringMode` is not sent before the permission request, the background may not have the correct hostname/level

### 4. Firefox-specific: syncWithBrowserPermissions

- When permissions change, `syncWithBrowserPermissions` runs
- If `allowedHostnames.has(hn)` is false for a hostname in `complete`, it is removed

## Option: avoid permission prompts by using level 1

**Level 1 (basic)** does not require any host permission:

- Uses only declarativeNetRequest (network blocking)
- No cosmetic filters, no scriptlets
- No host permission prompt

**Tradeoff:** fewer things blocked (no cosmetic/scriptlet filtering).

## Relevant code locations

| File | Purpose |
|------|---------|
| `custom/popup/js/popup-adwarden.js` | `setFilteringLevel`, `onToggleClick` – permission request and level change |
| `chromium/js/popup.js` | `commitFilteringMode` – uBlock’s permission handling |
| `chromium/js/mode-manager.js` | `applyFilteringMode`, `syncWithBrowserPermissions` |
| `chromium/js/scripting-manager.js` | `registerInjectables`, `registerGeneric`, `registerScriptlet` |
| `chromium/js/utils.js` | `matchFromHostname` → `*://*.${hn}/*`, `hostnamesFromMatches` |
| `chromium/manifest.json` | `host_permissions: ["<all_urls>"]` |
| `firefox/manifest.json` | `optional_permissions: ["<all_urls>"]` – no host_permissions by default |

## Suggested next steps

1. **Debug:** Add `console.log` in `setFilteringLevel` to log `granted` and `newLevel` after the permission request.
2. **Test:** Try 0 → 3 on both Chromium and Firefox and note whether a permission prompt appears.
3. **Bare domain:** If `*.example.com` fails for `example.com`, consider requesting both `*://*.example.com/*` and `*://example.com/*`.
4. **Permission-free:** If you want to avoid prompts, switch to level 1 when turning ON instead of level 3.
