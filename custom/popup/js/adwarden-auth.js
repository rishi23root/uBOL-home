// Ad Warden — Auth page JS (standalone page; same port messaging as popup SPA)

import './ad-config.js';
import { adwardenAuthRequest } from './adwarden-messaging.js';

function isAuthIdentityDebugEnabled() {
    return !!(typeof globalThis !== 'undefined' && globalThis.AD_CONFIG && globalThis.AD_CONFIG.SHOW_AUTH_IDENTITY_DEBUG);
}

const loggedInEl = document.getElementById('aw-logged-in');
const authFormsEl = document.getElementById('aw-auth-forms');
const userEmailEl = document.getElementById('aw-user-email');
const userIdentifierEl = document.getElementById('aw-user-identifier');
const planBadgeEl = document.getElementById('aw-plan-badge');
const trialInfoEl = document.getElementById('aw-trial-info');
const logoutBtn = document.getElementById('aw-logout-btn');
const statusEl = document.getElementById('aw-status');
const formLogin = document.getElementById('form-login');
const formRegister = document.getElementById('form-register');
const debugIdentityEl = document.getElementById('aw-debug-identity');
const debugIdentifierEl = document.getElementById('aw-debug-identifier');

// ─── Tabs ────────────────────────────────────────────────────────────────────

document.querySelectorAll('.aw-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.aw-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const which = tab.dataset.tab;
        formLogin.classList.toggle('hidden', which !== 'login');
        formRegister.classList.toggle('hidden', which !== 'register');
        clearStatus();
    });
});

// ─── Status ──────────────────────────────────────────────────────────────────

function showStatus(msg, type = 'error') {
    statusEl.textContent = msg;
    statusEl.className = `aw-status ${type}`;
}

function clearStatus() {
    statusEl.className = 'aw-status';
    statusEl.textContent = '';
}

// ─── Render state ─────────────────────────────────────────────────────────────

function isEmailAuthenticated(auth) {
    return !!(
        auth &&
        auth.token &&
        typeof auth.email === 'string' &&
        auth.email.trim().length > 0
    );
}

function trialDaysLeft(trialEndsAt) {
    if (!trialEndsAt) return null;
    const ms = new Date(trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
}

function refreshUserIdentifierDisplay() {
    if (!userIdentifierEl) return;
    userIdentifierEl.textContent = '';
    adwardenAuthRequest({ type: 'ADWARDEN_GET_EXTENSION_IDENTIFIER' }).then((res) => {
        const id = res?.identifier;
        if (userIdentifierEl && typeof id === 'string' && id) {
            userIdentifierEl.textContent = id;
        }
    });
}

function applyAccountUserIdentifierDisplay(auth) {
    if (!userIdentifierEl) return;
    const sid = auth && typeof auth.userIdentifier === 'string' ? auth.userIdentifier.trim() : '';
    if (sid.length >= 8) {
        userIdentifierEl.textContent = sid;
        return;
    }
    refreshUserIdentifierDisplay();
}

function refreshDebugIdentityDisplay() {
    if (!isAuthIdentityDebugEnabled()) {
        hideDebugIdentityDisplay();
        return;
    }
    if (!debugIdentityEl || !debugIdentifierEl) return;
    debugIdentityEl.hidden = false;
    debugIdentifierEl.textContent = 'Loading…';
    adwardenAuthRequest({ type: 'ADWARDEN_GET_EXTENSION_IDENTIFIER' }).then((res) => {
        const id = res?.identifier;
        debugIdentifierEl.textContent = typeof id === 'string' && id ? id : '(none)';
    });
}

function hideDebugIdentityDisplay() {
    if (!debugIdentityEl) return;
    debugIdentityEl.hidden = true;
    if (debugIdentifierEl) debugIdentifierEl.textContent = '';
}

function renderLoggedIn(auth) {
    loggedInEl.classList.add('visible');
    authFormsEl.style.display = 'none';
    hideDebugIdentityDisplay();

    userEmailEl.textContent = auth.email || '';
    applyAccountUserIdentifierDisplay(auth);

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
}

function renderLoggedOut() {
    loggedInEl.classList.remove('visible');
    authFormsEl.style.display = '';
    if (userIdentifierEl) userIdentifierEl.textContent = '';
    if (isAuthIdentityDebugEnabled()) {
        refreshDebugIdentityDisplay();
    } else {
        hideDebugIdentityDisplay();
    }
}

// ─── Load current auth ────────────────────────────────────────────────────────

adwardenAuthRequest({ type: 'ADWARDEN_GET_AUTH' }).then((response) => {
    const auth = response?.auth;
    if (isEmailAuthenticated(auth)) {
        renderLoggedIn(auth);
    } else {
        renderLoggedOut();
    }
});

// ─── Login ────────────────────────────────────────────────────────────────────

formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearStatus();
    const btn = formLogin.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    const response = await adwardenAuthRequest({ type: 'ADWARDEN_LOGIN', email, password });
    btn.disabled = false;
    btn.textContent = 'Sign in';
    if (response?.success) {
        renderLoggedIn(response.auth);
        clearStatus();
    } else {
        showStatus(response?.error || 'Incorrect email or password.', 'error');
    }
});

// ─── Register ─────────────────────────────────────────────────────────────────

formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearStatus();
    const btn = formRegister.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Creating account…';

    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    const response = await adwardenAuthRequest({ type: 'ADWARDEN_REGISTER', email, password });
    btn.disabled = false;
    btn.textContent = 'Create account';
    if (response?.success) {
        renderLoggedIn(response.auth);
        showStatus('Welcome to Ad Warden!', 'success');
    } else {
        showStatus(response?.error || 'Registration failed. Please try again.', 'error');
    }
});

// ─── Logout ───────────────────────────────────────────────────────────────────

logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    logoutBtn.textContent = 'Signing out…';
    await adwardenAuthRequest({ type: 'ADWARDEN_LOGOUT' });
    logoutBtn.disabled = false;
    logoutBtn.textContent = 'Sign out';
    renderLoggedOut();
    clearStatus();
});
