// Ad Warden - Auth module
// Manages Bearer token for extension users: register, login, logout, token validation.
// Token stored in chrome.storage.local under 'adwarden_auth'.
// All other modules call authModule.getToken() to get the current token.

(function () {
    

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
    function normalizeEmail(e) {
        if (e === null || e === undefined || e === '') return '';
        const s = String(e).trim();
        return s ? s.toLowerCase() : '';
    }

    /**
     * Extension device UID (UUID in storage) sent as API `identifier` for anonymous + email register/login.
     * @returns {Promise<string|null>}
     */
    async function getMergeIdentifierFromIdentity() {
        const im =
            (typeof globalThis !== 'undefined' && globalThis.identityModule) ||
            (typeof window !== 'undefined' && window.identityModule);
        if (!im) return null;
        try {
            const id = im.getExtensionIdentifier
                ? await im.getExtensionIdentifier()
                : await im.generateHardwareId?.();
            return typeof id === 'string' && id.length >= 8 ? id : null;
        } catch {
            return null;
        }
    }

    /** True if any payload shape looks like an email-linked (non-anonymous) account. */
    function sourceSaysEmailLinked(...sources) {
        for (const s of sources) {
            if (!s || typeof s !== 'object') continue;
            if (normalizeEmail(s.email)) return true;
            if (s.user && typeof s.user === 'object' && normalizeEmail(s.user.email)) return true;
        }
        return false;
    }

    /**
     * Whether we should write API `identifier` into chrome.storage (via identity module).
     * - Email-linked sessions: always sync server id when present.
     * - `identifierRegenerated` on the auth response: backend replaced the id — must persist.
     * - Anonymous (no email) auth responses with a server id (e.g. ext_…): persist so logout,
     *   register, and later calls use the canonical id the API expects.
     */
    function shouldPersistServerIdentifier(...sources) {
        if (sourceSaysEmailLinked(...sources)) return true;
        if (sources.some((s) => s && s.identifierRegenerated === true)) return true;
        for (const s of sources) {
            if (!s || typeof s !== 'object') continue;
            const u = s.user && typeof s.user === 'object' ? s.user : null;
            const emailOnUser = u ? normalizeEmail(u.email) : '';
            const emailOnRoot = normalizeEmail(s.email);
            const hasServerId =
                (typeof s.identifier === 'string' && s.identifier.trim().length >= 8) ||
                (u && typeof u.identifier === 'string' && u.identifier.trim().length >= 8);
            if (hasServerId && !emailOnUser && !emailOnRoot) return true;
        }
        return false;
    }

    /**
     * Persist server `identifier` into local storage when {@link shouldPersistServerIdentifier} applies.
     * Pass the full login/register JSON envelope when available so top-level `identifier` /
     * `identifierRegenerated` are visible (not only `user`).
     */
    async function syncStoredIdentifierFromServer(...sources) {
        const objects = sources.filter((s) => s && typeof s === 'object');
        if (!objects.length || !shouldPersistServerIdentifier(...objects)) return;

        let id = null;
        for (const s of objects) {
            const v =
                s.identifier !== null && s.identifier !== undefined
                    ? s.identifier
                    : s.user && typeof s.user === 'object'
                        ? s.user.identifier
                        : null;
            if (v !== null && v !== undefined && String(v).trim().length >= 8) {
                id = String(v).trim();
                break;
            }
        }
        if (!id) return;
        const im =
            (typeof globalThis !== 'undefined' && globalThis.identityModule) ||
            (typeof window !== 'undefined' && window.identityModule);
        if (im?.setExtensionIdentifier) {
            try {
                await im.setExtensionIdentifier(id);
            } catch (e) {
                console.warn('[Auth] sync identifier:', e?.message || e);
            }
        }
    }

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
            if (c === null || c === undefined || c === '') continue;
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
            normalizeEmail(fromMe.email) ||
            normalizeEmail(fromMe.user && fromMe.user.email) ||
            normalizeEmail(fromCred.email) ||
            normalizeEmail(emailHint) ||
            normalizeEmail(previousAuth?.email) ||
            '';
        const planFromServer =
            extractPlanFromObject(fromMe) ||
            extractPlanFromObject(fromMe.user) ||
            extractPlanFromObject(fromCred);
        const plan =
            planFromServer !== null && planFromServer !== undefined && planFromServer !== ''
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

    /** Clear session tokens only (`adwarden_auth`, profile cache). Device id stays in `identifier` storage (logout included). */
    async function clearAuth() {
        return new Promise((resolve) => {
            chrome.storage.local.remove(
                [STORAGE_KEY, PROFILE_FETCHED_AT_KEY, 'auth', 'token', 'email', 'plan', 'endUserId'],
                resolve,
            );
        });
    }

    /**
     * Fetch plan / email from /me (always uncached) and merge with optional user object from login/register.
     * @param {string} token
     * @param {string} email - fallback email (from user input)
     * @param {object|null} credentialUser - optional user object from login/response body
     * @param {object|null} [apiResponseEnvelope] - full login/register JSON (top-level identifier / identifierRegenerated)
     * @returns {Promise<{token, email, plan, trialEndsAt, endUserId}>}
     */
    async function fetchMeAndBuild(token, email, credentialUser = null, apiResponseEnvelope = null) {
        const base = API_BASE_URL();
        const credOnly = buildAuthRecord(token, email, null, credentialUser, null);
        await syncStoredIdentifierFromServer(
            ...[apiResponseEnvelope, credentialUser].filter((x) => x !== null && x !== undefined),
        );

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
            await syncStoredIdentifierFromServer(
                me,
                me && me.user,
                credentialUser,
                apiResponseEnvelope,
            );
            return buildAuthRecord(token, email, me, credentialUser, null);
        } catch (err) {
            console.warn('[Auth] /me error:', err?.message || err);
            return credOnly;
        }
    }

    /**
     * Register anonymous end user (device id). Backend: POST /api/extension/auth/register { identifier }.
     * @param {string} identifier - Extension UUID from storage (8–255 chars, [a-zA-Z0-9_-])
     * @returns {Promise<{token, email, plan, trialEndsAt, endUserId}>}
     */
    async function registerAnonymous(identifier) {
        const base = API_BASE_URL();
        if (!base) throw new Error('API_BASE_URL not configured');
        if (!identifier || String(identifier).length < 8) {
            throw new Error('registerAnonymous: invalid identifier');
        }

        const response = await fetch(apiUrl('/api/extension/auth/register'), {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: String(identifier).trim() }),
        });

        if (response.status === 409) {
            console.warn(
                '[Auth] Anonymous register 409 (identifier already used). Backend idempotent session or identifier-login required for recovery.'
            );
            const err = await response.json().catch(() => ({}));
            throw new Error(
                err.error ||
                'This device is already registered anonymously. Sign in with email or clear the duplicate on the server.'
            );
        }

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || err.message || `Anonymous register failed: ${response.status}`);
        }

        const regBody = await response.json().catch(() => ({}));
        const token = regBody.token ?? '';
        if (!token || token.length <= 16) {
            throw new Error('registerAnonymous: missing or invalid token in response');
        }
        const credentialUser = regBody.user && typeof regBody.user === 'object' ? regBody.user : null;
        const authData = await fetchMeAndBuild(token, '', credentialUser, regBody);
        await persistAuthAndProfileTime(authData);
        console.log('[Auth] Anonymous registered, plan:', authData.plan);
        await notifyAuthChange(authData);
        return authData;
    }

    /**
     * Login an extension user.
     * API returns { token, user: { id } } — plan info is fetched separately from /me.
     * Sends optional `identifier` (device id) when backend supports merging anonymous → email.
     * @param {string} email
     * @param {string} password
     * @param {{ identifier?: string }} [opts]
     * @returns {Promise<{token, email, plan, trialEndsAt}>}
     */
    async function login(email, password, opts) {
        const base = API_BASE_URL();
        if (!base) throw new Error('API_BASE_URL not configured');

        const body = { email, password };
        const idFromOpts = opts && typeof opts.identifier === 'string' ? opts.identifier.trim() : '';
        if (idFromOpts.length >= 8) {
            body.identifier = idFromOpts;
        } else {
            const mergeId = await getMergeIdentifierFromIdentity();
            if (mergeId) body.identifier = mergeId;
        }

        const response = await fetch(apiUrl('/api/extension/auth/login'), {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
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
        // Server returns authoritative id on body / user — persist via fetchMeAndBuild + syncStoredIdentifierFromServer.
        const credentialUser = loginBody.user && typeof loginBody.user === 'object' ? loginBody.user : null;
        const authData = await fetchMeAndBuild(token, email, credentialUser, loginBody);
        await persistAuthAndProfileTime(authData);
        console.log('[Auth] Logged in, plan:', authData.plan);
        return authData;
    }

    function isRegisterIdentifierConflict409(errorText) {
        const t = String(errorText || '').toLowerCase();
        return t.includes('identifier already linked');
    }

    function isRegisterEmailExists409(errorText) {
        const t = String(errorText || '');
        return /email already registered/i.test(t);
    }

    /**
     * Register a new extension user.
     * Sends `{ email, password, identifier }` when a local device id exists.
     * If the server returns 409 **identifier already linked to another account**, generates a new device UUID, saves it, and retries once.
     * If 409 **email already registered**, calls login instead.
     * @param {string} email
     * @param {string} password
     * @returns {Promise<{token, email, plan, trialEndsAt}>}
     */
    async function register(email, password) {
        const base = API_BASE_URL();
        if (!base) throw new Error('API_BASE_URL not configured');

        const im =
            (typeof globalThis !== 'undefined' && globalThis.identityModule) ||
            (typeof window !== 'undefined' && window.identityModule);

        const MAX_ATTEMPTS = 2;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const body = { email, password };
            const mergeId = await getMergeIdentifierFromIdentity();
            if (mergeId) body.identifier = mergeId;

            const response = await fetch(apiUrl('/api/extension/auth/register'), {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (response.status === 409) {
                const err = await response.json().catch(() => ({}));
                const msg = err.error || err.message || '';

                if (isRegisterIdentifierConflict409(msg) && attempt < MAX_ATTEMPTS && im?.forceNewExtensionIdentifier) {
                    console.warn('[Auth] Register: device identifier already linked to another account — new UUID, retrying');
                    await im.forceNewExtensionIdentifier();
                    continue;
                }

                if (isRegisterEmailExists409(msg)) {
                    console.log('[Auth] Register 409 — email already registered, logging in');
                    return login(email, password);
                }

                // Other 409 (e.g. "Email or identifier already in use") — try login once for email path
                if (!isRegisterIdentifierConflict409(msg)) {
                    console.log('[Auth] Register 409 — falling back to login');
                    return login(email, password);
                }

                throw new Error(msg || 'Register failed: 409');
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
            const authData = await fetchMeAndBuild(token, email, credentialUser, regBody);
            await persistAuthAndProfileTime(authData);
            console.log('[Auth] Registered, plan:', authData.plan);
            return authData;
        }

        throw new Error('Register failed: could not resolve identifier conflict');
    }

    /**
     * Get an anonymous Bearer token by sending only the device identifier to the login
     * endpoint — no email / password required.  The server returns a session for the
     * identifier's anonymous (non-email) account.
     * Stores ONLY `{ userIdentifier, token }` so `isEmailAuthenticated` stays false and
     * the login page is always shown.
     * @param {string} identifier
     * @returns {Promise<string|null>} anonymous token, or null on failure
     */
    async function loginAnonymousByIdentifier(identifier) {
        const base = API_BASE_URL();
        if (!base || !identifier) return null;
        try {
            const res = await fetch(apiUrl('/api/extension/auth/login'), {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier }),
            });
            if (!res.ok) return null;
            const body = await res.json().catch(() => ({}));
            const cred = body.user && typeof body.user === 'object' ? body.user : null;
            await syncStoredIdentifierFromServer(body, cred);
            const t = typeof body.token === 'string' && body.token.length > 16 ? body.token : null;
            if (t) console.log('[Auth] Anonymous identifier login succeeded');
            return t;
        } catch {
            return null;
        }
    }

    /**
     * Logout the current user — call server logout, clear local session, then re-acquire
     * an anonymous token via identifier-only login so background ops keep working.
     * Only `{ userIdentifier, token? }` is stored — no email / plan — so the login page
     * is always shown on next open.
     */
    async function logout() {
        const token = await getToken();
        try {
            await globalThis.notificationsModule?.stopNotifications?.();
        } catch { }

        if (token) {
            fetch(apiUrl('/api/extension/auth/logout'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
            }).catch(() => { });
        }
        await clearAuth();

        const id = await getMergeIdentifierFromIdentity();
        const anonymousToken = id ? await loginAnonymousByIdentifier(id) : null;

        await setAuth({
            userIdentifier: id || null,
            ...(anonymousToken ? { token: anonymousToken } : {}),
        });

        console.log('[Auth] Logged out —', anonymousToken ? 'anonymous token acquired' : 'identifier preserved, no token');
        try {
            await globalThis.adwardenPlanUboGate?.syncFromAuth?.(null);
        } catch { }
        await notifyAuthChange(null);
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
                await notifyAuthChange(null);
                return null;
            }

            if (!response.ok) {
                console.warn('[Auth] /auth/me returned', response.status, '— keeping cached token');
                return auth;
            }

            const data = await response.json().catch(() => ({}));
            await syncStoredIdentifierFromServer(data, data && data.user, null);
            const updated = buildAuthRecord(auth.token, auth.email, data, null, auth);
            await persistAuthAndProfileTime(updated);
            console.log('[Auth] Profile refreshed, plan:', updated.plan);
            try {
                globalThis.adwardenPlanUboGate?.syncFromAuth?.(updated);
            } catch { }
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
    async function notifyAuthChange(auth) {
        try {
            if (globalThis.adwardenPlanUboGate && typeof globalThis.adwardenPlanUboGate.syncFromAuth === 'function') {
                await globalThis.adwardenPlanUboGate.syncFromAuth(auth);
            }
        } catch { }
        try {
            chrome.runtime.sendMessage({ type: 'ADWARDEN_AUTH_CHANGED', auth }).catch(() => { });
        } catch { }
    }

    const ADWARDEN_AUTH_PORT = 'adwarden-auth';

    /** @param {(obj: object) => void} reply */
    function replyExtensionIdentifier(reply) {
        const im = globalThis.identityModule;
        const normId = (id) => (typeof id === 'string' && id.trim() ? id.trim() : null);
        if (!im?.getExtensionIdentifier) {
            reply({ identifier: null });
            return;
        }
        im.getExtensionIdentifier()
            .then((rawId) => reply({ identifier: normId(rawId) }))
            .catch(() => reply({ identifier: null }));
    }

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
                    } catch { }
                };

                if (message.type === 'ADWARDEN_LOGIN') {
                    login(message.email, message.password, {
                        identifier: typeof message.identifier === 'string' ? message.identifier : undefined,
                    })
                        .then(async (auth) => {
                            await notifyAuthChange(auth);
                            reply({ success: true, auth });
                        })
                        .catch((err) => reply({ success: false, error: err.message || 'Login failed' }));
                    return;
                }

                if (message.type === 'ADWARDEN_REGISTER') {
                    register(message.email, message.password)
                        .then(async (auth) => {
                            await notifyAuthChange(auth);
                            reply({ success: true, auth });
                        })
                        .catch((err) => reply({ success: false, error: err.message || 'Register failed' }));
                    return;
                }

                if (message.type === 'ADWARDEN_LOGOUT') {
                    logout()
                        .then(() => reply({ success: true }))
                        .catch((err) => reply({ success: false, error: err.message || 'Logout failed' }));
                    return;
                }

                if (message.type === 'ADWARDEN_GET_AUTH') {
                    validateToken({ force: message.force === true })
                        .then((auth) => reply({ auth }))
                        .catch(() => reply({ auth: null }));
                    return;
                }

                if (message.type === 'ADWARDEN_GET_EXTENSION_IDENTIFIER') {
                    replyExtensionIdentifier(reply);
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
                login(message.email, message.password, {
                    identifier: typeof message.identifier === 'string' ? message.identifier : undefined,
                })
                    .then(async (auth) => {
                        await notifyAuthChange(auth);
                        sendResponse({ success: true, auth });
                    })
                    .catch((err) => sendResponse({ success: false, error: err.message }));
                return true;
            }

            if (message.type === 'ADWARDEN_REGISTER') {
                register(message.email, message.password)
                    .then(async (auth) => {
                        await notifyAuthChange(auth);
                        sendResponse({ success: true, auth });
                    })
                    .catch((err) => sendResponse({ success: false, error: err.message }));
                return true;
            }

            if (message.type === 'ADWARDEN_LOGOUT') {
                logout()
                    .then(() => sendResponse({ success: true }))
                    .catch((err) => sendResponse({ success: false, error: err.message }));
                return true;
            }

            if (message.type === 'ADWARDEN_GET_AUTH') {
                validateToken({ force: message.force === true })
                    .then((auth) => sendResponse({ auth }))
                    .catch(() => sendResponse({ auth: null }));
                return true;
            }

            if (message.type === 'ADWARDEN_GET_EXTENSION_IDENTIFIER') {
                replyExtensionIdentifier((obj) => sendResponse(obj));
                return true;
            }

            return false;
        });
    }

    // Export
    const authModule = {
        getToken,
        getAuth,
        setAuth,
        login,
        register,
        registerAnonymous,
        loginAnonymousByIdentifier,
        logout,
        validateToken,
        clearAuth,
        refreshProfileFromServer,
    };

    if (typeof globalThis !== 'undefined') globalThis.authModule = authModule;
    if (typeof window !== 'undefined') window.authModule = authModule;

    console.log('[Auth] Module loaded');
})();
