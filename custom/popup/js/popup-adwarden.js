/**
 * Ad Warden - Popup SPA (sidebar + Home / Block list / Account)
 * uBO APIs: popupPanelData, setFilteringMode, getFilteringModeDetails
 */

import { browser } from './popup-ext.js';
import { adwardenAuthRequest } from './adwarden-messaging.js';

const extRuntime = typeof chrome !== 'undefined' && chrome?.runtime ? chrome.runtime : browser?.runtime;

const MODE_LABELS = ['None', 'Basic', 'Optimal', 'Complete'];

// ─── DOM: Home ───────────────────────────────────────────────────────────────
const toggleEl = document.getElementById('adwarden-toggle');
const countEl = document.getElementById('adwarden-count');
const hostnameEl = document.getElementById('adwarden-hostname');
const statusOnOffEl = document.getElementById('adwarden-status-onoff');
const closeEl = document.getElementById('adwarden-close');
const planPillEl = document.getElementById('adwarden-plan-pill');
const modeValueEl = document.getElementById('aw-mode-value');
const homeInsightsEl = document.getElementById('aw-home-insights');
const insightBroadEl = document.getElementById('aw-insight-broad');

// ─── DOM: Navigation ─────────────────────────────────────────────────────────
const navButtons = document.querySelectorAll('.aw-nav-btn[data-view]');
const accountNavDot = document.getElementById('aw-nav-account-dot');

// ─── DOM: Allowlist ──────────────────────────────────────────────────────────
const allowlistListEl = document.getElementById('aw-allowlist-list');
const allowlistStatusEl = document.getElementById('aw-allowlist-status');
const allowlistAddCurrentBtn = document.getElementById('aw-allowlist-add-current');
const closeFromAllow = document.getElementById('aw-close-from-allow');

// ─── DOM: Account ────────────────────────────────────────────────────────────
const loggedInEl = document.getElementById('aw-logged-in');
const authFormsEl = document.getElementById('aw-auth-forms');
const userEmailEl = document.getElementById('aw-user-email');
const planBadgeEl = document.getElementById('aw-plan-badge');
const trialInfoEl = document.getElementById('aw-trial-info');
const logoutBtn = document.getElementById('aw-logout-btn');
const paymentPlansBtn = document.getElementById('aw-payment-plans-btn');
const paymentPlansHintEl = document.getElementById('aw-payment-plans-hint');
const statusEl = document.getElementById('aw-status');
const formLogin = document.getElementById('form-login');
const formRegister = document.getElementById('form-register');
const loginPasswordToggle = document.getElementById('login-password-toggle');
const loginPasswordInput = document.getElementById('login-password');
const switchRegisterBtn = document.getElementById('aw-switch-register');
const switchLoginBtn = document.getElementById('aw-switch-login');
const authHeadingEl = document.getElementById('aw-auth-heading');
const authSubEl = document.getElementById('aw-auth-sub');
const footerLoginRow = document.getElementById('aw-footer-login');
const footerRegisterRow = document.getElementById('aw-footer-register');
const closeFromAccount = document.getElementById('aw-close-from-account');

let currentTab = null;
let hostname = '';
let level = 1;
let autoReload = false;
let isHTTP = false;
let isToggling = false;

/** Retry sendMessage (service worker may be evicted). */
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
        } catch {
            if (i === maxAttempts - 1) return undefined;
        }
        await new Promise((res) => setTimeout(res, 80 * (i + 1)));
    }
    return undefined;
}

// ─── Auth shell: pending (boot) → member | guest ─────────────────────────────

function authState() {
    return document.body.dataset.authState || 'pending';
}

function isPendingShell() {
    return authState() === 'pending';
}

function isGuestShell() {
    return authState() === 'guest';
}

function isMemberShell() {
    return authState() === 'member';
}

function setShellMember() {
    document.body.dataset.authState = 'member';
}

function setShellGuest() {
    document.body.dataset.authState = 'guest';
}

// ─── View router ─────────────────────────────────────────────────────────────

function showView(name) {
    if (isPendingShell()) {
        return;
    }
    if (isGuestShell() && name !== 'account') {
        return;
    }

    document.querySelectorAll('.aw-view').forEach((panel) => {
        const id = panel.id.replace('view-', '');
        const active = id === name;
        panel.classList.toggle('is-active', active);
        panel.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (id === 'boot') {
            panel.setAttribute('aria-busy', active ? 'true' : 'false');
        }
    });
    navButtons.forEach((btn) => {
        const active = btn.dataset.view === name;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-current', active ? 'page' : 'false');
    });

    if (name === 'allowlist') {
        loadAllowlist().catch(() => {});
    } else if (name === 'account') {
        refreshAccountPanel();
    }
}

