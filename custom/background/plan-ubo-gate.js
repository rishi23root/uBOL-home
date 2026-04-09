// Ad Warden - Trial / guest vs Pro uBO filtering
// Trial or not logged in: force filtering off globally and clear per-host overrides (MODE_NONE everywhere).
// Pro: restore backed-up filtering graph (or legacy: default level only).

(function () {
    

    const BACKUP_LEVEL_KEY = 'adwarden_ubo_backup_all_urls_level';
    const BACKUP_DETAILS_KEY = 'adwarden_ubo_backup_filtering_details';
    const TRIAL_ACTIVE_KEY = 'adwarden_trial_ubo_gate_active';

    const GUEST_MODE_DETAILS = Object.freeze({
        none: ['all-urls'],
        basic: [],
        optimal: [],
        complete: [],
    });

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
            } catch {
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

    function isSerializableModeDetails(d) {
        if (!d || typeof d !== 'object') return false;
        const { none, basic, optimal, complete } = d;
        return [none, basic, optimal, complete].every((a) => Array.isArray(a));
    }

    // Prefer direct SW calls (background imports this file); sendMessage does not reach the same worker.
    async function getFilteringModeDetailsSerializable() {
        const d =
            typeof globalThis.adwardenUboGetFilteringModeDetails === 'function'
                ? await globalThis.adwardenUboGetFilteringModeDetails()
                : await uboSend({ what: 'getFilteringModeDetails' });
        if (!isSerializableModeDetails(d)) return null;
        return {
            none: d.none.slice(),
            basic: d.basic.slice(),
            optimal: d.optimal.slice(),
            complete: d.complete.slice(),
        };
    }

    async function setFilteringModeDetails(modes) {
        const out =
            typeof globalThis.adwardenUboSetFilteringModeDetails === 'function'
                ? await globalThis.adwardenUboSetFilteringModeDetails(modes)
                : await uboSend({ what: 'setFilteringModeDetails', modes });
        return isSerializableModeDetails(out) ? out : null;
    }

    async function getTrialGateMeta() {
        return new Promise((resolve) => {
            chrome.storage.local.get([BACKUP_LEVEL_KEY, BACKUP_DETAILS_KEY, TRIAL_ACTIVE_KEY], (r) => {
                const raw = r[BACKUP_DETAILS_KEY];
                resolve({
                    backup: typeof r[BACKUP_LEVEL_KEY] === 'number' ? r[BACKUP_LEVEL_KEY] : null,
                    backupDetails: isSerializableModeDetails(raw) ? raw : null,
                    trialActive: !!r[TRIAL_ACTIVE_KEY],
                });
            });
        });
    }

    async function markTrialGating(backupLevel, detailsBackup) {
        await new Promise((resolve) => {
            chrome.storage.local.remove(BACKUP_DETAILS_KEY, () => resolve());
        });
        const payload = { [TRIAL_ACTIVE_KEY]: true };
        if (backupLevel !== null && backupLevel !== undefined) payload[BACKUP_LEVEL_KEY] = backupLevel;
        if (detailsBackup) payload[BACKUP_DETAILS_KEY] = detailsBackup;
        return new Promise((resolve) => chrome.storage.local.set(payload, resolve));
    }

    async function clearTrialGating() {
        return new Promise((resolve) =>
            chrome.storage.local.remove([BACKUP_LEVEL_KEY, BACKUP_DETAILS_KEY, TRIAL_ACTIVE_KEY], resolve),
        );
    }

    /** Returns true when every site has filtering off (same shape as GUEST_MODE_DETAILS). */
    function isAllOff(details) {
        if (!details) return true;
        return (
            Array.isArray(details.none) && details.none.includes('all-urls') &&
            (!details.basic || details.basic.length === 0) &&
            (!details.optimal || details.optimal.length === 0) &&
            (!details.complete || details.complete.length === 0)
        );
    }

    async function restoreProFiltering(meta) {
        // Use the backup only when it actually has filtering enabled.
        // If the backup is itself "all off" (e.g. was snapshotted while guest gate was active),
        // fall through to the default so the user always gets filtering on login.
        if (meta.backupDetails && !isAllOff(meta.backupDetails)) {
            await setFilteringModeDetails(meta.backupDetails);
            console.log('[PlanUboGate] Restored filtering mode details from backup');
        } else {
            // No useful backup — turn on complete filtering for all sites by default.
            const applied = await setFilteringModeDetails({
                none: [],
                basic: [],
                optimal: [],
                complete: ['all-urls'],
            });
            if (!applied) {
                await setAllUrlsLevel(3);
                console.warn('[PlanUboGate] setFilteringModeDetails failed; fell back to setAllUrlsLevel(3)');
            }
            console.log('[PlanUboGate] Applied default complete filtering (no useful backup)');
        }
        await clearTrialGating();
    }

    /**
     * Guest / logged-out: always push uBO to global none + no per-host overrides.
     * Backup prior graph only on first transition into gated state (!trialActive), so Pro restore still works.
     */
    async function enterTrialGlobalOff() {
        const meta = await getTrialGateMeta();

        let backup = null;
        let detailsBackup = null;
        if (!meta.trialActive) {
            detailsBackup = await getFilteringModeDetailsSerializable();
            const level = await getAllUrlsLevel();
            backup = level !== null && level !== undefined && level > 0 ? level : null;
        }

        const applied = await setFilteringModeDetails({
            none: [...GUEST_MODE_DETAILS.none],
            basic: [],
            optimal: [],
            complete: [],
        });
        if (!applied) {
            await setAllUrlsLevel(0);
            console.warn('[PlanUboGate] setFilteringModeDetails failed; fell back to all-urls only');
        }

        if (!meta.trialActive) {
            await markTrialGating(backup, detailsBackup);
        }

        console.log(
            '[PlanUboGate] Guest filtering applied (reassert:',
            !!meta.trialActive,
            'backed up:',
            !meta.trialActive,
            ')',
        );
    }

    /**
     * @param {object|null} auth - null when logged out
     */
    async function syncFromAuth(auth) {
        try {
            const isEmailLoggedIn = !!(
                auth &&
                auth.token &&
                typeof auth.email === 'string' &&
                auth.email.trim().length > 0
            );

            if (!isEmailLoggedIn) {
                await enterTrialGlobalOff();
                return;
            }

            // Email-authenticated user: always ensure filtering is on.
            // Run regardless of trialActive so a SW restart while logged in
            // (where trialActive may be false) still gets filtering restored.
            const meta = await getTrialGateMeta();
            await restoreProFiltering(meta);
        } catch (e) {
            console.warn('[PlanUboGate] syncFromAuth error:', e?.message || e);
        }
    }

    globalThis.adwardenPlanUboGate = { syncFromAuth };

    // Run before init's delayed startup so default uBO modes do not block until validateToken runs.
    (async function applyUboFromStoredAuthEarly() {
        try {
            const authMod = globalThis.authModule;
            if (!authMod || typeof authMod.getAuth !== 'function') return;
            const auth = await authMod.getAuth();
            await syncFromAuth(auth?.token ? auth : null);
        } catch (e) {
            console.warn('[PlanUboGate] Early guest sync:', e?.message || e);
        }
    })();

    console.log('[PlanUboGate] Module loaded');
})();
