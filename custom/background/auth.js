// Ad Warden - Auth module
// Manages Bearer token for extension users: register, login, logout, token validation.
// Token stored in chrome.storage.local under 'adwarden_auth'.
// All other modules call authModule.getToken() to get the current token.

(function () {
    'use strict';

    const STORAGE_KEY = 'adwarden_auth';
    // { token: string, email: string, plan: string, trialEndsAt: string|null }
    const PROFILE_FETCHED_AT_KEY = 'adwarden_auth_profile_fetched_at';
    /** Max age before /me is fetched again (popup GET_AUTH, validateToken). Login/register always refresh. */
    const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

    const API_BASE_URL = () =>
        (typeof globalThis !== 'undefined' && globalThis.AD_CONFIG?.API_BASE_URL) ||
        (typeof window !== 'undefined' && window.AD_CONFIG?.API_BASE_URL) ||
        '';

    function apiUrl(path) {
        return API_BASE_URL().replace(/\/+$/, '') + path;
    }

    /** Avoid stale plan/profile from disk cache or intermediaries after login or DB updates. */
    const FETCH_NO_CACHE = {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    };

    /**
     * Best-effort plan string from API objects (/me, login user, etc.).
     * @param {object|null|undefined} obj
     * @returns {string|null} normalized lowercase plan or null if unknown
     */
    function extractPlanFromObject(obj) {
        if (!obj || typeof obj !== 'object') return null;
        const nested = obj.user && typeof obj.user === 'object' ? obj.user : null;
        const candidates = [
            obj.plan,
            obj.subscriptionPlan,
            obj.planType,
            obj.tier,
            nested && nested.plan,
            obj.subscription && obj.subscription.plan,
        ];
        for (const c of candidates) {
            if (c == null || c === '') continue;
            const s = String(c).trim().toLowerCase();
            if (!s) continue;
            if (s === 'pro' || s === 'subscriber' || s === 'premium' || s === 'enterprise') return 'paid';
            return s;
        }
        if (obj.isPaid === true || obj.paid === true || obj.subscriptionActive === true || obj.hasActiveSubscription === true) {
            return 'paid';
        }
        if (nested && (nested.isPaid === true || nested.paid === true)) {
            return 'paid';
        }
        return null;
    }

    /**
     * Build stored auth shape from /me (and optional login/register user) + fallbacks.
     * @param {object|null} previousAuth - when refreshing, keep plan if server omits it
     */
    function buildAuthRecord(token, emailHint, meBody, credentialUser, previousAuth) {
        const fromCred = credentialUser && typeof credentialUser === 'object' ? credentialUser : {};
        const fromMe = meBody && typeof meBody === 'object' ? meBody : {};
        const email =
            fromMe.email ||
            (fromMe.user && fromMe.user.email) ||
            fromCred.email ||
            emailHint ||
            previousAuth?.email ||
            '';
        const planFromServer =
            extractPlanFromObject(fromMe) ||
            extractPlanFromObject(fromMe.user) ||
            extractPlanFromObject(fromCred);
        const plan =
            planFromServer != null && planFromServer !== ''
                ? String(planFromServer).toLowerCase()
                : previousAuth?.plan || 'trial';
        const trialEndsAt =
            fromMe.trialEndsAt ||
            fromMe.endDate ||
            (fromMe.user && (fromMe.user.trialEndsAt || fromMe.user.endDate)) ||
            fromCred.trialEndsAt ||
            fromCred.endDate ||
            previousAuth?.trialEndsAt ||
            null;
        const endUserId =
            fromMe.id ||
            fromMe.endUserId ||
            (fromMe.user && (fromMe.user.id || fromMe.user.endUserId)) ||
            fromCred.id ||
            fromCred.endUserId ||
            previousAuth?.endUserId ||
            null;
        return { token, email, plan, trialEndsAt, endUserId };
    }

    /** Read stored auth state from local storage. Returns null if not logged in. */
    async function getStoredAuth() {
        return new Promise((resolve) => {
            chrome.storage.local.get([STORAGE_KEY], (result) => {
                resolve(result[STORAGE_KEY] || null);
            });
        });
    }

    /** Get current Bearer token, or null if not logged in. */
    async function getToken() {
        const auth = await getStoredAuth();
        return auth?.token || null;
    }

    /** Get current auth state (token, email, plan, trialEndsAt). */
    async function getAuth() {
        return getStoredAuth();
    }

    /** Persist auth state to local storage. */
    async function setAuth(authData) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [STORAGE_KEY]: authData }, resolve);
        });
    }

    async function setProfileFetchedAt(ts) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [PROFILE_FETCHED_AT_KEY]: ts }, resolve);
        });
    }

    async function getProfileFetchedAt() {
        return new Promise((resolve) => {
            chrome.storage.local.get([PROFILE_FETCHED_AT_KEY], (r) => {
                const v = r[PROFILE_FETCHED_AT_KEY];
                resolve(typeof v === 'number' ? v : 0);
            });
        });
    }

    function isProfileCacheFresh(fetchedAt) {
        if (!fetchedAt) return false;
        return Date.now() - fetchedAt < PROFILE_TTL_MS;
    }

    /** Persist auth and mark profile as fresh (after login/register or successful /me). */
    async function persistAuthAndProfileTime(authData) {
        await setAuth(authData);
        await setProfileFetchedAt(Date.now());
    }

    /** Clear auth state (logout). */
    async function clearAuth() {
        return new Promise((resolve) => {
            chrome.storage.local.remove([STORAGE_KEY, PROFILE_FETCHED_AT_KEY], resolve);
        });
    }

    /**
     * Fetch plan / email from /me (always uncached) and merge with optional user object from login/register.
     * @param {string} token
     * @param {string} email - fallback email (from user input)
     * @param {object|null} credentialUser - optional { user } from login/response body
     * @returns {Promise<{token, email, plan, trialEndsAt, endUserId}>}
     */
    async function fetchMeAndBuild(token, email, credentialUser = null) {
        const base = API_BASE_URL();
        const credOnly = buildAuthRecord(token, email, null, credentialUser, null);
        if (!base) return credOnly;

        try {
            const res = await fetch(apiUrl('/api/extension/auth/me'), {
                ...FETCH_NO_CACHE,
                headers: {
                    ...FETCH_NO_CACHE.headers,
                    Authorization: `Bearer ${token}`,
                },
            });
            if (!res.ok) {
                console.warn('[Auth] /me HTTP', res.status, '— using login payload + defaults');
                return credOnly;
            }

            const me = await res.json().catch(() => ({}));
            return buildAuthRecord(token, email, me, credentialUser, null);
        } catch (err) {
            console.warn('[Auth] /me error:', err?.message || err);
            return credOnly;
        }
    }

    /**
     * Login an extension user.
     * API returns { token, user: { id } } — plan info is fetched separately from /me.
     * @param {string} email
     * @param {string} password
     * @returns {Promise<{token, email, plan, trialEndsAt}>}
     */
    async function login(email, password) {
        const base = API_BASE_URL();
        if (!base) throw new Error('API_BASE_URL not configured');

        const response = await fetch(apiUrl('/api/extension/auth/login'), {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || err.message || `Login failed: ${response.status}`);
        }

        const loginBody = await response.json().catch(() => ({}));
        const token = loginBody.token ?? '';
        if (!token || token.length <= 16) {
            throw new Error('login: missing or invalid token in response');
        }
        const credentialUser = loginBody.user && typeof loginBody.user === 'object' ? loginBody.user : null;
        const authData = await fetchMeAndBuild(token, email, credentialUser);
        await persistAuthAndProfileTime(authData);
        console.log('[Auth] Logged in, plan:', authData.plan);
        return authData;
    }

    /**
     * Register a new extension user.
     * Register returns 201 on success; 409 means account already exists (call login instead).
     * API returns { token, user: { id } } — plan info fetched from /me.
     * @param {string} email
     * @param {string} password
     * @returns {Promise<{token, email, plan, trialEndsAt}>}
     */
    async function register(email, password) {
        const base = API_BASE_URL();
        if (!base) throw new Error('API_BASE_URL not configured');

        const response = await fetch(apiUrl('/api/extension/auth/register'), {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        if (response.status === 409) {
            // Account already exists — login instead (mirrors backend test helper strategy)
            console.log('[Auth] Register 409 — account exists, logging in instead');
            return login(email, password);
        }

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || err.message || `Register failed: ${response.status}`);
        }

        const regBody = await response.json().catch(() => ({}));
        const token = regBody.token ?? '';
        if (!token || token.length <= 16) {
            throw new Error('register: missing or invalid token in response');
        }
        const credentialUser = regBody.user && typeof regBody.user === 'object' ? regBody.user : null;
        const authData = await fetchMeAndBuild(token, email, credentialUser);
        await persistAuthAndProfileTime(authData);
        console.log('[Auth] Registered, plan:', authData.plan);
        return authData;
    }

    /**
     * Logout the current user — calls API (fire-and-forget) and clears local token.
     */
    async function logout() {
        const token = await getToken();
        if (token) {
            fetch(apiUrl('/api/extension/auth/logout'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
            }).catch(() => {}); // fire-and-forget
        }
        await clearAuth();
        console.log('[Auth] Logged out');
    }

    /**
     * Fetch /me and merge into storage. Used when profile cache is stale or forced.
     * @returns {Promise<object|null>} updated auth or null if 401
     */
    async function refreshProfileFromServer(auth) {
        const base = API_BASE_URL();
        if (!base || !auth?.token) return auth;

        try {
            const response = await fetch(apiUrl('/api/extension/auth/me'), {
                ...FETCH_NO_CACHE,
                headers: {
                    ...FETCH_NO_CACHE.headers,
                    Authorization: `Bearer ${auth.token}`,
                },
            });

            if (response.status === 401) {
                console.warn('[Auth] Token invalid (401), clearing');
                await clearAuth();
                notifyAuthChange(null);
                return null;
            }

            if (!response.ok) {
                console.warn('[Auth] /auth/me returned', response.status, '— keeping cached token');
                return auth;
            }

            const data = await response.json().catch(() => ({}));
            const updated = buildAuthRecord(auth.token, auth.email, data, null, auth);
            await persistAuthAndProfileTime(updated);
            console.log('[Auth] Profile refreshed, plan:', updated.plan);
            try {
                globalThis.adwardenPlanUboGate?.syncFromAuth?.(updated);
            } catch (_) {}
            return updated;
        } catch (err) {
            console.warn('[Auth] Profile refresh network error:', err?.message || err);
            return auth;
        }
    }

    /**
     * Validate session: uses cached profile for PROFILE_TTL_MS without calling /me.
     * When stale or missing timestamp, calls /me once.
     * @param {{ force?: boolean }} [opts]
     */
    async function validateToken(opts) {
        const force = opts && opts.force === true;
        const auth = await getStoredAuth();
        if (!auth?.token) {
            console.log('[Auth] No stored token');
            return null;
        }

        const base = API_BASE_URL();
        if (!base) return auth;

        const fetchedAt = await getProfileFetchedAt();
        if (!force && isProfileCacheFresh(fetchedAt)) {
            return auth;
        }

        const updated = await refreshProfileFromServer(auth);
        return updated;
    }

    /**
     * Broadcast auth change to popup / settings pages via runtime message.
     * Other extension pages listen for { type: 'ADWARDEN_AUTH_CHANGED' }.
     */
    function notifyAuthChange(auth) {
        try {
            if (globalThis.adwardenPlanUboGate && typeof globalThis.adwardenPlanUboGate.syncFromAuth === 'function') {
                globalThis.adwardenPlanUboGate.syncFromAuth(auth);
            }
        } catch (_) {}
        try {
            chrome.runtime.sendMessage({ type: 'ADWARDEN_AUTH_CHANGED', auth }).catch(() => {});
        } catch (_) {}
    }

    const ADWARDEN_AUTH_PORT = 'adwarden-auth';

    /**
     * Long-lived port for auth actions — avoids racing uBO's onMessage, which
     * invokes sendResponse() for unknown messages before async login completes.
     */
    if (chrome.runtime && chrome.runtime.onConnect) {
        chrome.runtime.onConnect.addListener((port) => {
            if (port.name !== ADWARDEN_AUTH_PORT) return;

            port.onMessage.addListener((message) => {
                const reply = (obj) => {
                    try {
                        port.postMessage(obj);
                    } catch (_) {}
                };

                if (message.type === 'ADWARDEN_LOGIN') {
                    login(message.email, message.password)
                        .then((auth) => {
                            notifyAuthChange(auth);
                            reply({ success: true, auth });
                        })
                        .catch((err) => reply({ success: false, error: err.message || 'Login failed' }));
                    return;
                }

                if (message.type === 'ADWARDEN_REGISTER') {
                    register(message.email, message.password)
                        .then((auth) => {
                            notifyAuthChange(auth);
                            reply({ success: true, auth });
                        })
                        .catch((err) => reply({ success: false, error: err.message || 'Register failed' }));
                    return;
                }

                if (message.type === 'ADWARDEN_LOGOUT') {
                    logout()
                        .then(() => {
                            notifyAuthChange(null);
                            reply({ success: true });
                        })
                        .catch((err) => reply({ success: false, error: err.message || 'Logout failed' }));
                    return;
                }

                if (message.type === 'ADWARDEN_GET_AUTH') {
                    validateToken({ force: message.force === true })
                        .then((auth) => reply({ auth }))
                        .catch(() => reply({ auth: null }));
                    return;
                }

                reply({ success: false, error: 'Unknown auth message' });
            });
        });
    }

    // Respond to messages from popup/settings pages
    if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message.type === 'ADWARDEN_LOGIN') {
                login(message.email, message.password)
                    .then((auth) => {
                        notifyAuthChange(auth);
                        sendResponse({ success: true, auth });
                    })
                    .catch((err) => sendResponse({ success: false, error: err.message }));
                return true;
            }

            if (message.type === 'ADWARDEN_REGISTER') {
                register(message.email, message.password)
                    .then((auth) => {
                        notifyAuthChange(auth);
                        sendResponse({ success: true, auth });
                    })
                    .catch((err) => sendResponse({ success: false, error: err.message }));
                return true;
            }

            if (message.type === 'ADWARDEN_LOGOUT') {
                logout()
                    .then(() => {
                        notifyAuthChange(null);
                        sendResponse({ success: true });
                    })
                    .catch((err) => sendResponse({ success: false, error: err.message }));
                return true;
            }

            if (message.type === 'ADWARDEN_GET_AUTH') {
                validateToken({ force: message.force === true })
                    .then((auth) => sendResponse({ auth }))
                    .catch(() => sendResponse({ auth: null }));
                return true;
            }

            return false;
        });
    }

    // Export
    const authModule = {
        getToken,
        getAuth,
        login,
        register,
        logout,
        validateToken,
        clearAuth,
        refreshProfileFromServer,
    };

    if (typeof globalThis !== 'undefined') globalThis.authModule = authModule;
    if (typeof window !== 'undefined') window.authModule = authModule;

    console.log('[Auth] Module loaded');
})();
