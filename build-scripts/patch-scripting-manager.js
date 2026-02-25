#!/usr/bin/env node
/**
 * Patch scripting-manager.js to avoid scriptlet injection into about:blank frames.
 * YouTube Shorts and others use sandboxed iframes that block script execution,
 * causing "Blocked script execution in 'about:blank' because the document's frame
 * is sandboxed and the 'allow-scripts' permission is not set" errors.
 * Applied to custom-dist after copy so the fix survives uBOL rebuilds.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PLATFORMS = ['custom-dist/chromium', 'custom-dist/firefox'];

function patchScriptingManager(filePath) {
    if (!fs.existsSync(filePath)) return false;

    let content = fs.readFileSync(filePath, 'utf8');
    const original = content;

    // Chromium: matchOriginAsFallback: true → false (scriptlet directive object)
    content = content.replace(
        /matchOriginAsFallback:\s*true,/,
        'matchOriginAsFallback: false,'
    );

    // Firefox: directive.matchOriginAsFallback = true → false
    content = content.replace(
        /directive\.matchOriginAsFallback\s*=\s*true;/,
        'directive.matchOriginAsFallback = false;'
    );

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        return true;
    }
    return false;
}

function main() {
    console.log('🔧 Patching scripting-manager.js (disable scriptlets in about:blank)...\n');

    let patched = 0;
    for (const platform of PLATFORMS) {
        const filePath = path.join(rootDir, platform, 'js', 'scripting-manager.js');
        if (patchScriptingManager(filePath)) {
            console.log(`   ✅ ${platform}/js/scripting-manager.js patched`);
            patched++;
        } else {
            console.log(`   ℹ️  ${platform}/js/scripting-manager.js (no changes or not found)`);
        }
    }
    console.log(`\n✅ scripting-manager.js patch complete (${patched} file(s) updated)\n`);
}

main();
