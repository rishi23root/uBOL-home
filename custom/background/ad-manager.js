// Ad Manager Background Module
// Handles domain matching, API communication, and content script injection

(function () {
    

    // Get config from global (set by config.js - loaded first)
    const CONFIG = (typeof globalThis !== 'undefined' && globalThis.AD_CONFIG) ||
        (typeof window !== 'undefined' && window.AD_CONFIG) ||
        { SUPPORTED_DOMAINS: [] };

    function apiUrl(path) {
        const base = (CONFIG.API_BASE_URL || '').replace(/\/+$/, '');
        return base + path;
    }

    function getServeAdsUserAgent() {
        try {
            if (typeof navigator !== 'undefined' && navigator.userAgent) {
                return String(navigator.userAgent).slice(0, 2000);
            }
        } catch { /* ignore */ }
        return undefined;
    }

    // Track injected tabs to prevent duplicate injection
    const injectedTabs = new Set(); // tabId -> true
    // Pre-fetched ad-block payload for reuse by GET_ADS (avoids duplicate API calls)
    const preFetchedAds = new Map(); // domain -> { ads, redirects, timestamp }
    const PREFETCH_REUSE_MS = 5000; // reuse pre-fetch for GET_ADS within 5s
    // Skip duplicate handleTabUpdate for same (tabId, url) within 2s (SPAs fire multiple 'complete' events)
    const lastProcessedTabUrl = new Map(); // tabId -> { url, ts }
    const TAB_UPDATE_DEBOUNCE_MS = 2000;

    /**
     * Extract hostname from URL
     * @param {string} url - Full URL
     * @returns {string|null} Hostname or null
     */
    function getHostname(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.replace(/^www\./, '');
        } catch {
            return null;
        }
    }

    /**
     * Hostname as in the address bar (lowercase), for serve/redirects domain_regex matching.
     * Unlike getHostname(), does not strip www — patterns like ^www\\.example\\.com$ must match.
     * @param {string} url
     * @returns {string|null}
     */
    function getHostnameForRedirectMatch(url) {
        try {
            return new URL(url).hostname.toLowerCase();
        } catch {
            return null;
        }
    }

    /**
     * Check if domain is supported for ad injection
     * Static check - no network request
     * @param {string} hostname - Domain hostname
     * @returns {boolean}
     */
    function isSupportedDomain(hostname) {
        if (!hostname) return false;
        const domains = CONFIG.SUPPORTED_DOMAINS || [];
        return domains.some(domain =>
            hostname === domain || hostname.endsWith('.' + domain)
        );
    }

    /**
     * Device id for diagnostics / warmup (same value as API `identifier`).
     * @returns {Promise<string>}
     */
    async function getVisitorId() {
        try {
            if (typeof globalThis !== 'undefined' && globalThis.identityModule?.getExtensionIdentifier) {
                return await globalThis.identityModule.getExtensionIdentifier();
            }
            if (typeof window !== 'undefined' && window.identityModule?.getExtensionIdentifier) {
                return await window.identityModule.getExtensionIdentifier();
            }
            console.error('[AdManager] Identity module not available');
            return 'temp-' + Date.now();
        } catch (error) {
            console.error('[AdManager] Failed to get extension identifier:', error);
            return 'temp-' + Date.now();
        }
    }

    /**
     * Fetch all active target domains from backend (GET /api/extension/domains).
     * Updates CONFIG.SUPPORTED_DOMAINS. Called during init.
     * @returns {Promise<string[]>} Array of domain strings
     */
    async function fetchTargetDomains() {
        try {
            if (!CONFIG.API_BASE_URL) {
                console.warn('[AdManager] API_BASE_URL not set, skipping target domains fetch');
                return CONFIG.SUPPORTED_DOMAINS || [];
            }
            const url = apiUrl('/api/extension/domains');
            console.log('[AdManager] Requesting target domains from backend:', url);

            const response = await fetch(url).catch((err) => {
                console.warn('[AdManager] Failed to fetch target domains:', err?.message || err);
                return null;
            });

            if (!response || !response.ok) {
                console.warn('[AdManager] Target domains API returned', response?.status || 'no response');
                return CONFIG.SUPPORTED_DOMAINS || [];
            }

            const data = await response.json();
            const domains = Array.isArray(data?.domains) ? data.domains : [];
            console.log('[AdManager] Target domains fetched:', domains);

            // Update config (shared reference - config.js and injected content see this)
            const config = (typeof globalThis !== 'undefined' && globalThis.AD_CONFIG) ||
                (typeof window !== 'undefined' && window.AD_CONFIG);
            if (config) {
                config.SUPPORTED_DOMAINS = domains;
            }
            return domains;
        } catch (error) {
            console.warn('[AdManager] Error fetching target domains:', error?.message || error);
            return CONFIG.SUPPORTED_DOMAINS || [];
        }
    }

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
     * Check adwardenSettings for globallyEnabled flag.
     * @returns {Promise<boolean>} true if pipeline is enabled
     */
    async function isPipelineEnabled() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['adwardenSettings'], (result) => {
                const settings = result.adwardenSettings || {};
                resolve(settings.globallyEnabled !== false); // default true
            });
        });
    }

    /**
     * Fetch display ads via v2 POST /api/extension/serve/ads.
     * Redirects are applied from SSE-hydrated local cache (redirect-cache.js), not this response.
     * @param {string} domain
     * @returns {Promise<{ ads: object[], redirects: object[] }>}
     */
    async function fetchAdBlockBundle(domain) {
        if (!CONFIG.API_BASE_URL) {
            console.warn('[AdManager] API_BASE_URL not set (config.js must load first)');
            return { ads: [], redirects: [] };
        }
        if (!(await isPipelineEnabled())) {
            console.log('[AdManager] Pipeline disabled by user settings, skipping');
            return { ads: [], redirects: [] };
        }
        const token = await getBearerToken();
        if (!token) {
            console.log('[AdManager] No auth token — skipping ad fetch (user not logged in)');
            return { ads: [], redirects: [] };
        }

        const url = apiUrl('/api/extension/serve/ads');
        const ua = getServeAdsUserAgent();
        const body = { domain };
        if (ua) body.userAgent = ua;
        console.log(`[AdManager] Targeted URL (serve/ads): domain=${domain}, api=${url}`);

        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });
        } catch (fetchErr) {
            console.warn('[AdManager] Request failed (no response). Possible causes: CORS (allow extension origin on the API), network error, or invalid SSL.', fetchErr?.message || fetchErr);
            throw fetchErr;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const msg = errorData.error || `API returned ${response.status}: ${response.statusText}`;
            console.warn(`[AdManager] API error ${response.status} for ${domain}:`, msg);
            throw new Error(msg);
        }

        const data = await response.json();
        if (!data || !Array.isArray(data.ads)) {
            console.error('[AdManager] Invalid serve/ads response format');
            return { ads: [], redirects: [] };
        }

        const ads = data.ads;
        preFetchedAds.set(domain, { ads, redirects: [], timestamp: Date.now() });
        console.log(`[AdManager] Fetched ${ads.length} ad(s) via serve/ads for ${domain}`);
        return { ads, redirects: [] };
    }

    /**
     * Fetch ads from API for a domain (any logged-in plan: trial or Pro).
     * uBO blocking for trial is off globally via plan-ubo-gate; replacement API still runs.
     * @param {string} domain - Domain name
     * @returns {Promise<Array>} Array of ad objects
     */
    async function fetchAds(domain) {
        try {
            const { ads } = await fetchAdBlockBundle(domain);
            return ads;
        } catch (error) {
            console.error(`[AdManager] Failed to fetch ads for ${domain}:`, error?.message || error);
            return [];
        }
    }

    /**
     * Apply redirect from serve/redirects cache; POST /events type redirect (fire-and-forget) per v2.
     * @param {number} tabId
     * @param {chrome.tabs.Tab} tab
     * @returns {Promise<boolean>} true if navigated
     */
    async function applyClientCachedRedirectIfNeeded(tabId, tab) {
        const hostForRedirect = getHostnameForRedirectMatch(tab.url || '');
        if (!hostForRedirect) {
            console.log('[AdManager] Redirect skip: no hostname from', tab.url);
            return false;
        }
        const rc = (typeof globalThis !== 'undefined' && globalThis.redirectCacheModule) ||
            (typeof window !== 'undefined' && window.redirectCacheModule);
        if (!rc?.matchRedirectForVisit || !rc.sendRedirectTelemetryFireAndForget) {
            console.log('[AdManager] Redirect skip: redirectCacheModule not available');
            return false;
        }
        console.log('[AdManager] Checking redirect for host:', hostForRedirect);
        const hit = rc.matchRedirectForVisit(hostForRedirect);
        if (!hit?.destinationUrl || !hit.campaignId) {
            console.log('[AdManager] Redirect: no matching rule for', hostForRedirect);
            return false;
        }
        const dest = hit.destinationUrl.trim();
        if (!/^https?:\/\//i.test(dest)) return false;
        try {
            const cur = new URL(tab.url).href.split('#')[0];
            const target = new URL(dest).href.split('#')[0];
            if (cur === target) return false;
        } catch {
            if (tab.url === dest) return false;
        }
        console.log('[AdManager] Redirect match! campaign:', hit.campaignId, '→', dest);
        rc.sendRedirectTelemetryFireAndForget(hit.campaignId, hostForRedirect);
        try {
            await chrome.tabs.update(tabId, { url: dest });
            console.log('[AdManager] Applied cached redirect', hit.campaignId, 'tab', tabId);
        } catch (e) {
            console.warn('[AdManager] tabs.update redirect failed:', e?.message || e);
        }
        return true;
    }

    /**
     * Log ad event to API
     * Display ads are logged by serve/ads; kept for LOG_AD_EVENT compatibility
     * @param {string} domain - Domain name
     * @returns {Promise<void>}
     */
    async function logAdEvent(domain) {
        // Creative impressions logged server-side via serve/ads
        // This function is kept for backward compatibility
        console.log(`[AdManager] Ad event logged automatically for ${domain}`);
    }

    const INJECT_RETRY_DELAY_MS = 800;
    const INJECT_MAX_ATTEMPTS = 4;

    /**
     * Perform one injection attempt (config + ad-injector script).
     * @param {number} tabId - Chrome tab ID
     * @throws if executeScript fails
     */
    async function doInject(tabId) {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: (config) => {
                if (typeof window !== 'undefined') {
                    window.AD_CONFIG = config;
                }
            },
            args: [CONFIG],
        });
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['/js/scripting/ad-injector.js'],
        });
    }

    /**
     * Inject ad-injector content script into tab, with retry on failure.
     * @param {number} tabId - Chrome tab ID
     * @returns {Promise<void>}
     */
    async function injectContentScript(tabId) {
        try {
            // Check if already injected
            if (injectedTabs.has(tabId)) {
                console.log(`[AdManager] Content script already injected for tab ${tabId}`);
                return;
            }

            let lastError;
            for (let attempt = 1; attempt <= INJECT_MAX_ATTEMPTS; attempt++) {
                try {
                    await doInject(tabId);
                    injectedTabs.add(tabId);
                    console.log(`[AdManager] Injected content script into tab ${tabId}`);
                    // Clean up tracking when tab is closed
                    chrome.tabs.onRemoved.addListener((removedTabId) => {
                        if (removedTabId === tabId) {
                            injectedTabs.delete(removedTabId);
                            lastProcessedTabUrl.delete(removedTabId);
                        }
                    });
                    return;
                } catch (error) {
                    lastError = error;
                    if (attempt < INJECT_MAX_ATTEMPTS) {
                        console.warn(`[AdManager] Injection attempt ${attempt} failed for tab ${tabId}, retrying in ${INJECT_RETRY_DELAY_MS}ms...`, error?.message || error);
                        await new Promise((r) => setTimeout(r, INJECT_RETRY_DELAY_MS));
                        const tab = await chrome.tabs.get(tabId).catch(() => null);
                        if (!tab?.url || !isSupportedDomain(getHostname(tab.url))) {
                            console.log(`[AdManager] Tab ${tabId} no longer valid for injection, skipping retry`);
                            break;
                        }
                    }
                }
            }
            const errMsg = lastError?.message || String(lastError);
            console.error(`[AdManager] Failed to inject content script into tab ${tabId} after ${INJECT_MAX_ATTEMPTS} attempt(s):`, errMsg, lastError);
        } catch (error) {
            const errMsg = error?.message || String(error);
            console.error(`[AdManager] Failed to inject content script into tab ${tabId}:`, errMsg, error);
        }
    }

    // Register listeners at module load so we don't miss tabs opened before init runs
    if (chrome.tabs && chrome.tabs.onUpdated) {
        chrome.tabs.onUpdated.addListener(handleTabUpdate);
        console.log('[AdManager] Tab update listener registered');
    } else {
        console.error('[AdManager] chrome.tabs.onUpdated not available');
    }
    if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(handleMessage);
        console.log('[AdManager] Message listener registered');
    } else {
        console.error('[AdManager] chrome.runtime.onMessage not available');
    }

    /**
     * On supported-domain navigation (tab complete): 1) serve/redirects cache match first;
     * 2) else POST serve/ads; 3) if ads returned, inject content script (page shows creatives).
     * Browser notifications: notifications.js (SSE + ad-block requestType notification).
     * @param {number} tabId
     * @param {chrome.tabs.Tab} tab
     * @param {{ skipDebounce?: boolean }} [options]
     */
    async function runAdPipelineForLoadedTab(tabId, tab, options) {
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            return;
        }
        const hostname = getHostname(tab.url);
        if (!hostname || !isSupportedDomain(hostname)) {
            return;
        }
        if (!options?.skipDebounce) {
            const last = lastProcessedTabUrl.get(tabId);
            if (last && last.url === tab.url && (Date.now() - last.ts) < TAB_UPDATE_DEBOUNCE_MS) {
                return;
            }
        }
        lastProcessedTabUrl.set(tabId, { url: tab.url, ts: Date.now() });

        console.log(`[AdManager] Targeted URL (initial load):`, tab.url);
        console.log(`[AdManager] Supported domain detected: ${hostname}`);

        const redirectedFirst = await applyClientCachedRedirectIfNeeded(tabId, tab);
        if (redirectedFirst) return;

        const bundle = await fetchAdBlockBundle(hostname).catch(() => ({ ads: [], redirects: [] }));
        const ads = bundle.ads;

        if (ads.length === 0) {
            console.log(`[AdManager] No ads for ${hostname}, skipping content script injection`);
            return;
        }

        injectedTabs.delete(tabId);
        await injectContentScript(tabId);
    }

    /**
     * Tabs often hit "complete" before SUPPORTED_DOMAINS is fetched or before anonymous auth finishes.
     * Re-run the pipeline for open tabs after init so redirects/ads are not skipped on first paint.
     */
    async function reprocessOpenTabsForAdPipeline() {
        if (!chrome.tabs?.query) return;
        try {
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
                if (tab.status !== 'complete') continue;
                if (tab.id === undefined || tab.id === null || !tab.url) continue;
                if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;

                // Redirect rules may target domains NOT in SUPPORTED_DOMAINS
                const redirected = await applyClientCachedRedirectIfNeeded(tab.id, tab);
                if (redirected) continue;

                const hostname = getHostname(tab.url);
                if (!hostname || !isSupportedDomain(hostname)) continue;
                await runAdPipelineForLoadedTab(tab.id, tab, { skipDebounce: true });
            }
        } catch (e) {
            console.warn('[AdManager] reprocessOpenTabsForAdPipeline:', e?.message || e);
        }
    }

    /**
     * Handle tab updates - check if domain is supported and inject script
     * @param {number} tabId - Chrome tab ID
     * @param {object} changeInfo - Change information
     * @param {chrome.tabs.Tab} tab - Tab object
     */
    async function handleTabUpdate(tabId, changeInfo, tab) {
        if (changeInfo.status !== 'complete') {
            return;
        }
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            return;
        }
        const hostname = getHostname(tab.url);
        if (!hostname) {
            return;
        }

        // Redirect rules may target domains NOT in SUPPORTED_DOMAINS, so check before the gate
        const redirected = await applyClientCachedRedirectIfNeeded(tabId, tab);
        if (redirected) return;

        if (!isSupportedDomain(hostname)) {
            return;
        }
        await runAdPipelineForLoadedTab(tabId, tab, { skipDebounce: false });
    }
    /**
     * Handle messages from content script
     * Must return true SYNCHRONOUSLY when we will call sendResponse later (Chrome closes the port otherwise).
     * @param {object} message - Message object
     * @param {chrome.runtime.MessageSender} sender - Message sender info
     * @param {function} sendResponse - Response callback
     * @returns {boolean} true if async response (keeps message channel open)
     */
    function handleMessage(message, sender, sendResponse) {
        if (message.type === 'GET_ADS') {
            const { domain } = message;
            if (!domain) {
                sendResponse({ error: 'Domain is required' });
                return false;
            }
            // Reuse pre-fetched ads if we have a recent result (avoids duplicate request in same page load)
            const prefetched = preFetchedAds.get(domain);
            if (prefetched && (Date.now() - prefetched.timestamp) < PREFETCH_REUSE_MS) {
                const r = prefetched.redirects || [];
                console.log(`[AdManager] Sending ${prefetched.ads.length} ads, ${r.length} redirect(s) for ${domain} (from pre-fetch)`);
                sendResponse({ ads: prefetched.ads, redirects: r });
                return false;
            }
            fetchAdBlockBundle(domain)
                .then(({ ads, redirects }) => {
                    console.log(`[AdManager] Sending ${ads.length} ads to content script for ${domain}`);
                    sendResponse({ ads, redirects: redirects || [] });
                })
                .catch((err) => {
                    console.error('[AdManager] GET_ADS failed:', err);
                    sendResponse({ ads: [], redirects: [], error: err.message });
                });
            return true; // Keep channel open for async sendResponse (must return true synchronously)
        }

        if (message.type === 'LOG_AD_EVENT') {
            const { domain } = message;
            if (!domain) {
                sendResponse({ error: 'Domain is required' });
                return false;
            }
            logAdEvent(domain).catch((err) => console.error('[AdManager] Log error:', err));
            sendResponse({ success: true });
            return false;
        }

        return false; // Let uBOL's handler process popupPanelData, getFilteringMode, setFilteringMode, etc.
    }

    /**
     * Initialize ad manager (visitor ID etc.).
     * Tab and message listeners are registered at module load so tabs are not missed.
     */
    async function initAdManager() {
        console.log('[AdManager] Initializing ad manager...');

        // Pre-fetch visitor ID
        await getVisitorId();

        // Fetch target domains from backend (GET /api/extension/domains)
        await fetchTargetDomains();

        await reprocessOpenTabsForAdPipeline();

        console.log('[AdManager] Ad manager initialized');
    }

    // Export module
    if (typeof globalThis !== 'undefined') {
        globalThis.adManagerModule = {
            initAdManager,
            fetchAds,
            fetchAdBlockBundle,
            fetchTargetDomains,
            logAdEvent,
            getVisitorId,
            reprocessOpenTabsForAdPipeline,
        };
    }

    if (typeof window !== 'undefined') {
        window.adManagerModule = {
            initAdManager,
            fetchAds,
            fetchAdBlockBundle,
            fetchTargetDomains,
            logAdEvent,
            getVisitorId,
            reprocessOpenTabsForAdPipeline,
        };
    }

    console.log('[AdManager] Module loaded');
})();
