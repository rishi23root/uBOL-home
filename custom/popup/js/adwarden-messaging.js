/**
 * Ad Warden auth messaging via chrome.runtime.connect.
 * Avoids a race with uBO's onMessage listener, which calls sendResponse() for
 * unhandled messages (e.g. ADWARDEN_LOGIN has no `what` field), often before
 * auth.js finishes async login and would win over our sendResponse.
 */

const PORT_NAME = 'adwarden-auth';

function getRuntime() {
    if (typeof chrome !== 'undefined' && chrome.runtime) return chrome.runtime;
    if (typeof browser !== 'undefined' && browser.runtime) return browser.runtime;
    return null;
}

/**
 * @param {object} payload e.g. { type: 'ADWARDEN_LOGIN', email, password }
 * @returns {Promise<object>} Response from background (shape depends on type)
 */
export function adwardenAuthRequest(payload) {
    const rt = getRuntime();
    return new Promise((resolve) => {
        if (!rt?.connect) {
            resolve({ success: false, error: 'Extension runtime not available' });
            return;
        }
        let settled = false;
        let port;
        try {
            port = rt.connect({ name: PORT_NAME });
        } catch (e) {
            resolve({ success: false, error: e?.message || 'connect failed' });
            return;
        }
        const finish = (data) => {
            if (settled) return;
            settled = true;
            try {
                port.disconnect();
            } catch {
                /* ignore */
            }
            resolve(data ?? {});
        };
        port.onMessage.addListener((msg) => {
            finish(msg);
        });
        port.onDisconnect.addListener(() => {
            if (settled) return;
            const err = rt.lastError;
            finish({ success: false, error: err?.message || 'Disconnected' });
        });
        try {
            port.postMessage(payload);
        } catch (e) {
            finish({ success: false, error: e?.message || 'postMessage failed' });
        }
    });
}
