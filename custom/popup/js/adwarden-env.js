/**
 * Popup-only env (loaded before popup-adwarden.js).
 * Payment URL comes from AD_CONFIG (custom/config/config.js → js/ad-config.js) via import in popup-adwarden.js.
 * Set PAYMENT_PLANS_URL here only if you need a popup-specific override (non-empty replaces config).
 */
(function () {
    
    globalThis.ADWARDEN_POPUP = {};
})();
