// Ad Warden — Auth page JS (standalone page; same port messaging as popup SPA)

import { adwardenAuthRequest } from './adwarden-messaging.js';

const loggedInEl = document.getElementById('aw-logged-in');
const authFormsEl = document.getElementById('aw-auth-forms');
const userEmailEl = document.getElementById('aw-user-email');
const planBadgeEl = document.getElementById('aw-plan-badge');
const trialInfoEl = document.getElementById('aw-trial-info');
const logoutBtn = document.getElementById('aw-logout-btn');
const statusEl = document.getElementById('aw-status');
const formLogin = document.getElementById('form-login');
const formRegister = document.getElementById('form-register');

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

function trialDaysLeft(trialEndsAt) {
    if (!trialEndsAt) return null;
    const ms = new Date(trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
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
}

function renderLoggedOut() {
    loggedInEl.classList.remove('visible');
    authFormsEl.style.display = '';
}

// ─── Load current auth ────────────────────────────────────────────────────────

adwardenAuthRequest({ type: 'ADWARDEN_GET_AUTH' }).then((response) => {
    if (response?.auth) {
        renderLoggedIn(response.auth);
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