navButtons.forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
});

function onPanelClose() {
    window.close();
}

[closeEl, closeFromAllow, closeFromAccount].forEach((el) => {
    if (el) el.addEventListener('click', onPanelClose);
});

// ─── Home: render & load ─────────────────────────────────────────────────────

function setInsightValue(el, on, yesLabel = 'Yes', noLabel = 'No') {
    if (!el) return;
    el.textContent = on ? yesLabel : noLabel;
    el.classList.remove('is-on', 'is-off', 'is-muted');
    if (on) el.classList.add('is-on');
    else el.classList.add('is-off');
}

function clearHomeInsights() {
    if (homeInsightsEl) homeInsightsEl.hidden = true;
    if (insightBroadEl) {
        insightBroadEl.textContent = '—';
        insightBroadEl.classList.remove('is-on', 'is-off', 'is-muted');
        insightBroadEl.classList.add('is-muted');
    }
}

function applyHomeInsightsFromPanel(response) {
    if (!homeInsightsEl || !response) {
        clearHomeInsights();
        return;
    }
    const broad = !!(response.hasOmnipotence || response.hasGreatPowers);
    setInsightValue(insightBroadEl, broad, 'On', 'Off');
    homeInsightsEl.hidden = false;
}

function renderHomeToggle() {
    const on = level > 0;
    toggleEl.setAttribute('aria-checked', String(on));
    toggleEl.classList.toggle('on', on);
    if (statusOnOffEl) {
        statusOnOffEl.textContent = on ? 'ON' : 'OFF';
    }
    if (modeValueEl && typeof level === 'number') {
        modeValueEl.textContent = MODE_LABELS[level] ?? String(level);
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

/** Sync active tab URL context (hostname, isHTTP) without re-fetching popup panel. */
async function refreshActiveTabContext() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    currentTab = tab ?? null;
    if (!tab?.url) {
        hostname = '';
        isHTTP = false;
        return;
    }
    try {
        const url = new URL(tab.url);
        isHTTP = url.protocol === 'http:' || url.protocol === 'https:';
        hostname = url.hostname;
    } catch {
        hostname = '';
        isHTTP = false;
    }
}

async function loadHome() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
        clearHomeInsights();
        if (countEl) countEl.textContent = '—';
        if (hostnameEl) hostnameEl.textContent = '—';
        toggleEl.disabled = true;
        if (modeValueEl) modeValueEl.textContent = '—';
        renderHomeToggle();
        return;
    }

    currentTab = tab;
    let url;
    try {
        url = new URL(tab.url);
    } catch {
        clearHomeInsights();
        if (countEl) countEl.textContent = '—';
        if (hostnameEl) hostnameEl.textContent = '—';
        toggleEl.disabled = true;
        renderHomeToggle();
        return;
    }

    isHTTP = url.protocol === 'http:' || url.protocol === 'https:';
    hostname = url.hostname;

    if (hostnameEl) hostnameEl.textContent = hostname || '—';

    if (!isHTTP) {
        clearHomeInsights();
        if (countEl) countEl.textContent = '—';
        toggleEl.disabled = true;
        if (modeValueEl) modeValueEl.textContent = '—';
        renderHomeToggle();
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
    applyHomeInsightsFromPanel(response);

    const count = await fetchBadgeCount();
    if (countEl) {
        countEl.textContent = count;
        countEl.classList.add('updated');
    }

    renderHomeToggle();
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
    renderHomeToggle();

    let origin = '';
    try {
        origin = currentTab?.url ? new URL(currentTab.url).origin : '';
    } catch {
        /* ignore */
    }
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

    renderHomeToggle();

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

toggleEl.addEventListener('click', onToggleClick);

// ─── Allowlist ───────────────────────────────────────────────────────────────

function displayLabelForHostname(hn) {
    if (hn === 'all-urls') return 'All sites (filtering off everywhere)';
    return hn;
}

/** Whether allowlist entry covers the active tab (exact host or global). */
function allowlistEntryMatchesTab(entry, tabHostname, tabIsHTTP) {
    if (!tabIsHTTP || !tabHostname) return false;
    if (entry === 'all-urls') return true;
    return entry === tabHostname;
}

function tabIsOnAllowlist(none, tabHostname, tabIsHTTP) {
    if (!Array.isArray(none) || !tabIsHTTP || !tabHostname) return false;
    if (none.includes('all-urls')) return true;
    return none.includes(tabHostname);
}

function syncAllowlistAddCurrentButton(none) {
    if (!allowlistAddCurrentBtn) return;
    const list = Array.isArray(none) ? none : [];
    if (!isHTTP || !hostname) {
        allowlistAddCurrentBtn.disabled = true;
        allowlistAddCurrentBtn.textContent = 'Turn off filtering for current site';
        allowlistAddCurrentBtn.title = 'Open an http(s) page in the active tab.';
        return;
    }
    if (tabIsOnAllowlist(list, hostname, isHTTP)) {
        allowlistAddCurrentBtn.disabled = true;
        allowlistAddCurrentBtn.textContent = 'Filtering already off for this site';
        allowlistAddCurrentBtn.title = list.includes('all-urls')
            ? 'Ad filtering is off on all sites.'
            : `Ad filtering is already off on ${hostname}.`;
        return;
    }
    allowlistAddCurrentBtn.disabled = false;
    allowlistAddCurrentBtn.textContent = 'Turn off filtering for current site';
    allowlistAddCurrentBtn.title = `Stop ad blocking on ${hostname}`;
}

async function loadAllowlist() {
    if (!allowlistListEl || !allowlistStatusEl) return;
    allowlistStatusEl.textContent = '';
    allowlistStatusEl.classList.remove('success');

    await refreshActiveTabContext();

    const details = await sendMessageWithRetry({ what: 'getFilteringModeDetails' });

    const none = Array.isArray(details?.none) ? [...details.none] : [];
    none.sort((a, b) => {
        if (a === 'all-urls') return -1;
        if (b === 'all-urls') return 1;
        return a.localeCompare(b);
    });

    allowlistListEl.innerHTML = '';

    if (none.length === 0) {
        const p = document.createElement('p');
        p.className = 'aw-empty-hint';
        p.textContent = 'No sites on the list — ad filtering is on everywhere.';
        allowlistListEl.appendChild(p);
        syncAllowlistAddCurrentButton(none);
        return;
    }

    for (const hn of none) {
        const row = document.createElement('div');
        row.className = 'aw-list-row';
        if (allowlistEntryMatchesTab(hn, hostname, isHTTP)) {
            row.classList.add('aw-list-row-current');
            row.title = 'Current tab — ad filtering is off here';
        }

        const name = document.createElement('span');
        name.className = 'aw-list-row-name';
        name.textContent = displayLabelForHostname(hn);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'aw-btn-small';
        btn.textContent = 'Turn filtering on';
        btn.title = 'Enable ad blocking for this site again';
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
                await sendMessageWithRetry({
                    what: 'setFilteringMode',
                    hostname: hn,
                    level: 3,
                });
                if (autoReload && currentTab?.id && (hn === hostname || hn === 'all-urls')) {
                    setTimeout(() => browser.tabs.reload(currentTab.id), 250);
                }
                await loadAllowlist();
                await loadHome();
            } catch {
                allowlistStatusEl.textContent = 'Could not change filtering for this site.';
            } finally {
                btn.disabled = false;
            }
        });

        row.appendChild(name);
        row.appendChild(btn);
        allowlistListEl.appendChild(row);
    }

    syncAllowlistAddCurrentButton(none);
}

