#!/usr/bin/env node
/**
 * Patch dashboard.html:
 * - Use Ad Warden logo (icon_64.png) instead of ublock.svg
 * - Replace About section with Ad Warden copyright (remove uBlock refs)
 * Run after replace-icons.js so icon_64.png has the custom logo
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PLATFORMS = ['custom-dist/chromium', 'custom-dist/firefox'];

/** Ad Warden About section - replaces uBlock copyright and links */
const ADWARDEN_ABOUT_BODY = `    <section data-pane="about">
        <div class="body">
            <div id="aboutNameVer" class="li"></div>
            <div class="liul">
                <div class="li">Ad Warden - Content blocker</div>
                <div class="li">Copyright (c) Ad Warden</div>
            </div>
            <div class="li"><span data-i18n="aboutDependencies"></span></div>
            <div class="liul">
                <div class="li"><span><a href="https://github.com/rsms/inter" target="_blank">Inter font family</a> by <a href="https://github.com/rsms">Rasmus Andersson</a></span></div>
                <div class="li"><span><a href="https://fontawesome.com/" target="_blank">FontAwesome font family</a> by <a href="https://github.com/davegandy">Dave Gandy</a></span></div>
                <div class="li"><span><a href="https://github.com/mathiasbynens/punycode.js" target="_blank">Punycode.js</a> by <a href="https://github.com/mathiasbynens">Mathias Bynens</a></span></div>
                <div class="li"><span><a href="https://flagpedia.net/" target="_blank">Flags of the World</a> by <a href="https://www.davidkrmela.com/">David Krmela</a></span></div>
                <div class="li"><span><a href="https://codemirror.net/" target="_blank">CodeMirror 6</a> by <a href="https://github.com/marijnh">Marijn Haverbeke</a></span></div>
            </div>
            <hr>
            <details><summary data-i18n="supportS5H"></summary>
            <pre style="user-select:all; -webkit-user-select:all; direction:ltr;"></pre>
            </details>
        </div>
    </section>`;

function patchDashboard() {
    console.log('🔧 Patching dashboard to Ad Warden (logo, About, rebrand)...\n');

    let successCount = 0;
    for (const platform of PLATFORMS) {
        const dashboardPath = path.join(rootDir, platform, 'dashboard.html');
        if (!fs.existsSync(dashboardPath)) {
            console.warn(`⚠️  Dashboard not found: ${platform}/dashboard.html`);
            continue;
        }

        let html = fs.readFileSync(dashboardPath, 'utf8');
        const original = html;

        // Replace ublock.svg logo with icon_64.png (already replaced with Ad Warden logo by replace-icons)
        html = html.replace(
            /src="img\/ublock\.svg"/g,
            'src="img/icon_64.png"'
        );
        html = html.replace(
            /alt="uBO Lite"/g,
            'alt="Ad Warden"'
        );

        // Replace About section content - remove uBlock copyright, add Ad Warden
        html = html.replace(
            /<section data-pane="about">[\s\S]*?<\/section>\s*<!--\s*--------\s*-->\s*<section data-pane="busy">/,
            ADWARDEN_ABOUT_BODY + '\n    <!-- -------- -->\n    <section data-pane="busy">'
        );

        if (html !== original) {
            fs.writeFileSync(dashboardPath, html);
            console.log(`✅ ${platform}/dashboard.html (logo, About rebranded)`);
            successCount++;
        } else {
            console.log(`ℹ️  ${platform}/dashboard.html (no changes needed)`);
        }
    }

    // Patch strictblock.html - remove uBlock wiki link (keep icon, link to generic or remove)
    for (const platform of PLATFORMS) {
        const strictblockPath = path.join(rootDir, platform, 'strictblock.html');
        if (fs.existsSync(strictblockPath)) {
            let html = fs.readFileSync(strictblockPath, 'utf8');
            const original = html;
            html = html.replace(
                /href="https:\/\/github\.com\/gorhill\/uBlock\/wiki\/Strict-blocking"/g,
                'href="#"'
            );
            if (html !== original) {
                fs.writeFileSync(strictblockPath, html);
                console.log(`✅ ${platform}/strictblock.html (uBlock link removed)`);
                successCount++;
            }
        }
    }

    // Patch click2load.html - logo, title, html id
    for (const platform of PLATFORMS) {
        const click2loadPath = path.join(rootDir, platform, 'web_accessible_resources', 'click2load.html');
        if (!fs.existsSync(click2loadPath)) continue;

        let html = fs.readFileSync(click2loadPath, 'utf8');
        const original = html;
        html = html.replace(/src="\.\.\/img\/ublock\.svg"/g, 'src="../img/icon_64.png"');
        html = html.replace(/<html id="ublock0-clicktoload">/, '<html id="adwarden-clicktoload">');
        html = html.replace(/<title>uBlock Origin Click-to-Load<\/title>/, '<title>Ad Warden Click-to-Load</title>');
        if (html !== original) {
            fs.writeFileSync(click2loadPath, html);
            console.log(`✅ ${platform}/web_accessible_resources/click2load.html (logo, title rebranded)`);
            successCount++;
        }
    }

    console.log(`\n✅ Dashboard patch complete (${successCount} file(s) updated)\n`);
}

patchDashboard();
