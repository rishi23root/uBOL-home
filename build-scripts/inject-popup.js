#!/usr/bin/env node
/**
 * Inject custom Ad Warden popup into custom-dist
 * Replaces uBlock popup with custom popup (octagon toggle, white + green theme)
 */

import { REPO_ROOT } from './root-dir.js';
import fs from 'fs';
import path from 'path';

const rootDir = REPO_ROOT;

const PLATFORMS = ['custom-dist/chromium', 'custom-dist/firefox'];

const CONFIG_FOR_POPUP = 'custom/config/config.js';

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
    const configPath = path.join(rootDir, CONFIG_FOR_POPUP);
    if (!fs.existsSync(configPath)) {
        console.error(`❌ Source not found: ${CONFIG_FOR_POPUP}`);
        process.exit(1);
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

        try {
            const adConfigDest = path.join(platformDir, 'js/ad-config.js');
            const adConfigDir = path.dirname(adConfigDest);
            if (!fs.existsSync(adConfigDir)) {
                fs.mkdirSync(adConfigDir, { recursive: true });
            }
            fs.copyFileSync(configPath, adConfigDest);
            console.log(`✅ ${platform}/js/ad-config.js (from ${CONFIG_FOR_POPUP})`);
            successCount++;
        } catch (err) {
            console.error(`❌ ${platform}/js/ad-config.js: ${err.message}`);
            process.exit(1);
        }
    }

    console.log(`\n📊 Popup injection: ${successCount} files`);
    console.log('✅ Ad Warden popup injection complete!\n');
}

injectPopup();
