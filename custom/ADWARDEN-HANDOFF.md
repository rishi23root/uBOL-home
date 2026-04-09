# Ad Warden — handoff context for uBOL-home

Use this file when starting a new chat so implementation details stay consistent.

## Product behavior

- **Logged out (guest):** No uBlock Origin Lite blocking for end users.
- **Anonymous (Bearer via `register { identifier }`, no email):** Same as guest for uBO — `plan-ubo-gate.js` only restores filtering when **`auth.email`** is non-empty.
- **Logged in with email (any plan):** uBO filtering is automatically restored from backup (taken on logout), or defaults to level 3 (complete) if no backup exists. No manual “turn on” step needed.

## Core module: `custom/background/plan-ubo-gate.js`

- **`syncFromAuth(auth)`** — single entry; `auth` is `null` when logged out.
- **`enterTrialGlobalOff()`** — Always applies guest shape: `{ none: ['all-urls'], basic: [], optimal: [], complete: [] }` so per-host `complete` / `optimal` / `basic` rows cannot keep blocking after global `all-urls` is set to none (see `lookupFilteringMode` in `chromium/js/mode-manager.js`).
- Backup **only** when `!trialActive` (first transition): full graph in storage + optional numeric level; then `markTrialGating`. If `trialActive` already true, still **re-applies** guest modes (fixes drift and “reassert” after logout).
- **Storage keys (chrome.storage.local):** `adwarden_ubo_backup_all_urls_level`, `adwarden_ubo_backup_filtering_details`, `adwarden_trial_ubo_gate_active`.
- **Early boot:** IIFE calls `syncFromAuth(null)` when `authModule.getAuth()` has no token, so behavior does not wait only on `init.js` delay.

## Critical: service worker cannot `sendMessage` itself

`plan-ubo-gate.js` is imported into the **same** MV3 service worker as `background.js`.  
`chrome.runtime.sendMessage` from that worker **does not** hit `runtime.onMessage` in the same worker, so `what: 'setFilteringModeDetails'` used to no-op.

**Fix (must stay in sync):**

- **`chromium/js/background.js`** (end of file): exposes  
  `globalThis.adwardenUboGetFilteringModeDetails` and `globalThis.adwardenUboSetFilteringModeDetails`  
  — await `isFullyInitialized`, call `getFilteringModeDetails(true)` / `setFilteringModeDetails` + `registerInjectables()`.
- **`plan-ubo-gate.js`:** `getFilteringModeDetailsSerializable` / inner `setFilteringModeDetails` **prefer those globals**, fall back to `uboSend` for non-SW callers.

If you change one side, change the other. Rebuild the extension so `chromium/js/background.js` in the loaded package includes the globals.

**Still on `uboSend` only:** `getAllUrlsLevel` / `setAllUrlsLevel` — unreliable inside SW. Normal path uses serialized details + direct `setFilteringModeDetails`; legacy Pro restore without `backupDetails` may still be weak until those are bridged the same way.

## Auth integration: `custom/background/auth.js`

- **`notifyAuthChange`** is `async` and **awaits** `syncFromAuth` so logout/login waits for filtering updates before replying to popup.
- Logout / login / register paths await `notifyAuthChange`.
- 401 cleanup: `await notifyAuthChange(null)` after `clearAuth`.

## Init: `custom/background/init.js`

Import order (see `build-scripts/inject-background.js`):  
`ad-config` → `identity` → `auth` → **`plan-ubo-gate`** → `notifications` → `ad-manager` → **`visit-tracker`** → **`init`**.

`init` calls `syncFromAuth(auth || null)` after `validateToken()`.

## Build / copy pipeline

- **`build-scripts/inject-custom.js`** — copies `custom/*` into `custom-dist/chromium` / `custom-dist/firefox` `js/`.
- **`build-scripts/inject-background.js`** — prepends custom ESM imports into platform `background.js`.

After editing `custom/background/*.js` or `chromium/js/background.js`, run the project’s usual build/inject steps before loading unpacked in Chrome.

## Firefox

`firefox/js/background.js` is a different layout; it does **not** automatically get the Ad Warden `globalThis` hooks. If you ship Firefox, mirror the same two globals and init ordering there.

## Quick verification

1. No token: service worker console — guest apply should succeed; CNN (or test host) should not stay in “complete” in stored `filteringModeDetails`.
2. Pro → log out → guest shape reapplied; log in Pro → backup restored.