if (allowlistAddCurrentBtn) {
    allowlistAddCurrentBtn.addEventListener('click', async () => {
        await refreshActiveTabContext();
        if (!isHTTP || !hostname) {
            allowlistStatusEl.textContent = 'No website active in this tab.';
            const details = await sendMessageWithRetry({ what: 'getFilteringModeDetails' });
            const none = Array.isArray(details?.none) ? [...details.none] : [];
            syncAllowlistAddCurrentButton(none);
            return;
        }
        allowlistAddCurrentBtn.disabled = true;
        try {
            const details = await sendMessageWithRetry({ what: 'getFilteringModeDetails' });
            const none = Array.isArray(details?.none) ? [...details.none] : [];
            if (tabIsOnAllowlist(none, hostname, isHTTP)) {
                await loadAllowlist();
                return;
            }
            allowlistStatusEl.textContent = '';
            await sendMessageWithRetry({
                what: 'setFilteringMode',
                hostname,
                level: 0,
            });
            if (autoReload && currentTab?.id) {
                setTimeout(() => browser.tabs.reload(currentTab.id), 250);
            }
            await loadAllowlist();
            await loadHome();
        } catch {
            allowlistStatusEl.textContent = 'Could not turn off filtering for this site.';
            await loadAllowlist();
        }
    });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function trialDaysLeft(trialEndsAt) {
    if (!trialEndsAt) return null;
    const ms = new Date(trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
}

function renderPlanPill(auth) {
    if (!planPillEl) return;
    if (!auth) {
        planPillEl.textContent = 'Sign in';
        planPillEl.className = 'adwarden-plan-pill';
        if (accountNavDot) accountNavDot.hidden = false;
        return;
    }
    if (accountNavDot) accountNavDot.hidden = true;
    const days = auth.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(auth.trialEndsAt).getTime() - Date.now()) / 86400000))
        : null;
    const isPaid = auth.plan === 'paid' || auth.plan === 'active';
    const isExpired = !isPaid && days !== null && days <= 0;

    if (isPaid) {
        planPillEl.textContent = 'Pro';
        planPillEl.className = 'adwarden-plan-pill paid';
    } else if (isExpired) {
        planPillEl.textContent = 'Expired';
        planPillEl.className = 'adwarden-plan-pill expired';
    } else {
        planPillEl.textContent = days !== null ? `Trial · ${days}d` : 'Trial';
        planPillEl.className = 'adwarden-plan-pill trial';
    }
}

