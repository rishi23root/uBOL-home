// Ad Warden - Trial vs Pro uBO global filtering
// Trial: force default filtering off (all-urls → MODE_NONE) so ads are not blocked globally.
// Pro: restore backed-up default level (or complete).
// Per-host "complete" rows can still filter while global is none — documented limitation.

(function () {
    'use strict';

    const BACKUP_LEVEL_KEY = 'adwarden_ubo_backup_all_urls_level';
    const TRIAL_ACTIVE_KEY = 'adwarden_trial_ubo_gate_active';

    function isProAuth(auth) {
        if (!auth || !auth.plan) return false;
        const p = String(auth.plan).toLowerCase();
        return p === 'paid' || p === 'active';
    }

    function uboSend(msg) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(msg, (r) => {
                    if (chrome.runtime.lastError) {
                        resolve(undefined);
                    } else {
                        resolve(r);
                    }
                });
            } catch (_) {
                resolve(undefined);
            }
        });
    }

    async function getAllUrlsLevel() {
        const level = await uboSend({ what: 'getFilteringMode', hostname: 'all-urls' });
        return typeof level === 'number' ? level : null;
    }

    async function setAllUrlsLevel(level) {
        const next = await uboSend({ what: 'setFilteringMode', hostname: 'all-urls', level });
        return typeof next === 'number' ? next : null;
    }

    async function getTrialGateMeta() {
        return new Promise((resolve) => {
            chrome.storage.local.get([BACKUP_LEVEL_KEY, TRIAL_ACTIVE_KEY], (r) => {
                resolve({
                    backup: typeof r[BACKUP_LEVEL_KEY] === 'number' ? r[BACKUP_LEVEL_KEY] : null,
                    trialActive: !!r[TRIAL_ACTIVE_KEY],
                });
            });
        });
    }

    async function markTrialGating(backupLevel) {
        const payload = { [TRIAL_ACTIVE_KEY]: true };
        if (backupLevel != null) payload[BACKUP_LEVEL_KEY] = backupLevel;
        return new Promise((resolve) => chrome.storage.local.set(payload, resolve));
    }

    async function clearTrialGating() {
        return new Promise((resolve) => chrome.storage.local.remove([BACKUP_LEVEL_KEY, TRIAL_ACTIVE_KEY], resolve));
    }

    async function restoreProFiltering(meta) {
        const target = meta.backup != null ? meta.backup : 3;
        await setAllUrlsLevel(target);
        await clearTrialGating();
        console.log('[PlanUboGate] Restored global filtering level:', target);
    }

    async function enterTrialGlobalOff() {
        const meta = await getTrialGateMeta();
        if (meta.trialActive) return;

        const level = await getAllUrlsLevel();
        const backup = level != null && level > 0 ? level : null;
        await setAllUrlsLevel(0);
        await markTrialGating(backup);
        console.log('[PlanUboGate] Trial: global filtering off (backed up level:', backup, ')');
    }

    /**
     * @param {object|null} auth - null when logged out
     */
    async function syncFromAuth(auth) {
        try {
            const hasUser = !!(auth && auth.token);
            const meta = await getTrialGateMeta();

            if (!hasUser) {
                if (meta.trialActive) {
                    await restoreProFiltering(meta);
                }
                return;
            }

            if (isProAuth(auth)) {
                if (meta.trialActive) {
                    await restoreProFiltering(meta);
                }
                return;
            }

            await enterTrialGlobalOff();
        } catch (e) {
            console.warn('[PlanUboGate] syncFromAuth error:', e?.message || e);
        }
    }

    globalThis.adwardenPlanUboGate = { syncFromAuth };
    console.log('[PlanUboGate] Module loaded');
})();
