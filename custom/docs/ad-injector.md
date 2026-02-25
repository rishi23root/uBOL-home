# ad-injector.js (content script)

**Path:** custom/content/ad-injector.js

## Purpose

Runs on supported web pages. Requests ads from the background and injects HTML ads directly into document.body. Supports popup modal or inline injection.

## How it works

### Ads request

- requestAds() sends GET_ADS with current domain; receives ads; normalizes each ad with normalizeAd() (html, htmlCode, displayAs, type). Retries once after 600 ms if first response has no ads.

### Injection

- showHtmlAdModal(ads): For popup HTML ads (displayAs/type === 'popup'), shows modal iframe.
- injectHtmlAdIntoBody(ads): For inline HTML ads, appends wrapper divs to body.

### Scan and lifecycle

- scanAndInject(): HTML ads path: popup first, then inline. cleanup() removes all injected containers. MutationObserver for SPA navigation and re-scan (debounced); skips mutations from our own nodes.

## API requirements

Ads must include `html` or `htmlCode` for injection. Ads without HTML are ignored.

## Placement

HTML ads are appended as wrapper divs to document.body or shown in a modal (popup).

## Custom HTML guidelines (avoid cosmetic filter conflicts)

uBOL's cosmetic filters hide elements matching ad-blocking selectors (e.g. `##.ad`, `##.banner`, `##.ad-container`). To prevent your injected content from being hidden:

**Avoid these class names and IDs in API-returned HTML:**
- `ad`, `ads`, `advertisement`, `ad-container`, `ad-wrapper`, `ad-block`
- `banner`, `banner-ad`, `bannerad`
- `sponsored`, `promo`, `promotion`
- Common filter-list patterns: `id="ad"`, `class="ad"`, etc.

**Display mode:** API HTML is injected directly into the body with no wrapper div. The API response should provide self-contained HTML ready for injection.

**Automatic sanitization:** Before injection, `sanitizeAdLikeSelectors()` rewrites ad-like class and id attributes (e.g. `ad` -> `aw-c`, `banner` -> `aw-bn`) to reduce cosmetic filter conflicts.

**Inline direct injection:** Inline (display mode) ads are injected directly into the page body as HTML, not inside an iframe. Popup ads remain in an iframe for isolation.
