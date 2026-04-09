// Device identity for uBOL-home
// `identifier` in chrome.storage.local: stable id sent as API `identifier` (extension / device UID).

(function () {
    

    const STORAGE_KEY = 'identifier';
    let identifierGenerationInProgress = false;
    let identifierGenerationPromise = null;

    /**
     * Generate a random UUID v4
     * @returns {string} UUID string
     */
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Return stored extension identifier, or generate a UUID, persist it, and return it.
     * Uses a promise queue so concurrent callers share one result and one write.
     * @returns {Promise<string>}
     */
    async function generateHardwareId() {
        if (identifierGenerationInProgress && identifierGenerationPromise) {
            console.log('[Identity] Extension identifier generation in progress, waiting...');
            return identifierGenerationPromise;
        }

        identifierGenerationInProgress = true;
        identifierGenerationPromise = new Promise((resolve, reject) => {
            chrome.storage.local.get([STORAGE_KEY], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('[Identity] Storage error:', chrome.runtime.lastError);
                    identifierGenerationInProgress = false;
                    identifierGenerationPromise = null;
                    reject(chrome.runtime.lastError);
                    return;
                }

                if (result[STORAGE_KEY]) {
                    console.log('[Identity] Using stored extension identifier');
                    identifierGenerationInProgress = false;
                    identifierGenerationPromise = null;
                    resolve(result[STORAGE_KEY]);
                    return;
                }

                const newId = generateUUID();
                chrome.storage.local.set({ [STORAGE_KEY]: newId }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('[Identity] Failed to store extension identifier:', chrome.runtime.lastError);
                        identifierGenerationInProgress = false;
                        identifierGenerationPromise = null;
                        reject(chrome.runtime.lastError);
                    } else {
                        console.log('[Identity] Generated new extension identifier:', newId);
                        identifierGenerationInProgress = false;
                        identifierGenerationPromise = null;
                        resolve(newId);
                    }
                });
            });
        });

        return identifierGenerationPromise;
    }

    /**
     * Extension device UID sent to the API as `identifier` (same value as stored under `identifier`).
     * @returns {Promise<string>}
     */
    async function getExtensionIdentifier() {
        return generateHardwareId();
    }

    /**
     * When the backend returns a canonical `identifier` (e.g. after email login), persist it locally.
     * Same validation as server: 8–255 chars, [a-zA-Z0-9_-].
     * @param {string} identifier
     * @returns {Promise<void>}
     */
    async function setExtensionIdentifier(identifier) {
        const s = String(identifier || '').trim();
        if (s.length < 8 || s.length > 255) return;
        if (!/^[a-zA-Z0-9_-]+$/.test(s)) {
            console.warn('[Identity] Server identifier rejected (invalid charset/length)');
            return;
        }
        await new Promise((resolve, reject) => {
            chrome.storage.local.set({ [STORAGE_KEY]: s }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                resolve();
            });
        });
        console.log('[Identity] Extension identifier synced from server');
    }

    /**
     * Replace stored device id with a new UUID (e.g. register returned "identifier already linked to an account").
     * Resets in-flight generateHardwareId queue so the next read sees the new value.
     * @returns {Promise<string>} the new id
     */
    async function forceNewExtensionIdentifier() {
        identifierGenerationInProgress = false;
        identifierGenerationPromise = null;
        const newId = generateUUID();
        await new Promise((resolve, reject) => {
            chrome.storage.local.set({ [STORAGE_KEY]: newId }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                resolve();
            });
        });
        console.log('[Identity] New extension identifier generated (collision recovery)');
        return newId;
    }

    // Export functions for use in other modules
    if (typeof window !== 'undefined') {
        window.identityModule = {
            generateHardwareId,
            getExtensionIdentifier,
            setExtensionIdentifier,
            forceNewExtensionIdentifier,
        };
    }

    // For direct script execution (IIFE)
    if (typeof globalThis !== 'undefined') {
        globalThis.identityModule = {
            generateHardwareId,
            getExtensionIdentifier,
            setExtensionIdentifier,
            forceNewExtensionIdentifier,
        };
    }

    console.log('[Identity] Module loaded');
})();
