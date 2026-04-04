/**
 * Popup-only env (loaded before popup-adwarden.js).
 * PAYMENT_PLANS_URL mirrors custom/config/config.js — keep both in sync or set at build time.
 */
(function () {
    'use strict';
    globalThis.ADWARDEN_POPUP = {
        PAYMENT_PLANS_URL: '',
    };
})();