function showAuthStatus(msg, type = 'error') {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = `aw-status ${type}`;
    statusEl.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
}

function clearAuthStatus() {
    if (!statusEl) return;
    statusEl.className = 'aw-status';
    statusEl.textContent = '';
    statusEl.setAttribute('aria-live', 'polite');
}

function getPaymentPlansUrl() {
    const fromPopup = typeof globalThis !== 'undefined' && globalThis.ADWARDEN_POPUP?.PAYMENT_PLANS_URL;
    const fromConfig = typeof globalThis !== 'undefined' && globalThis.AD_CONFIG?.PAYMENT_PLANS_URL;
    const raw = (fromPopup || fromConfig || '').trim();
    return raw;
}

function renderLoggedIn(auth) {
    loggedInEl.classList.add('visible');
    authFormsEl.style.display = 'none';

    userEmailEl.textContent = auth.email || '';

    const days = trialDaysLeft(auth.trialEndsAt);
    const isPaid = auth.plan === 'paid' || auth.plan === 'active';
    const isExpired = !isPaid && days !== null && days <= 0;

    if (isPaid) {
        planBadgeEl.textContent = 'Pro';
        planBadgeEl.className = 'aw-plan-badge paid';
        trialInfoEl.textContent = '';
    } else if (isExpired) {
        planBadgeEl.textContent = 'Expired';
        planBadgeEl.className = 'aw-plan-badge expired';
        trialInfoEl.textContent = 'Your free trial has expired. Upgrade to continue.';
    } else {
        planBadgeEl.textContent = 'Trial';
        planBadgeEl.className = 'aw-plan-badge trial';
        trialInfoEl.innerHTML =
            days !== null
                ? `Free trial: <strong>${days} day${days === 1 ? '' : 's'} left</strong>`
                : 'Free trial active';
    }
    if (paymentPlansBtn) {
        paymentPlansBtn.hidden = isPaid;
        paymentPlansBtn.disabled = false;
        paymentPlansBtn.title = getPaymentPlansUrl()
            ? 'Open payment plans in a new tab'
            : 'Checkout URL not configured — opens a message when clicked';
    }
    if (paymentPlansHintEl) {
        paymentPlansHintEl.hidden = true;
        paymentPlansHintEl.textContent = '';
    }
    renderPlanPill(auth);
}

/** Sign-in vs create-account copy and bottom links */
function syncAuthTabUI(which) {
    if (!authHeadingEl || !authSubEl || !footerLoginRow || !footerRegisterRow) return;
    if (which === 'register') {
        authHeadingEl.textContent = 'Create your account';
        authSubEl.textContent = 'Sign up with email and password';
        footerLoginRow.classList.add('hidden');
        footerRegisterRow.classList.remove('hidden');
    } else {
        authHeadingEl.textContent = 'Enter your Email & Password';
        authSubEl.textContent = 'Login to your account';
        footerLoginRow.classList.remove('hidden');
        footerRegisterRow.classList.add('hidden');
    }
}

function renderLoggedOut() {
    loggedInEl.classList.remove('visible');
    authFormsEl.style.display = '';
    if (paymentPlansHintEl) {
        paymentPlansHintEl.hidden = true;
        paymentPlansHintEl.textContent = '';
    }
    renderPlanPill(null);
    document.querySelectorAll('.aw-tab').forEach((t) => t.classList.remove('active'));
    document.getElementById('tab-login')?.classList.add('active');
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
    syncAuthTabUI('login');
}

async function refreshAccountPanel() {
    const response = await adwardenAuthRequest({ type: 'ADWARDEN_GET_AUTH' });
    if (response?.auth) {
        renderLoggedIn(response.auth);
    } else {
        renderLoggedOut();
    }
}

