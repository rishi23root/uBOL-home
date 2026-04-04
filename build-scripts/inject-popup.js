#!/usr/bin/env node
/**
 * Inject custom Ad Warden popup into custom-dist
 * Replaces uBlock popup with custom popup (octagon toggle, white + green theme)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PLATFORMS = ['custom-dist/chromium', 'custom-dist/firefox'];

const CUSTOM_POPUP_FILES = [
    { src: 'custom/popup/popup.html', dest: 'popup.html' },
    { src: 'custom/popup/css/popup.css', dest: 'css/popup.css' },
    { src: 'custom/popup/js/adwarden-env.js', dest: 'js/adwarden-env.js' },
    { src: 'custom/popup/js/popup-adwarden.js', dest: 'js/popup-adwarden.js' },
    { src: 'custom/popup/js/popup-ext.js', dest: 'js/popup-ext.js' },
    { src: 'custom/popup/js/adwarden-messaging.js', dest: 'js/adwarden-messaging.js' },
    // Auth page
    { src: 'custom/popup/adwarden-auth.html', dest: 'adwarden-auth.html' },
    { src: 'custom/popup/js/adwarden-auth.js', dest: 'js/adwarden-auth.js' },
];

function injectPopup() {
    console.log('🔧 Injecting custom Ad Warden popup into custom-dist...\n');

    for (const file of CUSTOM_POPUP_FILES) {
        const srcPath = path.join(rootDir, file.src);
        if (!fs.existsSync(srcPath)) {
            console.error(`❌ Source not found: ${file.src}`);
            process.exit(1);
        }
    }

    let successCount = 0;
    for (const platform of PLATFORMS) {
        const platformDir = path.join(rootDir, platform);
        if (!fs.existsSync(platformDir)) {
            console.warn(`⚠️  Platform directory not found: ${platform}`);
            continue;
        }

        for (const file of CUSTOM_POPUP_FILES) {
            const srcPath = path.join(rootDir, file.src);
            const destPath = path.join(platformDir, file.dest);
            const destDir = path.dirname(destPath);

            try {
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                }
                fs.copyFileSync(srcPath, destPath);
                console.log(`✅ ${platform}/${file.dest}`);
                successCount++;
            } catch (err) {
                console.error(`❌ ${platform}/${file.dest}: ${err.message}`);
                process.exit(1);
            }
        }
    }

    console.log(`\n📊 Popup injection: ${successCount} files`);
    console.log('✅ Ad Warden popup injection complete!\n');
}

injectPopup();
