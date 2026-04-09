#!/usr/bin/env node
/**
 * Remove element picker (zapper, unpicker, picker) from custom-dist.
 * Ad Warden does not provide this functionality.
 * Run after patch-dashboard.js.
 */

import { REPO_ROOT } from './root-dir.js';
import fs from 'fs';
import path from 'path';

const rootDir = REPO_ROOT;

const PLATFORMS = ['custom-dist/chromium', 'custom-dist/firefox'];

const FILES_TO_DELETE = [
    'zapper-ui.html',
    'unpicker-ui.html',
    'picker-ui.html',
    'css/zapper-ui.css',
    'css/unpicker-ui.css',
    'css/picker-ui.css',
    'css/tool-overlay-ui.css',
    'js/zapper-ui.js',
    'js/unpicker-ui.js',
    'js/picker-ui.js',
    'js/tool-overlay-ui.js',
    'js/scripting/zapper.js',
    'js/scripting/unpicker.js',
    'js/scripting/picker.js',
    'js/scripting/tool-overlay.js',
];

const PICKER_RESOURCES = ['/zapper-ui.html', '/unpicker-ui.html', '/picker-ui.html'];

function removeElementPicker() {
    console.log('🔧 Removing element picker (zapper, unpicker, picker) from custom-dist...\n');

    let deleteCount = 0;
    for (const platform of PLATFORMS) {
        const platformDir = path.join(rootDir, platform);
        if (!fs.existsSync(platformDir)) continue;

        for (const file of FILES_TO_DELETE) {
            const filePath = path.join(platformDir, file);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`   🗑️  ${platform}/${file}`);
                deleteCount++;
            }
        }
    }

    // Patch manifest.json
    for (const platform of PLATFORMS) {
        const manifestPath = path.join(rootDir, platform, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        let manifestUpdated = false;

        if (manifest.commands && Object.keys(manifest.commands).length > 0) {
            delete manifest.commands;
            manifestUpdated = true;
        }

        if (manifest.web_accessible_resources && Array.isArray(manifest.web_accessible_resources)) {
            const filtered = manifest.web_accessible_resources.filter((entry) => {
                if (!entry.resources || !Array.isArray(entry.resources)) return true;
                const hasPicker = entry.resources.some((r) =>
                    PICKER_RESOURCES.some((pr) => r === pr || r.endsWith(pr))
                );
                return !hasPicker;
            });
            if (filtered.length !== manifest.web_accessible_resources.length) {
                manifest.web_accessible_resources = filtered;
                manifestUpdated = true;
            }
        }

        if (manifestUpdated) {
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
            console.log(`   ✅ ${platform}/manifest.json (commands, web_accessible_resources)`);
        }
    }

    // Patch background.js - neuter onCommand for zapper/picker, and guard commands listener
    const ONCOMMAND_NEUTERED = `function onCommand(command, tab) {
    switch ( command ) {
    default:
        break;
    }
}`;

    const COMMANDS_LISTENER_ORIGINAL = `browser.commands.onCommand.addListener((...args) => {
    isFullyInitialized.then(( ) => {
        onCommand(...args);
    });
});`;

    const COMMANDS_LISTENER_GUARDED = `if ( browser.commands && browser.commands.onCommand ) {
    browser.commands.onCommand.addListener((...args) => {
        isFullyInitialized.then(( ) => {
            onCommand(...args);
        });
    });
}`;

    for (const platform of PLATFORMS) {
        const bgPath = path.join(rootDir, platform, 'js', 'background.js');
        if (!fs.existsSync(bgPath)) continue;

        let content = fs.readFileSync(bgPath, 'utf8');
        const original = content;

        // Neuter onCommand
        const origRegex = /function onCommand\(command, tab\) \{\s+switch \( command \) \{\s+case 'enter-zapper-mode': \{[\s\S]*?break;\s+\}\s+case 'enter-picker-mode': \{[\s\S]*?break;\s+\}\s+default:\s+break;\s+\}\s+\}/;
        content = content.replace(origRegex, ONCOMMAND_NEUTERED);

        // Guard commands listener (browser.commands is undefined when manifest has no commands)
        if (content.includes(COMMANDS_LISTENER_ORIGINAL)) {
            content = content.replace(COMMANDS_LISTENER_ORIGINAL, COMMANDS_LISTENER_GUARDED);
        }

        if (content !== original) {
            fs.writeFileSync(bgPath, content, 'utf8');
            console.log(`   ✅ ${platform}/js/background.js (onCommand neutered, commands listener guarded)`);
        }
    }

    console.log(`\n✅ Element picker removed (${deleteCount} file(s) deleted)\n`);
}

removeElementPicker();
