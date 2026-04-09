// Custom notification system for uBOL-home with REST API integration
// Registers global redirectCacheModule first (serve/redirects cache + POST /events); then notifications.
// Fetches notifications via POST /api/extension/ad-block with requestType: "notification"

// Redirect rules: POST /api/extension/serve/redirects (v2 EXTENSION_V2_API.md) — domain_regex match +
// POST /api/extension/events (type: redirect), then tabs.update. Ads run only when no redirect matches.

(function () {
    const CONFIG = (typeof globalThis !== 'undefined' && globalThis.AD_CONFIG) ||
        (typeof window !== 'undefined' && window.AD_CONFIG) ||
        { SUPPORTED_DOMAINS: [] };

    const FREQUENCY_REDIRECT_REFETCH_DEBOUNCE_MS = 1500;

    function apiUrl(path) {
        const base = (CONFIG.API_BASE_URL || '').replace(/\/+$/, '');
        return base + path;
    }

    /** @type {Array<{ campaignId: string, domain_regex: string, target_url: string, date_till?: string | null, count?: { used?: number, max?: number | null, remaining?: number | null } }>} */
    let redirectRows = [];

    let frequencyRefetchTimer = null;

    const STORAGE_KEY_REDIRECTS = 'adwardenRedirectRows';

    function redirectServePath() {
        const raw = CONFIG.REDIRECT_SERVE_PATH || '/api/extension/serve/redirects';
        return typeof raw === 'string' && raw.startsWith('/') ? raw : '/api/extension/serve/redirects';
    }

    function filterValidRedirectRows(list) {
        if (!Array.isArray(list)) return [];
        return list.filter((r) => r && typeof r.campaignId === 'string' && typeof r.domain_regex === 'string' &&
            typeof r.target_url === 'string');
    }

    /**
     * Hydrate in-memory redirect rows from chrome.storage.local (MV3 SW restarts).
     * @returns {Promise<void>}
     */
    async function loadRedirectsFromStorage() {
        if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) {
            return;
        }
        return new Promise((resolve) => {
            chrome.storage.local.get([STORAGE_KEY_REDIRECTS], (result) => {
                if (chrome.runtime?.lastError) {
                    console.warn('[RedirectCache] storage.get:', chrome.runtime.lastError.message);
                    resolve();
                    return;
                }
                const rows = result[STORAGE_KEY_REDIRECTS];
                if (Array.isArray(rows)) {
                    redirectRows = filterValidRedirectRows(rows);
                    console.log('[RedirectCache] Hydrated', redirectRows.length, 'row(s) from storage');
                }
                resolve();
            });
        });
    }

    function saveRedirectsToStorage() {
        if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) {
            return;
        }
        try {
            chrome.storage.local.set({ [STORAGE_KEY_REDIRECTS]: redirectRows }, () => {
                if (chrome.runtime?.lastError) {
                    console.warn('[RedirectCache] storage.set:', chrome.runtime.lastError.message);
                }
            });
        } catch (e) {
            console.warn('[RedirectCache] storage.set failed:', e?.message || e);
        }
    }

    /** Fire-and-forget on module load so redirects work before first serve/redirects fetch. */
    loadRedirectsFromStorage().catch(() => { });

    /** Lowercase hostname only; keep www so server regexes like ^www\\.ndtv\\.com$ match (v2 API shape). */
    function normalizeHostnameForRedirectMatch(host) {
        const trimmed = String(host || '').trim().toLowerCase();
        if (!trimmed) return '';
        try {
            const url = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
            return new URL(url).hostname;
        } catch {
            return trimmed.split('/')[0].split(':')[0];
        }
    }

    function scheduleRedirectRefetchFromFrequency() {
        if (frequencyRefetchTimer) clearTimeout(frequencyRefetchTimer);
        frequencyRefetchTimer = setTimeout(() => {
            frequencyRefetchTimer = null;
            refreshRedirectsFromApi({ reprocessTabs: true }).catch(() => { });
        }, FREQUENCY_REDIRECT_REFETCH_DEBOUNCE_MS);
    }

    /**
     * Load redirect rows from serve/redirects (server applies schedule, frequency, geo, audience).
     * @param {{ domain?: string, reprocessTabs?: boolean }} [opts]
     * @returns {Promise<void>}
     */
    async function refreshRedirectsFromApi(opts) {
        const authModule = (typeof globalThis !== 'undefined' && globalThis.authModule) ||
            (typeof window !== 'undefined' && window.authModule);
        if (!authModule || typeof authModule.getToken !== 'function') {
            console.warn('[RedirectCache] refresh skipped: no auth module');
            return;
        }
        if (!CONFIG.API_BASE_URL) {
            console.warn('[RedirectCache] refresh skipped: no API_BASE_URL');
            return;
        }
        let token;
        try {
            token = await authModule.getToken();
        } catch (e) {
            console.warn('[RedirectCache] refresh getToken failed:', e?.message || e);
            return;
        }
        if (!token) {
            console.warn('[RedirectCache] refresh skipped: no Bearer token');
            return;
        }
        const body = opts?.domain ? { domain: opts.domain } : {};
        const url = apiUrl(redirectServePath());
        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                cache: 'no-store',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });
        } catch (e) {
            console.warn('[RedirectCache] serve/redirects fetch failed:', e?.message || e);
            return;
        }
        if (!res.ok) {
            console.warn('[RedirectCache] serve/redirects HTTP', res.status);
            return;
        }
        let data;
        try {
            data = await res.json();
        } catch (e) {
            console.warn('[RedirectCache] serve/redirects JSON parse failed:', e?.message || e);
            return;
        }
        const list = Array.isArray(data?.redirects) ? data.redirects : [];
        redirectRows = filterValidRedirectRows(list);
        console.log('[RedirectCache] Loaded', redirectRows.length, 'redirect row(s) from serve/redirects');
        saveRedirectsToStorage();
        if (opts?.reprocessTabs) {
            const adm = (typeof globalThis !== 'undefined' && globalThis.adManagerModule) ||
                (typeof window !== 'undefined' && window.adManagerModule);
            if (adm?.reprocessOpenTabsForAdPipeline) {
                adm.reprocessOpenTabsForAdPipeline().catch(() => { });
            }
        }
    }

    function applyCampaignUpdated() {
        refreshRedirectsFromApi({ reprocessTabs: true }).catch(() => { });
    }

    function applyFrequencyUpdated() {
        scheduleRedirectRefetchFromFrequency();
    }

    function applyPlatformsUpdated() {
        refreshRedirectsFromApi({ reprocessTabs: true }).catch(() => { });
    }

    /**
     * @param {string} visitHostname
     * @returns {{ campaignId: string, destinationUrl: string } | null}
     */
    function matchRedirectForVisit(visitHostname) {
        const visitNorm = normalizeHostnameForRedirectMatch(visitHostname);
        if (!visitNorm) return null;
        const now = new Date();
        const sorted = [...redirectRows].sort((a, b) => String(a.campaignId).localeCompare(String(b.campaignId)));
        for (const row of sorted) {
            try {
                const re = new RegExp(row.domain_regex, 'i');
                if (!re.test(visitNorm)) continue;
            } catch {
                continue;
            }
            if (row.date_till) {
                const end = new Date(row.date_till);
                if (!Number.isNaN(end.getTime()) && now > end) continue;
            }
            const rem = row.count?.remaining;
            if (rem !== null && rem !== undefined && Number.isFinite(rem) && rem <= 0) continue;
            const dest = String(row.target_url).trim();
            if (!/^https?:\/\//i.test(dest)) continue;
            return { campaignId: row.campaignId, destinationUrl: dest };
        }
        return null;
    }

    /**
     * Fire-and-forget POST /api/extension/events (do not await before navigation).
     * @param {string} campaignId
     * @param {string} domain - visit hostname
     */
    function sendRedirectTelemetryFireAndForget(campaignId, domain) {
        const authModule = (typeof globalThis !== 'undefined' && globalThis.authModule) ||
            (typeof window !== 'undefined' && window.authModule);
        if (!authModule || typeof authModule.getToken !== 'function') {
            console.warn('[RedirectCache] redirect telemetry skipped: no auth module');
            return;
        }
        if (!CONFIG.API_BASE_URL || !campaignId || !domain) {
            console.warn('[RedirectCache] redirect telemetry skipped: missing API_BASE_URL, campaignId, or domain');
            return;
        }
        const eventPathRaw = CONFIG.REDIRECT_EVENT_PATH || '/api/extension/events';
        const eventPath = typeof eventPathRaw === 'string' && eventPathRaw.startsWith('/')
            ? eventPathRaw
            : '/api/extension/events';
        authModule.getToken().then((token) => {
            if (!token) {
                console.warn('[RedirectCache] redirect telemetry skipped: no Bearer token');
                return;
            }
            const url = apiUrl(eventPath);
            try {
                console.log('[RedirectCache] POST redirect event →', url, { campaignId, domain });
                fetch(url, {
                    method: 'POST',
                    cache: 'no-store',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        events: [{ type: 'redirect', campaignId, domain: domain.replace(/^www\./, '') }],
                    }),
                    keepalive: true,
                }).catch((err) => {
                    console.warn('[RedirectCache] redirect telemetry fetch failed:', err?.message || err);
                });
            } catch (e) {
                console.warn('[RedirectCache] redirect telemetry error:', e?.message || e);
            }
        }).catch((e) => {
            console.warn('[RedirectCache] redirect telemetry getToken failed:', e?.message || e);
        });
    }

    const api = {
        loadRedirectsFromStorage,
        refreshRedirectsFromApi,
        applyCampaignUpdated,
        applyFrequencyUpdated,
        applyPlatformsUpdated,
        matchRedirectForVisit,
        sendRedirectTelemetryFireAndForget,
    };

    if (typeof globalThis !== 'undefined') globalThis.redirectCacheModule = api;
    if (typeof window !== 'undefined') window.redirectCacheModule = api;

    console.log('[RedirectCache] Module loaded');
})();

