/**
 * Ad Warden - Popup UI
 * Uses uBlock Origin's APIs: popupPanelData, setFilteringMode, action.getBadgeText
 * Octagon toggle, "Ad Blocking is ON/OFF", "You blocked X Ads & Trackers on domain.com"
 */

import { browser, runtime, sendMessage } from './popup-ext.js';

const toggleEl = document.getElementById('adwarden-toggle');
const countEl = document.getElementById('adwarden-count');
const hostnameEl = document.getElementById('adwarden-hostname');
const statusOnOffEl = document.getElementById('adwarden-status-onoff');
const closeEl = document.getElementById('adwarden-close');

let currentTab = null;
let hostname = '';
let level = 1;
let autoReload = false;
let isHTTP = false;
let isToggling = false;

/** Retry sendMessage (service worker may be evicted). Uses callback API for reliability. */
async function sendMessageWithRetry(msg, maxAttempts = 5) {
    const r = browser?.runtime ?? chrome?.runtime;
    if (!r) return undefined;
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const result = await new Promise((resolve, reject) => {
                r.sendMessage(msg, (response) => {
                    const err = r.lastError;
                    if (err) reject(new Error(err.message || 'Message failed'));
                    else resolve(response);
                });
            });
            if (result !== undefined && result !== null) return result;
        } catch (e) {
            if (i === maxAttempts - 1) return undefined;
        }
        await new Promise(r => setTimeout(r, 80 * (i + 1)));
    }
    return undefined;
}

function render() {
    const on = level > 0;
    toggleEl.setAttribute('aria-checked', String(on));
    toggleEl.classList.toggle('on', on);
    if (statusOnOffEl) {
        statusOnOffEl.textContent = on ? 'ON' : 'OFF';
    }
}

async function fetchBadgeCount() {
    if (!currentTab?.id) return '0';
    try {
        const action = browser?.action ?? browser?.browserAction;
        if (!action?.getBadgeText) return '0';
        const text = await action.getBadgeText({ tabId: currentTab.id });
        return text && text !== '' ? text : '0';
    } catch {
        return '0';
    }
}

async function refreshCount() {
    if (!countEl || !isHTTP) return;
    const count = await fetchBadgeCount();
    if (countEl.textContent !== count) {
        countEl.textContent = count;
        countEl.classList.add('updated');
    }
}

async function load() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
        if (countEl) countEl.textContent = '—';
        if (hostnameEl) hostnameEl.textContent = '—';
        toggleEl.disabled = true;
        render();
        return;
    }

    currentTab = tab;
    let url;
    try {
        url = new URL(tab.url);
    } catch {
        if (countEl) countEl.textContent = '—';
        if (hostnameEl) hostnameEl.textContent = '—';
        toggleEl.disabled = true;
        render();
        return;
    }

    isHTTP = url.protocol === 'http:' || url.protocol === 'https:';
    hostname = url.hostname;

    if (hostnameEl) hostnameEl.textContent = hostname || '—';

    if (!isHTTP) {
        if (countEl) countEl.textContent = '—';
        toggleEl.disabled = true;
        render();
        return;
    }

    toggleEl.disabled = false;

    const response = await sendMessageWithRetry({
        what: 'popupPanelData',
        origin: url.origin,
        hostname,
    });

    if (response && typeof response.level === 'number') {
        level = response.level;
        autoReload = !!response.autoReload;
    }

    const count = await fetchBadgeCount();
    if (countEl) {
        countEl.textContent = count;
        countEl.classList.add('updated');
    }

    render();
}

async function setFilteringLevel(newLevel) {
    if (!isHTTP || !hostname || isToggling) return;
    isToggling = true;
    const beforeLevel = level;

    if (newLevel > 1 && beforeLevel <= 1) {
        sendMessageWithRetry({
            what: 'setPendingFilteringMode',
            tabId: currentTab?.id,
            url: currentTab?.url,
            hostname,
            beforeLevel,
            afterLevel: newLevel,
        });
        let granted = false;
        try {
            granted = await browser.permissions.request({
                origins: [`*://*.${hostname}/*`],
            });
        } catch {
            /* ignore */
        }
        if (!granted) {
            newLevel = beforeLevel;
        }
    }

    level = newLevel;
    render();

    let origin = '';
    try {
        origin = currentTab?.url ? new URL(currentTab.url).origin : '';
    } catch { }
    await sendMessageWithRetry({ what: 'popupPanelData', origin, hostname });

    const actualLevel = await sendMessageWithRetry({
        what: 'setFilteringMode',
        hostname,
        level: newLevel,
    });

    if (typeof actualLevel === 'number') {
        level = actualLevel;
    } else {
        const fetched = await sendMessageWithRetry({ what: 'getFilteringMode', hostname });
        level = typeof fetched === 'number' ? fetched : beforeLevel;
    }

    render();

    if (level !== beforeLevel && autoReload && currentTab?.id) {
        setTimeout(() => {
            browser.tabs.reload(currentTab.id);
        }, 300);
    }

    setTimeout(() => refreshCount(), 200);

    isToggling = false;
}

async function onToggleClick(ev) {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    if (toggleEl.disabled) return;
    const newLevel = level === 0 ? 3 : 0;
    await setFilteringLevel(newLevel);
}

function onCloseClick() {
    window.close();
}

toggleEl.addEventListener('click', onToggleClick);
if (closeEl) {
    closeEl.addEventListener('click', onCloseClick);
}

let countRefreshInterval = null;

function startCountPolling() {
    if (countRefreshInterval) clearInterval(countRefreshInterval);
    countRefreshInterval = setInterval(refreshCount, 1500);
}

function stopCountPolling() {
    if (countRefreshInterval) {
        clearInterval(countRefreshInterval);
        countRefreshInterval = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (!isToggling) load();
        startCountPolling();
    } else {
        stopCountPolling();
    }
});

load();
startCountPolling();
