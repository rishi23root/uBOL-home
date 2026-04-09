// Batched visit telemetry: POST /api/extension/events (type: visit)
// See admin_dashboard EXTENSION_V2_API.md — flush when queue has 5+ items or on 60s interval.

(function () {
    

    function getApiBase() {
        const c = (typeof globalThis !== 'undefined' && globalThis.AD_CONFIG) ||
            (typeof window !== 'undefined' && window.AD_CONFIG) ||
            {};
        return (c.API_BASE_URL || '').replace(/\/+$/, '');
    }

    function apiUrl(path) {
        return getApiBase() + path;
    }

    const VISIT_FLUSH_MIN = 5;
    const FLUSH_INTERVAL_MS = 60 * 1000;

    /** @type {{ domain: string, visitedAt: string }[]} */
    let queue = [];
    let periodicTimerId = null;
    let started = false;

    async function isPipelineEnabled() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['adwardenSettings'], (result) => {
                const settings = result.adwardenSettings || {};
                resolve(settings.globallyEnabled !== false);
            });
        });
    }

    function shouldRecordUrl(url) {
        if (!url || typeof url !== 'string') return false;
        const u = url.toLowerCase();
        if (
            u.startsWith('chrome://') ||
            u.startsWith('chrome-extension://') ||
            u.startsWith('about:') ||
            u.startsWith('edge://') ||
            u.startsWith('devtools://') ||
            u.startsWith('view-source:')
        ) {
            return false;
        }
        return true;
    }

    function hostnameFromUrl(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch {
            return '';
        }
    }

    async function flushVisits() {
        if (queue.length === 0) return;
        if (!(await isPipelineEnabled())) {
            queue = [];
            return;
        }
        const authModule = (typeof globalThis !== 'undefined' && globalThis.authModule) ||
            (typeof window !== 'undefined' && window.authModule);
        const token = authModule ? await authModule.getToken() : null;
        if (!token || !getApiBase()) {
            return;
        }

        const chunk = queue.splice(0, 50);
        const events = chunk.map((v) => {
            const ev = { type: 'visit', domain: v.domain };
            if (v.visitedAt) ev.visitedAt = v.visitedAt;
            return ev;
        });

        try {
            const res = await fetch(apiUrl('/api/extension/events'), {
                method: 'POST',
                cache: 'no-store',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ events }),
                keepalive: true,
            });
            if (!res.ok) {
                console.warn('[VisitTracker] events HTTP', res.status);
                queue.unshift(...chunk);
            }
        } catch (e) {
            console.warn('[VisitTracker] flush failed:', e?.message || e);
            queue.unshift(...chunk);
        }
    }

    function onTabUpdated(_tabId, changeInfo, tab) {
        if (changeInfo.status !== 'complete' || !tab?.url) return;
        if (!shouldRecordUrl(tab.url)) return;
        const domain = hostnameFromUrl(tab.url);
        if (!domain) return;

        (async () => {
            if (!(await isPipelineEnabled())) return;
            const authModule = (typeof globalThis !== 'undefined' && globalThis.authModule) ||
                (typeof window !== 'undefined' && window.authModule);
            if (!authModule || !(await authModule.getToken())) return;

            queue.push({ domain, visitedAt: new Date().toISOString() });
            if (queue.length >= VISIT_FLUSH_MIN) {
                await flushVisits();
            }
        })().catch(() => {});
    }

    function startPeriodicFlush() {
        if (periodicTimerId !== null && periodicTimerId !== undefined) return;
        periodicTimerId = setInterval(() => {
            flushVisits().catch(() => {});
        }, FLUSH_INTERVAL_MS);
    }

    async function initVisitTracker() {
        if (started) return;
        started = true;
        if (chrome.tabs && chrome.tabs.onUpdated) {
            chrome.tabs.onUpdated.addListener(onTabUpdated);
        }
        startPeriodicFlush();
        try {
            if (chrome.runtime && chrome.runtime.onSuspend) {
                chrome.runtime.onSuspend.addListener(() => {
                    flushVisits().catch(() => {});
                });
            }
        } catch {}
        console.log('[VisitTracker] Module started');
    }

    const api = { initVisitTracker, flushVisits };

    if (typeof globalThis !== 'undefined') globalThis.adwardenVisitTracker = api;
    if (typeof window !== 'undefined') window.adwardenVisitTracker = api;

    console.log('[VisitTracker] Module loaded');
})();
