#!/usr/bin/env node
/**
 * Patches theme.js to default to dark theme instead of system preference.
 * Runs on custom-dist after chromium/firefox are copied.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PLATFORMS = ['custom-dist/chromium', 'custom-dist/firefox'];

function patchThemeJs(filePath) {
  if (!fs.existsSync(filePath)) return false;

  let content = fs.readFileSync(filePath, 'utf8');

  // uBOL theme.js: replace matchMedia-based theme with fixed 'dark'
  const oldPattern = /const mql = self\.matchMedia\('\(prefers-color-scheme: dark\)'\);\s+const theme = mql instanceof Object && mql\.matches === true\s+\? 'dark'\s+: 'light';/;
  const newPattern = "// Default to dark theme (Ad Warden)\n    const theme = 'dark';";

  const newContent = content.replace(oldPattern, newPattern);
  if (newContent !== content) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    return true;
  }

  return false;
}

function run() {
  console.log('🎨 Patching theme.js for default dark theme...\n');

  let patched = 0;
  for (const platform of PLATFORMS) {
    const themePath = path.join(rootDir, platform, 'js', 'theme.js');
    if (patchThemeJs(themePath)) {
      console.log(`   ✅ ${platform}/js/theme.js patched`);
      patched++;
    } else {
      console.log(`   ⚠️  ${platform}/js/theme.js not found or already patched`);
    }
  }

  if (patched > 0) {
    console.log('\n✅ Theme patch complete - popup will default to dark theme\n');
  }
}

run();
