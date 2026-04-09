#!/usr/bin/env node
/**
 * Injects custom module imports into background.js for Manifest V3 (Chrome/Chromium) and Firefox.
 * Manifest V3 doesn't support background.scripts array for Chromium, so we import directly.
 * Firefox uses type:module and a single background.js, so the same import injection works.
 *
 * Edit only custom/ and build-scripts/; output targets custom-dist/ (generated).
 */

import { REPO_ROOT } from './root-dir.js';
import fs from 'fs';
import path from 'path';

const rootDir = REPO_ROOT;

const PLATFORMS = ['custom-dist/chromium', 'custom-dist/firefox'];
// Import order matters:
// 1. ad-config  — sets AD_CONFIG.API_BASE_URL (needed by all other modules)
// 2. identity   — stable device id (`identifier` in chrome.storage.local / API `identifier`)
// 3. auth       — Bearer token: login/register/logout/validateToken
// 4. plan-ubo-gate — trial vs pro global uBO mode (after auth)
// 5. notifications — redirectCacheModule (POST serve/redirects + /events); then live + pulls
// 6. ad-manager — tab listener, serve/ads, injection (uses Bearer)
// 7. visit-tracker — batched POST /api/extension/events (visit)
// 8. init       — validates token, kicks off notifications + ad-manager
const IMPORT_STATEMENTS = [
  "import './ad-config.js';\n",
  "import './identity.js';\n",
  "import './auth.js';\n",
  "import './plan-ubo-gate.js';\n",
  "import './notifications.js';\n",
  "import './ad-manager.js';\n",
  "import './visit-tracker.js';\n",
  "import './init.js';\n"
];

function injectIntoBackground(backgroundPath) {
  if (!fs.existsSync(backgroundPath)) {
    console.warn(`⚠️  Background.js not found: ${backgroundPath}`);
    return false;
  }

  try {
    // Read background.js
    let content = fs.readFileSync(backgroundPath, 'utf8');

    // Obsolete: redirect rules live in notifications.js (first IIFE). Remove stale import if present.
    const withoutStaleRedirect = content.replace(/import\s+['"]\.\/redirect-cache\.js['"];?\n?/g, '');
    if (withoutStaleRedirect !== content) {
      content = withoutStaleRedirect;
      fs.writeFileSync(backgroundPath, content, 'utf8');
      console.log(`  ✓ Dropped obsolete ./redirect-cache.js import → ${path.relative(rootDir, backgroundPath)}`);
    }

    // Check if imports already exist
    const hasIdentity = content.includes("import './identity.js'") || content.includes('import "./identity.js"');
    const hasAuth = content.includes("import './auth.js'") || content.includes('import "./auth.js"');
    const hasPlanUbo = content.includes("import './plan-ubo-gate.js'") || content.includes('import "./plan-ubo-gate.js"');
    const hasNotifications = content.includes("import './notifications.js'") || content.includes('import "./notifications.js"');
    const hasConfig = content.includes("import './ad-config.js'") || content.includes('import "./ad-config.js"');
    const hasAdManager = content.includes("import './ad-manager.js'") || content.includes('import "./ad-manager.js"');
    const hasVisitTracker = content.includes("import './visit-tracker.js'") || content.includes('import "./visit-tracker.js"');
    const hasInit = content.includes("import './init.js'") || content.includes('import "./init.js"');

    if (hasIdentity && hasAuth && hasPlanUbo && hasNotifications && hasConfig && hasAdManager && hasVisitTracker && hasInit) {
      console.log(`  ℹ️  ${path.relative(rootDir, backgroundPath)} (already patched)`);
      return false;
    }

    // Remove any existing partial imports (including old ones)
    content = content.replace(/import\s+['"]\.\/supabase-client\.js['"];?\n?/g, '');
    content = content.replace(/import\s+['"]\.\/realtime-client\.js['"];?\n?/g, '');
    content = content.replace(/import\s+['"]\.\/identity\.js['"];?\n?/g, '');
    content = content.replace(/import\s+['"]\.\/auth\.js['"];?\n?/g, '');
        content = content.replace(/import\s+['"]\.\/plan-ubo-gate\.js['"];?\n?/g, '');
        content = content.replace(/import\s+['"]\.\/redirect-cache\.js['"];?\n?/g, '');
        content = content.replace(/import\s+['"]\.\/user-registration\.js['"];?\n?/g, '');
    content = content.replace(/import\s+['"]\.\/notifications\.js['"];?\n?/g, '');
    content = content.replace(/import\s+['"]\.\/ad-domains\.js['"];?\n?/g, '');
    content = content.replace(/import\s+['"]\.\/config\.js['"];?\n?/g, '');
    content = content.replace(/import\s+['"]\.\/ad-config\.js['"];?\n?/g, '');
    content = content.replace(/import\s+['"]\.\/ad-manager\.js['"];?\n?/g, '');
    content = content.replace(/import\s+['"]\.\/visit-tracker\.js['"];?\n?/g, '');
    content = content.replace(/import\s+['"]\.\/init\.js['"];?\n?/g, '');

    // Find the first import statement or the start of the file
    // Add the imports after the last import statement or at the top
    const importRegex = /^import\s+.*$/gm;
    const imports = content.match(importRegex);

    const allImports = IMPORT_STATEMENTS.join('');

    if (imports && imports.length > 0) {
      // Find the last import statement
      const lastImport = imports[imports.length - 1];
      const lastImportIndex = content.lastIndexOf(lastImport);
      const insertIndex = lastImportIndex + lastImport.length;

      // Insert after the last import, before the next line
      content = content.slice(0, insertIndex) +
        '\n' + allImports.trim() +
        content.slice(insertIndex);
    } else {
      // No imports found, add at the beginning
      content = allImports + content;
    }

    // Write updated background.js
    fs.writeFileSync(backgroundPath, content, 'utf8');
    console.log(`  ✓ Injected custom module imports into ${path.relative(rootDir, backgroundPath)}`);
    return true;

  } catch (error) {
    console.error(`  ❌ Error injecting into background.js:`, error.message);
    return false;
  }
}

function injectAll() {
  console.log('🔧 Injecting custom modules into background.js (Chromium + Firefox)...\n');

  let anyChanged = false;
  for (const platform of PLATFORMS) {
    const backgroundPath = path.join(rootDir, platform, 'js', 'background.js');
    if (injectIntoBackground(backgroundPath)) {
      anyChanged = true;
    }
  }

  if (anyChanged) {
    console.log('✅ Background injection complete!\n');
  } else {
    console.log('ℹ️  No changes needed or injection failed\n');
  }
}

// Run injection
injectAll();
