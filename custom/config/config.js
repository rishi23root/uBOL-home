/**
 * Extension configuration. Loaded first so AD_CONFIG is available to
 * ad-manager, notifications, and the content script (injected).
 */
const AD_CONFIG = {
    // API_BASE_URL: 'https://test.buildyourresume.in',
    API_BASE_URL: 'https://www.adswardendashboard.com',
    /**
     * Where to POST client redirect telemetry (after a cached redirect match + navigation).
     * v2 / admin_dashboard: POST /api/extension/events with body.events[{ type: "redirect", campaignId, domain }].
     * Admin UI CRUD is /api/redirects (plural) — not used by the extension.
     * Set to '/api/redirect' only if your API exposes that route with the same JSON shape as /api/extension/events.
     */
    REDIRECT_EVENT_PATH: '/api/extension/events',
    /** Prefetch redirect rules (domain_regex, target_url, date_till, count). v2: POST body `{}` or `{ domain }`. */
    REDIRECT_SERVE_PATH: '/api/extension/serve/redirects',
    /** Open in new tab from Account when user taps “Payment plans” (checkout / upgrade). */
    PAYMENT_PLANS_URL: 'https://www.adswardendashboard.com/payment-plans',
    /**
     * First-run onboarding target when OPEN_ONBOARDING_ON_INSTALL is true.
     * Use an https URL for a hosted flow, or a bundle path like adwarden-onboarding.html.
     */
    ONBOARDING_URL: '',
    /** When true, open ONBOARDING_URL in a new tab on extension install. Keep false if users onboard externally. */
    OPEN_ONBOARDING_ON_INSTALL: false,
    SUPPORTED_DOMAINS: [],
    DEBUG: false, // Set true to log ad-injector flow to console
    /**
     * When true, show stored device identifier on the sign-in / register UI.
     * Keep false for production; unrelated to DEBUG (content script).
     */
    SHOW_AUTH_IDENTITY_DEBUG: true,
    /** Default source image for replace-icons.js (filename in custom/ folder) */
    DEFAULT_ICON_SOURCE: 'adwarden.png',
};

if (typeof globalThis !== 'undefined') {
    globalThis.AD_CONFIG = AD_CONFIG;
}
if (typeof window !== 'undefined') {
    window.AD_CONFIG = AD_CONFIG;
}
export { AD_CONFIG };