document.querySelectorAll('.aw-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.aw-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const which = tab.dataset.tab;
        formLogin.classList.toggle('hidden', which !== 'login');
        formRegister.classList.toggle('hidden', which !== 'register');
        syncAuthTabUI(which === 'register' ? 'register' : 'login');
        clearAuthStatus();
    });
});

formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthStatus();
    formLogin.setAttribute('aria-busy', 'true');
    const btn = formLogin.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    const prevHtml = btn.innerHTML;
    btn.textContent = 'Signing in…';

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    const response = await adwardenAuthRequest({ type: 'ADWARDEN_LOGIN', email, password });
    formLogin.removeAttribute('aria-busy');
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    btn.innerHTML = prevHtml;
    if (response?.success) {
        renderLoggedIn(response.auth);
        clearAuthStatus();
        setShellMember();
        showView('home');
        loadHome();
        startCountPolling();
    } else {
        showAuthStatus(response?.error || 'Incorrect email or password.', 'error');
    }
});

formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthStatus();
    formRegister.setAttribute('aria-busy', 'true');
    const btn = formRegister.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    const prevText = btn.textContent;
    btn.textContent = 'Creating account…';

    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    const response = await adwardenAuthRequest({ type: 'ADWARDEN_REGISTER', email, password });
    formRegister.removeAttribute('aria-busy');
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    btn.textContent = prevText;
    if (response?.success) {
        renderLoggedIn(response.auth);
        clearAuthStatus();
        setShellMember();
        showView('home');
        loadHome();
        startCountPolling();
    } else {
        showAuthStatus(response?.error || 'Registration failed. Please try again.', 'error');
    }
});

if (paymentPlansBtn) {
    paymentPlansBtn.addEventListener('click', () => {
        const url = getPaymentPlansUrl();
        if (!url) {
            if (paymentPlansHintEl) {
                paymentPlansHintEl.textContent = 'Checkout URL is not configured yet.';
                paymentPlansHintEl.hidden = false;
            }
            return;
        }
        if (paymentPlansHintEl) {
            paymentPlansHintEl.hidden = true;
            paymentPlansHintEl.textContent = '';
        }
        try {
            browser.tabs?.create?.({ url, active: true });
        } catch {
            /* ignore */
        }
    });
}

logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    const prev = logoutBtn.textContent;
    logoutBtn.textContent = 'Signing out…';
    await adwardenAuthRequest({ type: 'ADWARDEN_LOGOUT' });
    logoutBtn.disabled = false;
    logoutBtn.textContent = prev;
    renderLoggedOut();
    clearAuthStatus();
    setShellGuest();
    showView('account');
    stopCountPolling();
});

if (loginPasswordToggle && loginPasswordInput) {
    loginPasswordToggle.addEventListener('click', () => {
        const reveal = loginPasswordInput.type === 'password';
        loginPasswordInput.type = reveal ? 'text' : 'password';
        loginPasswordToggle.classList.toggle('is-revealed', reveal);
        loginPasswordToggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    });
}

if (switchRegisterBtn) {
    switchRegisterBtn.addEventListener('click', () => {
        document.getElementById('tab-register')?.click();
    });
}

if (switchLoginBtn) {
    switchLoginBtn.addEventListener('click', () => {
        document.getElementById('tab-login')?.click();
    });
}

extRuntime?.onMessage?.addListener((message) => {
    if (message?.type !== 'ADWARDEN_AUTH_CHANGED') return;
    adwardenAuthRequest({ type: 'ADWARDEN_GET_AUTH' }).then((response) => {
        const auth = response?.auth;
        if (auth) {
            setShellMember();
            renderLoggedIn(auth);
            renderPlanPill(auth);
            showView('home');
            loadHome();
            startCountPolling();
        } else {
            setShellGuest();
            renderLoggedOut();
            renderPlanPill(null);
            showView('account');
            stopCountPolling();
        }
    });
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

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
        if (isMemberShell()) {
            if (!isToggling) loadHome();
            startCountPolling();
        }
        if (isMemberShell() && document.querySelector('#view-allowlist.is-active')) {
            loadAllowlist().catch(() => {});
        }
    } else {
        stopCountPolling();
    }
});

async function bootstrapAuth() {
    const response = await adwardenAuthRequest({ type: 'ADWARDEN_GET_AUTH' });
    const auth = response?.auth;
    if (auth) {
        setShellMember();
        renderLoggedIn(auth);
        renderPlanPill(auth);
        showView('home');
        await loadHome();
        startCountPolling();
    } else {
        setShellGuest();
        renderLoggedOut();
        renderPlanPill(null);
        showView('account');
    }
}

bootstrapAuth();