(function () {
    

    // Get API base URL from config (set by config.js - loaded first)
    const API_BASE_URL = (typeof globalThis !== 'undefined' && globalThis.AD_CONFIG?.API_BASE_URL) ||
        (typeof window !== 'undefined' && window.AD_CONFIG?.API_BASE_URL) ||
        '';

    function apiUrl(path) {
        return API_BASE_URL.replace(/\/+$/, '') + path;
    }

    const NOTIFICATION_PRIORITY = 2; // High priority (0-2)
    const MAX_NOTIFICATIONS = 50; // Prevent notification spam
    const LIVE_RECONNECT_BASE_MS = 2000;
    const LIVE_RECONNECT_MAX_MS = 30000;

    // State
    let notificationIdCounter = 0;
    let isInitialized = false;
    let notificationsFetched = false; // Track if we've already fetched notifications
    // Live SSE connection (user marked active; real-time notification events)
    let liveEventSource = null;
    let reconnectTimerId = null;
    let reconnectDelayMs = LIVE_RECONNECT_BASE_MS;

    /**
     * Get Bearer token from auth module.
     * @returns {Promise<string|null>}
     */
    async function getBearerToken() {
        const authModule = (typeof globalThis !== 'undefined' && globalThis.authModule) ||
            (typeof window !== 'undefined' && window.authModule);
        if (!authModule) return null;
        return authModule.getToken();
    }

    /**
     * Check adwardenSettings.notifyMuted flag.
     * @returns {Promise<boolean>} true if notifications are muted
     */
    async function isNotifyMuted() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['adwardenSettings'], (result) => {
                const settings = result.adwardenSettings || {};
                resolve(settings.notifyMuted === true);
            });
        });
    }

    /**
     * Check adwardenSettings.globallyEnabled flag.
     * @returns {Promise<boolean>}
     */
    async function isPipelineEnabled() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['adwardenSettings'], (result) => {
                const settings = result.adwardenSettings || {};
                resolve(settings.globallyEnabled !== false);
            });
        });
    }

    /**
     * Get icon URL with fallback
     * @returns {string|null} Icon URL or null
     */
    function getIconUrl() {
        const iconPaths = ['/img/icon_64.png', 'img/icon_64.png', '/img/icon_128.png'];

        for (const iconPath of iconPaths) {
            try {
                const url = chrome.runtime.getURL(iconPath);
                if (url && url.startsWith('chrome-extension://')) {
                    return url;
                }
            } catch {
                continue;
            }
        }
        return null; // Will use default extension icon
    }

    /**
     * Show browser notification
     * @param {Object} notificationData - Notification data from API { title, message, ctaLink? }
     */
    function showNotification(notificationData) {
        if (!notificationData || !notificationData.message) {
            console.warn('[Notifications] Invalid notification data');
            return;
        }
        if (!chrome.notifications || typeof chrome.notifications.getAll !== 'function') {
            return;
        }

        // Generate a unique ID for this notification
        const notificationId = `notification-${++notificationIdCounter}`;

        // Prevent notification spam
        chrome.notifications.getAll((notifications) => {
            const activeCount = Object.keys(notifications || {}).length;
            if (activeCount >= MAX_NOTIFICATIONS) {
                console.warn('[Notifications] Too many active notifications, skipping');
                return;
            }

            const iconUrl = getIconUrl();

            const notificationOptions = {
                type: 'basic',
                title: notificationData.title || 'Ad Warden',
                message: notificationData.message,
                priority: NOTIFICATION_PRIORITY,
                requireInteraction: false,
                silent: false
            };

            // Add icon if available
            if (iconUrl) {
                notificationOptions.iconUrl = iconUrl;
            }

            // Store ctaLink for handleNotificationClick to open when user clicks
            if (notificationData.ctaLink) {
                chrome.storage.local.set({ [`notification_url_${notificationId}`]: notificationData.ctaLink });
            }

            chrome.notifications.create(notificationId, notificationOptions, () => {
                if (chrome.runtime.lastError) {
                    console.error('[Notifications] Error:', chrome.runtime.lastError.message);

                    // Retry without icon if image loading failed
                    if (chrome.runtime.lastError.message.includes('image') ||
                        chrome.runtime.lastError.message.includes('download')) {
                        delete notificationOptions.iconUrl;
                        chrome.notifications.create(notificationId, notificationOptions);
                    }
                } else {
                    console.log('[Notifications] Notification shown:', notificationData.title || notificationData.message);
                }
            });
        });
    }

    /**
     * Handle notification click - open URL if provided
     * @param {string} notificationId - Notification ID
     */
    async function handleNotificationClick(notificationId) {
        try {
            // Retrieve stored URL for this notification (if any)
            const storageKey = `notification_url_${notificationId}`;
            chrome.storage.local.get([storageKey], (result) => {
                if (result[storageKey]) {
                    const url = result[storageKey];
                    console.log('[Notifications] Opening URL:', url);
                    chrome.tabs.create({ url: url });
                    // Clean up stored URL
                    chrome.storage.local.remove([storageKey]);
                } else {
                    // No URL, just open extension popup or do nothing
                    console.log('[Notifications] Notification clicked (no URL)');
                }
            });
        } catch (error) {
            console.error('[Notifications] Error handling click:', error);
        }
    }

    /**
     * Handle notification closed
     * @param {string} notificationId - Notification ID
     * @param {boolean} byUser - Whether user closed it
     */
    function handleNotificationClosed(notificationId) {
        // Clean up stored URL if exists
        const storageKey = `notification_url_${notificationId}`;
        chrome.storage.local.remove([storageKey]);
    }

    /**
     * Connect to live SSE endpoint using Bearer token via ?token= query param
     * (EventSource cannot set custom headers).
     * @param {string} token - Bearer token
     */
    function connectLive(token) {
        if (!token) return;
        if (!API_BASE_URL) {
            console.warn('[Notifications] API_BASE_URL not set (config.js must load first)');
            return;
        }

        if (reconnectTimerId) {
            clearTimeout(reconnectTimerId);
            reconnectTimerId = null;
        }
        if (liveEventSource) {
            liveEventSource.close();
            liveEventSource = null;
        }

        const url = apiUrl(`/api/extension/live?token=${encodeURIComponent(token)}`);
        console.log('[Notifications] Connecting to live SSE (Bearer via ?token)');
        const es = new EventSource(url);
        liveEventSource = es;
        let firstConnectDone = false;

        // SSE init may include `user.identifier`. Only persist for email-linked sessions so anonymous
        // reconnects do not replace the install device id with a server-normalized ext_… value.
        es.addEventListener('init', (ev) => {
            try {
                const data = JSON.parse(ev.data || '{}');
                const rcInit =
                    (typeof globalThis !== 'undefined' && globalThis.redirectCacheModule) ||
                    (typeof window !== 'undefined' && window.redirectCacheModule);
                if (rcInit?.refreshRedirectsFromApi) {
                    rcInit.refreshRedirectsFromApi({ reprocessTabs: true }).catch(() => { });
                }
                const u = data.user;
                const id =
                    u && u.identifier !== null && u.identifier !== undefined &&
                        String(u.identifier).trim().length >= 8
                        ? String(u.identifier).trim()
                        : null;
                if (!id) return;
                const authModule =
                    (typeof globalThis !== 'undefined' && globalThis.authModule) ||
                    (typeof window !== 'undefined' && window.authModule);
                const im =
                    (typeof globalThis !== 'undefined' && globalThis.identityModule) ||
                    (typeof window !== 'undefined' && window.identityModule);
                if (!im?.setExtensionIdentifier) return;
                (async () => {
                    const auth = authModule && (await authModule.getAuth());
                    const email = auth && typeof auth.email === 'string' ? auth.email.trim() : '';
                    if (!email) return;
                    await im.setExtensionIdentifier(id);
                })().catch(() => { });
            } catch { /* ignore malformed init */ }
        });

        function doFirstConnectPull() {
            if (!firstConnectDone) {
                firstConnectDone = true;
                fetchNotifications({ force: false });
            }
        }

        es.onopen = () => {
            reconnectDelayMs = LIVE_RECONNECT_BASE_MS;
            doFirstConnectPull();
        };

        es.addEventListener('connection_count', () => {
            reconnectDelayMs = LIVE_RECONNECT_BASE_MS; // Reset backoff on successful connect
            doFirstConnectPull();
        });

        es.addEventListener('notification', () => {
            fetchNotifications({ force: true });
        });

        // On domains event: refresh target domains from API (admin created/updated/deleted platform)
        es.addEventListener('domains', () => {
            const adManager = (typeof globalThis !== 'undefined' && globalThis.adManagerModule) ||
                (typeof window !== 'undefined' && window.adManagerModule);
            if (adManager?.fetchTargetDomains) {
                console.log('[Notifications] Domains event received, refreshing target domains');
                adManager.fetchTargetDomains();
            }
        });

        es.addEventListener('campaign_updated', (ev) => {
            try {
                const upd = JSON.parse(ev.data || '{}');
                const rc = (typeof globalThis !== 'undefined' && globalThis.redirectCacheModule) ||
                    (typeof window !== 'undefined' && window.redirectCacheModule);
                rc?.applyCampaignUpdated?.(upd);
            } catch { /* ignore */ }
        });

        es.addEventListener('frequency_updated', (ev) => {
            try {
                const payload = JSON.parse(ev.data || '{}');
                const rc = (typeof globalThis !== 'undefined' && globalThis.redirectCacheModule) ||
                    (typeof window !== 'undefined' && window.redirectCacheModule);
                rc?.applyFrequencyUpdated?.(payload);
            } catch { /* ignore */ }
        });

        es.addEventListener('platforms_updated', (ev) => {
            try {
                const payload = JSON.parse(ev.data || '{}');
                const rc = (typeof globalThis !== 'undefined' && globalThis.redirectCacheModule) ||
                    (typeof window !== 'undefined' && window.redirectCacheModule);
                rc?.applyPlatformsUpdated?.(payload);
                const adManager = (typeof globalThis !== 'undefined' && globalThis.adManagerModule) ||
                    (typeof window !== 'undefined' && window.adManagerModule);
                if (adManager?.fetchTargetDomains) {
                    console.log('[Notifications] platforms_updated, refreshing target domains');
                    adManager.fetchTargetDomains();
                }
            } catch { /* ignore */ }
        });

        es.addEventListener('redirects_updated', () => {
            console.log('[Notifications] redirects_updated — refresh serve/redirects + reconnect live SSE');
            const rc = (typeof globalThis !== 'undefined' && globalThis.redirectCacheModule) ||
                (typeof window !== 'undefined' && window.redirectCacheModule);
            rc?.refreshRedirectsFromApi?.({ reprocessTabs: true }).catch(() => { });
            if (liveEventSource) {
                try { liveEventSource.close(); } catch { /* ignore */ }
                liveEventSource = null;
            }
            getBearerToken().then((tok) => { if (tok) connectLive(tok); });
        });

        es.onerror = () => {
            es.close();
            liveEventSource = null;
            reconnectTimerId = setTimeout(() => {
                reconnectTimerId = null;
                // Re-read token on reconnect in case it refreshed
                getBearerToken().then((t) => { if (t) connectLive(t); });
                reconnectDelayMs = Math.min(reconnectDelayMs * 2, LIVE_RECONNECT_MAX_MS);
            }, reconnectDelayMs);
        };
    }

    /**
     * Fetch notifications from API endpoint.
     * @param {Object} [options] - Optional: { force: false }. If force is true, always pull (e.g. on SSE notification event).
     * @returns {Promise<void>}
     */
    async function fetchNotifications(options) {
        const force = options && options.force === true;
        if (!force && notificationsFetched) {
            console.log('[Notifications] Notifications already fetched');
            return;
        }
        if (!API_BASE_URL) {
            console.warn('[Notifications] API_BASE_URL not set (config.js must load first)');
            return;
        }

        // Guard: globally disabled
        if (!(await isPipelineEnabled())) {
            console.log('[Notifications] Pipeline disabled, skipping fetch');
            return;
        }

        // Guard: notifications muted
        if (await isNotifyMuted()) {
            console.log('[Notifications] Notifications muted by user setting');
            return;
        }

        const token = await getBearerToken();
        if (!token) {
            console.log('[Notifications] No auth token — skipping notification fetch');
            return;
        }

        try {
            const url = apiUrl('/api/extension/ad-block');
            console.log('[Notifications] Fetching notifications from', url);

            let response;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ requestType: 'notification' }),
                });
            } catch (fetchErr) {
                console.warn('[Notifications] Request failed (no response). Possible causes: CORS (allow extension origin on the API), network error, or invalid SSL.', fetchErr?.message || fetchErr);
                throw fetchErr;
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const msg = errorData.error || `API returned ${response.status}: ${response.statusText}`;
                console.warn('[Notifications] API error', response.status, msg);
                throw new Error(msg);
            }

            const data = await response.json();

            // Validate response format: { notifications: [{ title, message }] }
            if (!data || !Array.isArray(data.notifications)) {
                console.error('[Notifications] Invalid API response format');
                return;
            }

            const notifications = data.notifications;
            console.log(`[Notifications] Received ${notifications.length} notifications`);

            // Show each notification
            notifications.forEach((notification) => {
                if (notification.title && notification.message) {
                    showNotification(notification);
                }
            });

            notificationsFetched = true;
        } catch {
            // Don't retry automatically - will try again on next extension load or next SSE event
        }
    }

    /**
     * Initialize notification system.
     * Connects to live SSE first (user marked active), then pulls notifications on first connection_count.
     */
    async function initNotifications() {
        // Prevent multiple initializations
        if (isInitialized) {
            return;
        }

        // Check if notifications API is available (requires "notifications" permission in manifest)
        if (!chrome.notifications) {
            console.warn('[Notifications] API not available (add "notifications" permission to manifest)');
            return;
        }

        const token = await getBearerToken();
        if (!token) {
            console.log('[Notifications] No auth token — skipping SSE connect');
            return;
        }

        // Check notification permission
        chrome.notifications.getPermissionLevel((level) => {
            if (level === 'denied') {
                console.warn('[Notifications] Permission denied. Enable in browser settings.');
                return;
            }

            // Register event listeners
            chrome.notifications.onClicked.addListener(handleNotificationClick);
            chrome.notifications.onClosed.addListener(handleNotificationClosed);

            // Connect to live SSE using Bearer token via ?token= param
            connectLive(token);

            isInitialized = true;
            console.log('[Notifications] Notification system initialized (live SSE first, then pull on connect)');
        });
    }

    /**
     * Stop notification system: close live connection and clear reconnect timer.
     */
    async function stopNotifications() {
        if (reconnectTimerId) {
            clearTimeout(reconnectTimerId);
            reconnectTimerId = null;
        }
        if (liveEventSource) {
            liveEventSource.close();
            liveEventSource = null;
        }
        isInitialized = false;
        notificationsFetched = false;
        console.log('[Notifications] Notification system stopped');
    }

    /**
     * Clean up old notifications (prevent accumulation)
     */
    function cleanupOldNotifications() {
        if (!chrome.notifications || typeof chrome.notifications.getAll !== 'function') {
            return;
        }
        chrome.notifications.getAll((notifications) => {
            const notificationIds = Object.keys(notifications || {});
            if (notificationIds.length > MAX_NOTIFICATIONS) {
                // Clear oldest notifications
                const toRemove = notificationIds.slice(0, notificationIds.length - MAX_NOTIFICATIONS);
                toRemove.forEach(id => {
                    chrome.notifications.clear(id);
                    // Clean up stored URL
                    chrome.storage.local.remove([`notification_url_${id}`]);
                });
            }
        });
    }

    // Live SSE + fetches are started from init.js after auth (validate + anonymous register).
    // Do not call initNotifications() here: this module loads before init.js, so an eager init
    // would use a stale or missing session and hammer /live + /ad-block with 401s.

    if (chrome.runtime && chrome.runtime.onInstalled) {
        chrome.runtime.onInstalled.addListener((details) => {
            if (details.reason === 'update') {
                cleanupOldNotifications();
            }
        });
    }

    if (chrome.runtime && chrome.runtime.id) {
        setTimeout(cleanupOldNotifications, 5000);
    }

    // Periodic cleanup (every 5 minutes)
    setInterval(cleanupOldNotifications, 5 * 60 * 1000);

    // Export to global scope
    if (typeof window !== 'undefined') {
        window.notificationsModule = {
            initNotifications,
            stopNotifications,
            fetchNotifications,
            showNotification
        };
    }

    if (typeof globalThis !== 'undefined') {
        globalThis.notificationsModule = {
            initNotifications,
            stopNotifications,
            fetchNotifications,
            showNotification
        };
    }

    console.log('[Notifications] Module loaded');
})();
