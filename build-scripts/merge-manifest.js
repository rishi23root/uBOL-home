#!/usr/bin/env node
/**
 * Manifest merger script for uBOL-home
 * Updates platform-specific manifests to include custom scripts and permissions
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Platform directories and their manifest paths
// Note: chromium/ and firefox/ are kept untouched, custom-dist/ contains custom builds
const PLATFORMS = [
  { name: 'custom-dist-chromium', manifest: 'custom-dist/chromium/manifest.json' },
  { name: 'custom-dist-firefox', manifest: 'custom-dist/firefox/manifest.json' }
];

const CUSTOM_SCRIPT = '/js/notifications.js';
const NOTIFICATIONS_PERMISSION = 'notifications';
const ALARMS_PERMISSION = 'alarms';
const HOST_PERMISSION_ALL_URLS = '<all_urls>';

function mergeManifest(platform) {
  const manifestPath = path.join(rootDir, platform.manifest);

  // Check if manifest exists
  if (!fs.existsSync(manifestPath)) {
    console.warn(`⚠️  Manifest not found: ${platform.manifest}`);
    return false;
  }

  try {
    // Read manifest
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);

    let updated = false;

    // Handle background scripts
    if (manifest.background) {
      // Chrome/Edge Manifest V3: has service_worker, does NOT support scripts array
      // We'll import notifications.js into background.js instead (handled by inject-background.js)
      if (manifest.background.service_worker) {
        // Manifest V3 doesn't support background.scripts
        // Remove it if it exists (from previous incorrect merges)
        if (manifest.background.scripts) {
          delete manifest.background.scripts;
          updated = true;
          console.log(`  ✓ Removed invalid background.scripts (Manifest V3 doesn't support it)`);
        }
        console.log(`  ℹ️  Manifest V3: notifications will be imported into background.js`);
      }
      // Firefox Manifest V2/V3: has scripts array (Firefox supports it)
      // Custom modules are imported via background.js (inject-background.js), so we don't add notifications.js here
      else if (manifest.background.scripts && Array.isArray(manifest.background.scripts)) {
        // Remove notifications.js if present (now imported by background.js)
        if (manifest.background.scripts.includes(CUSTOM_SCRIPT)) {
          manifest.background.scripts = manifest.background.scripts.filter(s => s !== CUSTOM_SCRIPT);
          updated = true;
          console.log(`  ✓ Removed ${CUSTOM_SCRIPT} from background.scripts (now imported by background.js)`);
        }
      }
    }

    // Handle permissions
    if (!manifest.permissions) {
      manifest.permissions = [];
    }

    // Add notifications permission if not present
    if (!manifest.permissions.includes(NOTIFICATIONS_PERMISSION)) {
      manifest.permissions.push(NOTIFICATIONS_PERMISSION);
      updated = true;
      console.log(`  ✓ Added "${NOTIFICATIONS_PERMISSION}" permission`);
    }

    // Add alarms permission if not present (required for WebSocket keepalive)
    if (!manifest.permissions.includes(ALARMS_PERMISSION)) {
      manifest.permissions.push(ALARMS_PERMISSION);
      updated = true;
      console.log(`  ✓ Added "${ALARMS_PERMISSION}" permission`);
    }

    // Sort permissions alphabetically for consistency
    if (updated) {
      manifest.permissions.sort();
    }

    // Ensure host_permissions includes <all_urls> so level 2/3 work without runtime prompts
    if (!manifest.host_permissions) {
      manifest.host_permissions = [];
    }
    if (!manifest.host_permissions.includes(HOST_PERMISSION_ALL_URLS)) {
      manifest.host_permissions.push(HOST_PERMISSION_ALL_URLS);
      updated = true;
      console.log(`  ✓ Added host_permissions: ["<all_urls>"] (enables level 2/3 at install)`);
    }

    // Firefox: remove optional_permissions so <all_urls> is requested at install, not runtime
    if (manifest.optional_permissions?.includes(HOST_PERMISSION_ALL_URLS)) {
      manifest.optional_permissions = manifest.optional_permissions.filter(p => p !== HOST_PERMISSION_ALL_URLS);
      if (manifest.optional_permissions.length === 0) {
        delete manifest.optional_permissions;
      }
      updated = true;
      console.log(`  ✓ Moved <all_urls> from optional to required (no runtime permission prompts)`);
    }

    // Write updated manifest
    if (updated) {
      const updatedContent = JSON.stringify(manifest, null, 2);
      fs.writeFileSync(manifestPath, updatedContent, 'utf8');
      console.log(`✅ Updated: ${platform.manifest}\n`);
      return true;
    } else {
      console.log(`ℹ️  No changes needed: ${platform.manifest}\n`);
      return true; // No changes needed is still success
    }

  } catch (error) {
    console.error(`❌ Error processing ${platform.manifest}:`, error.message);
    return false;
  }
}

function mergeAllManifests() {
  console.log('🔧 Merging custom scripts into platform manifests...\n');

  let successCount = 0;
  let errorCount = 0;

  for (const platform of PLATFORMS) {
    console.log(`Processing ${platform.name}...`);
    const result = mergeManifest(platform);

    if (result === false) {
      errorCount++;
    } else {
      successCount++;
    }
  }

  console.log(`📊 Manifest Merge Summary: ${successCount} successful, ${errorCount} failed`);

  if (errorCount > 0) {
    process.exit(1);
  }

  console.log('✅ Manifest merging complete!\n');
}

// Run manifest merging
mergeAllManifests();
