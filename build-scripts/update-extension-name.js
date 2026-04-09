#!/usr/bin/env node
/**
 * Update extension name to "Ad Warden" in all locale files and manifests
 *
 * Usage:
 *   node update-extension-name.js
 */

import { REPO_ROOT } from './root-dir.js';
import fs from 'fs';
import path from 'path';

const UBOL_HOME_ROOT = REPO_ROOT;

const EXT_NAME = 'Ad Warden';
const EXT_SHORT_DESC = 'Content blocker for ads and trackers.';
const BLOCKED_PAGE_MESSAGE = 'Adwarden has prevented the following page from loading:';

/**
 * Find messages.json files only in custom-dist/chromium/_locales/ and custom-dist/firefox/_locales/
 * (excluding submodules and other directories)
 * Note: chromium/_locales/ and firefox/_locales/ are kept untouched
 */
function findMessagesFiles(rootDir) {
    const messagesFiles = [];
    const targetDirs = [
        path.join(rootDir, 'custom-dist', 'chromium', '_locales'),
        path.join(rootDir, 'custom-dist', 'firefox', '_locales')
    ];

    for (const targetDir of targetDirs) {
        if (!fs.existsSync(targetDir)) {
            continue;
        }

        function walkDir(dir) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    // Recursively walk locale subdirectories (e.g., en/, ar/, etc.)
                    walkDir(fullPath);
                } else if (entry.isFile() && entry.name === 'messages.json') {
                    messagesFiles.push(fullPath);
                }
            }
        }

        walkDir(targetDir);
    }

    return messagesFiles;
}

/**
 * Update extension name and short description in a messages.json file
 */
function updateMessages(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const messages = JSON.parse(content);
        let updated = false;
        const changes = [];

        if (messages.extName && messages.extName.message) {
            const oldName = messages.extName.message;
            messages.extName.message = EXT_NAME;
            updated = true;
            changes.push(`extName: ${oldName} → ${EXT_NAME}`);
        }

        if (messages.extShortDesc && messages.extShortDesc.message) {
            const oldDesc = messages.extShortDesc.message;
            messages.extShortDesc.message = EXT_SHORT_DESC;
            updated = true;
            changes.push(`extShortDesc: ${oldDesc} → ${EXT_SHORT_DESC}`);
        }

        if (messages.strictblockSentence1 && messages.strictblockSentence1.message) {
            const oldMsg = messages.strictblockSentence1.message;
            messages.strictblockSentence1.message = BLOCKED_PAGE_MESSAGE;
            updated = true;
            changes.push(`strictblockSentence1: "${oldMsg.substring(0, 20)}..." → Adwarden`);
        }

        if (messages.dashboardName && messages.dashboardName.message) {
            const old = messages.dashboardName.message;
            if (old.includes('uBO Lite') || old.includes('uBlock Origin Lite')) {
                messages.dashboardName.message = old
                    .replace(/uBlock Origin Lite/g, EXT_NAME)
                    .replace(/uBO Lite/g, EXT_NAME);
                updated = true;
                changes.push('dashboardName updated');
            }
        }

        if (messages.supportS6Select1Option3 && messages.supportS6Select1Option3.message) {
            const old = messages.supportS6Select1Option3.message;
            if (old.includes('uBO Lite') || old.includes('uBlock Origin')) {
                messages.supportS6Select1Option3.message = old
                    .replace(/uBlock Origin Lite/g, 'Adwarden')
                    .replace(/uBO Lite/g, 'Adwarden');
                updated = true;
                changes.push('supportS6Select1Option3 updated');
            }
        }

        if (messages.supportS6Select1Option5 && messages.supportS6Select1Option5.message) {
            const old = messages.supportS6Select1Option5.message;
            if (old.includes('uBO Lite') || old.includes('uBlock Origin')) {
                messages.supportS6Select1Option5.message = old
                    .replace(/uBlock Origin Lite/g, 'Adwarden')
                    .replace(/uBO Lite/g, 'Adwarden');
                updated = true;
                changes.push('supportS6Select1Option5 updated');
            }
        }

        if (messages.aboutPageName && messages.aboutPageName.message) {
            const old = messages.aboutPageName.message;
            if (old.includes('uBO Lite') || old.includes('uBlock Origin')) {
                messages.aboutPageName.message = old
                    .replace(/uBlock Origin Lite/g, 'Adwarden')
                    .replace(/uBO Lite/g, 'Adwarden');
                updated = true;
                changes.push('aboutPageName updated');
            }
        }

        if (updated) {
            const updatedContent = JSON.stringify(messages, null, 2) + '\n';
            fs.writeFileSync(filePath, updatedContent, 'utf8');
            return { updated: true, changes };
        }

        return { updated: false };
    } catch (error) {
        return { updated: false, error: error.message };
    }
}

/**
 * Update manifest short_name in custom-dist
 */
function updateManifest(manifestPath) {
    try {
        if (!fs.existsSync(manifestPath)) {
            return { updated: false };
        }
        const content = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(content);

        if (manifest.short_name !== EXT_NAME) {
            const oldShortName = manifest.short_name;
            manifest.short_name = EXT_NAME;
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
            return { updated: true, oldShortName };
        }
        return { updated: false };
    } catch (error) {
        return { updated: false, error: error.message };
    }
}

/**
 * Main function
 */
function main() {
    console.log(`📁 Updating extension branding to "${EXT_NAME}" in custom-dist/`);
    console.log(`   Root: ${UBOL_HOME_ROOT}\n`);

    let errorCount = 0;

    // Update messages.json files
    const messagesFiles = findMessagesFiles(UBOL_HOME_ROOT);
    if (messagesFiles.length > 0) {
        console.log(`📋 Found ${messagesFiles.length} messages.json file(s)\n`);
        for (const filePath of messagesFiles) {
            const result = updateMessages(filePath);
            const relativePath = path.relative(UBOL_HOME_ROOT, filePath);

            if (result.error) {
                console.error(`❌ ${relativePath}: ${result.error}`);
                errorCount++;
            } else if (result.updated) {
                console.log(`✅ ${relativePath} (${result.changes.join(', ')})`);
            }
        }
    } else {
        console.log('⚠️  No messages.json files found in custom-dist/');
    }

    // Update manifest short_name
    const manifestPaths = [
        path.join(UBOL_HOME_ROOT, 'custom-dist', 'chromium', 'manifest.json'),
        path.join(UBOL_HOME_ROOT, 'custom-dist', 'firefox', 'manifest.json')
    ];
    console.log('\n📋 Updating manifest short_name...');
    for (const manifestPath of manifestPaths) {
        const result = updateManifest(manifestPath);
        const relativePath = path.relative(UBOL_HOME_ROOT, manifestPath);

        if (result.error) {
            console.error(`❌ ${relativePath}: ${result.error}`);
            errorCount++;
        } else if (result.updated) {
            console.log(`✅ ${relativePath} (short_name: ${result.oldShortName} → ${EXT_NAME})`);
        }
    }

    if (errorCount > 0) {
        process.exit(1);
    }
    console.log(`\n🎉 Extension branding updated to "${EXT_NAME}"!`);
}

// Run main function
main();
