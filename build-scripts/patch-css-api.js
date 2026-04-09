#!/usr/bin/env node
/**
 * Patch css-api.js to handle "Extension context invalidated" gracefully.
 * Applied to custom-dist after copy so the fix survives uBOL rebuilds.
 */

import { REPO_ROOT } from './root-dir.js';
import fs from 'fs';
import path from 'path';

const rootDir = REPO_ROOT;

const PLATFORMS = ['custom-dist/chromium', 'custom-dist/firefox'];

const PATCHED_BLOCK = `    const safeInsert = function(css) {
        try {
            chrome.runtime.sendMessage({
                what: 'insertCSS',
                css,
            }).catch(( ) => { });
        } catch (e) {
            /* Extension context invalidated - ignore */
        }
    };
    self.cssAPI = { insert: safeInsert };`;

// Original uBOL pattern (no try-catch)
const ORIGINAL = `    self.cssAPI = {
        insert(css) {
            chrome.runtime.sendMessage({
                what: 'insertCSS',
                css,
            }).catch(( ) => {
            });
        },
    };`;

function patchCssApi(content) {
    if (content.includes('Extension context invalidated - ignore')) return content;
    return content.replace(ORIGINAL, PATCHED_BLOCK);
}

function main() {
    console.log('🔧 Patching css-api.js for Extension context invalidated...\n');

    let patched = 0;
    for (const platform of PLATFORMS) {
        const filePath = path.join(rootDir, platform, 'js', 'scripting', 'css-api.js');
        if (!fs.existsSync(filePath)) {
            console.warn(`⚠️  Not found: ${filePath}`);
            continue;
        }
        let content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('Extension context invalidated - ignore')) {
            console.log(`   ✓ ${platform}/js/scripting/css-api.js (already patched)`);
            patched++;
            continue;
        }
        const newContent = patchCssApi(content);
        if (content.includes('Extension context invalidated - ignore')) {
            console.log(`   ✓ ${platform}/js/scripting/css-api.js (already patched)`);
            patched++;
        } else if (newContent !== content) {
            fs.writeFileSync(filePath, newContent);
            console.log(`   ✅ ${platform}/js/scripting/css-api.js patched`);
            patched++;
        } else {
            console.warn(`   ⚠️  ${platform}/js/scripting/css-api.js - no match`);
        }
    }
    console.log(`\n✅ css-api.js patch complete (${patched} files)\n`);
}

main();
