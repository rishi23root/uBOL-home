#!/usr/bin/env node
/**
 * Patch contentscript.js to add cosmetic filter exceptions for Ad Warden injected content.
 * This ensures uBOL does not hide our display-mode ads (which are injected directly into the body).
 * We add .aw-injected and [data-aw-inj] to the exception list so they are never hidden.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PLATFORMS = ['custom-dist/chromium', 'custom-dist/firefox'];

const PATCH_MARKER = '            domFilterer.exceptCSSRules(cfeDetails.exceptedFilters);';
const PATCH_ADDITION = `            domFilterer.exceptCSSRules(cfeDetails.exceptedFilters);
            domFilterer.exceptCSSRules(['.aw-injected','[data-aw-inj]']);`;

function patchContentscript() {
    console.log('🔧 Patching contentscript.js (Ad Warden cosmetic filter exceptions)...\n');

    let patched = 0;
    for (const platform of PLATFORMS) {
        const filePath = path.join(rootDir, platform, 'js', 'contentscript.js');
        if (!fs.existsSync(filePath)) {
            console.warn(`   ⚠️  Not found: ${platform}/js/contentscript.js`);
            continue;
        }

        let content = fs.readFileSync(filePath, 'utf8');

        if (content.includes("domFilterer.exceptCSSRules(['.aw-injected'")) {
            console.log(`   ℹ️  ${platform}/js/contentscript.js (already patched)`);
            continue;
        }

        if (content.includes(PATCH_MARKER)) {
            content = content.replace(PATCH_MARKER, PATCH_ADDITION);
            fs.writeFileSync(filePath, content);
            console.log(`   ✅ ${platform}/js/contentscript.js patched`);
            patched++;
        } else {
            console.warn(`   ⚠️  ${platform}/js/contentscript.js - no match for patch`);
        }
    }

    console.log(`\n✅ Contentscript patch complete (${patched} file(s) updated)\n`);
}

patchContentscript();
