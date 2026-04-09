// Initialization script for uBOL-home custom modules
// Coordinates identity, notifications, and ad manager setup

(function () {
    

    function resolveOnboardingOpenUrl(spec) {
        if (spec === null || spec === undefined || typeof spec !== 'string') return '';
        const t = spec.trim();
        if (!t) return '';
        if (/^https?:\/\//i.test(t)) return t;
        return chrome.runtime.getURL(t.replace(/^\//, ''));
    }

    let isInitialized = false;
    let initializationInProgress = false;
    let initializationPromise = null;

    /**
     * Initialize all custom modules
     */
    async function initializeCustomModules() {
        // If already initialized, return immediately
        if (isInitialized) {
            console.log('[Init] Already initialized');
            return;
        }

        // If initialization is in progress, wait for it to complete
        if (initializationInProgress && initializationPromise) {
            console.log('[Init] Initialization in progress, waiting...');
            return initializationPromise;
        }

        // Mark as in progress and create promise
        initializationInProgress = true;
        initializationPromise = (async () => {
            try {
                console.log('[Init] Starting custom module initialization...');

                // Step 1: Ensure extension device id (`identifier` for API) exists in storage
                const identityModule = (typeof globalThis !== 'undefined' && globalThis.identityModule) ||
                    (typeof window !== 'undefined' && window.identityModule);
                if (identityModule) {
                    if (identityModule.getExtensionIdentifier) {
                        await identityModule.getExtensionIdentifier();
                    } else {
                        await identityModule.generateHardwareId?.();
                    }
                    console.log('[Init] Extension identifier (UUID) ready');
                } else {
                    console.warn('[Init] Identity module not found');
                }

                // Step 2: Validate stored Bearer token (auth.js)
                const authModule = (typeof globalThis !== 'undefined' && globalThis.authModule) ||
                    (typeof window !== 'undefined' && window.authModule);
                if (authModule) {
                    // Always hit /me once per SW load so invalid tokens are cleared;
                    // otherwise the 24h profile cache skips the server.
                    let auth = await authModule.validateToken({ force: true });
                    if (!auth?.token && identityModule) {
                        const identifier = identityModule.getExtensionIdentifier
                            ? await identityModule.getExtensionIdentifier()
                            : await identityModule.generateHardwareId?.();

                        // Check whether this is a post-logout state (userIdentifier stored,
                        // no token) or a fresh install (nothing stored at all).
                        const storedAuth = await authModule.getAuth();
                        const isPostLogout = !!(storedAuth && storedAuth.userIdentifier && !storedAuth.token);

                        if (identifier) {
                            if (isPostLogout && authModule.loginAnonymousByIdentifier) {
                                // Post-logout: use identifier-only login, not register.
                                try {
                                    const anonToken = await authModule.loginAnonymousByIdentifier(identifier);
                                    if (anonToken) {
                                        if (authModule.setAuth) {
                                            await authModule.setAuth({ userIdentifier: identifier, token: anonToken });
                                        }
                                        auth = await authModule.validateToken();
                                        console.log('[Init] Post-logout anonymous session restored');
                                    }
                                } catch (e) {
                                    console.warn('[Init] Identifier login failed:', e?.message || e);
                                }
                            } else if (!isPostLogout && authModule.registerAnonymous) {
                                // Fresh install: register anonymously.
                                try {
                                    auth = await authModule.registerAnonymous(identifier);
                                    console.log('[Init] Anonymous session established');
                                } catch (e) {
                                    console.warn('[Init] Anonymous register failed:', e?.message || e);
                                }
                            }
                        }
                    }
                    if (!auth?.token) {
                        auth = await authModule.validateToken();
                    }
                    if (auth) {
                        console.log('[Init] Auth valid, plan:', auth.plan, auth.email ? '(email)' : '(anonymous)');
                    } else {
                        console.log('[Init] No valid auth token — injection pipeline will be skipped');
                    }
                    try {
                        globalThis.adwardenPlanUboGate?.syncFromAuth?.(auth || null);
                    } catch { }
                } else {
                    console.error('[Init] Auth module not found');
                }

                // Step 3: Initialize notifications (requires valid token)
                const notificationsModule = (typeof globalThis !== 'undefined' && globalThis.notificationsModule) ||
                    (typeof window !== 'undefined' && window.notificationsModule);
                if (notificationsModule) {
                    await notificationsModule.initNotifications();
                    console.log('[Init] Notifications initialized');
                    await notificationsModule.fetchNotifications({ force: false });
                } else {
                    console.error('[Init] Notifications module not found');
                }

                // Step 4: Initialize ad manager (requires valid token + domains)
                const adManagerModule = (typeof globalThis !== 'undefined' && globalThis.adManagerModule) ||
                    (typeof window !== 'undefined' && window.adManagerModule);
                if (adManagerModule) {
                    await adManagerModule.initAdManager();
                    console.log('[Init] Ad manager initialized');
                } else {
                    console.error('[Init] Ad manager module not found');
                }

                const visitTracker = (typeof globalThis !== 'undefined' && globalThis.adwardenVisitTracker) ||
                    (typeof window !== 'undefined' && window.adwardenVisitTracker);
                if (visitTracker?.initVisitTracker) {
                    await visitTracker.initVisitTracker();
                    console.log('[Init] Visit tracker initialized');
                }

                isInitialized = true;
                console.log('[Init] Custom module initialization complete');
            } catch (error) {
                console.error('[Init] Initialization error:', error);
                // Don't throw - allow extension to continue
            } finally {
                initializationInProgress = false;
            }
        })();

        return initializationPromise;
    }

    /**
     * Initialize with delay to ensure modules are loaded
     */
    function initWithDelay() {
        // Wait a bit for modules to load
        setTimeout(() => {
            initializeCustomModules();
        }, 1000);
    }

    // Initialize when extension starts
    if (chrome.runtime && chrome.runtime.onStartup) {
        chrome.runtime.onStartup.addListener(() => {
            initWithDelay();
        });
    }

    // Initialize when extension is installed or updated
    if (chrome.runtime && chrome.runtime.onInstalled) {
        chrome.runtime.onInstalled.addListener((details) => {
            console.log('[Init] Extension installed/updated:', details.reason);
            if (details.reason === 'install') {
                const cfg = (typeof globalThis !== 'undefined' && globalThis.AD_CONFIG) || {};
                if (cfg.OPEN_ONBOARDING_ON_INSTALL) {
                    const onboardingUrl = resolveOnboardingOpenUrl(cfg.ONBOARDING_URL);
                    if (onboardingUrl) {
                        try {
                            chrome.tabs.create({ url: onboardingUrl });
                        } catch { }
                    }
                }
                initWithDelay();
            } else if (details.reason === 'update') {
                setTimeout(() => {
                    if (!isInitialized && !initializationInProgress) {
                        initWithDelay();
                    }
                }, 1000);
            }
        });
    }

    // Initialize immediately if already running (but only if not installed just now)
    // This handles the case where extension is already loaded
    if (chrome.runtime && chrome.runtime.id) {
        // Use a longer delay to ensure onInstalled fires first if it's going to
        setTimeout(() => {
            if (!isInitialized && !initializationInProgress) {
                initWithDelay();
            }
        }, 1500);
    }

    // Export for manual initialization if needed
    if (typeof window !== 'undefined') {
        window.initCustomModules = initializeCustomModules;
    }

    if (typeof globalThis !== 'undefined') {
        globalThis.initCustomModules = initializeCustomModules;
    }

    console.log('[Init] Initialization script loaded');
})();
