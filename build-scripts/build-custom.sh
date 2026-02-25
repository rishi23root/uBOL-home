#!/bin/bash
# Ad Warden custom build wrapper for uBOL-home
# Copies chromium/ and firefox/ to custom-dist/, applies patches, injects custom files,
# updates manifests. Assumes chromium/ and firefox/ are already built (run make first).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# When run with sudo, use the original user's Node (nvm) so sharp works (needs Node 14+)
if [ -n "$SUDO_USER" ]; then
    REAL_HOME=$(getent passwd "$SUDO_USER" 2>/dev/null | cut -d: -f6)
    if [ -n "$REAL_HOME" ]; then
        NVM_NODE="$REAL_HOME/.nvm/versions/node"
        if [ -d "$NVM_NODE" ]; then
            for ver in "$NVM_NODE"/*/; do
                NODE_BIN="${ver}bin/node"
                if [ -x "$NODE_BIN" ]; then
                    MAJOR=$("$NODE_BIN" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
                    if [ -n "$MAJOR" ] && [ "$MAJOR" -ge 14 ] 2>/dev/null; then
                        export PATH="${ver}bin:$PATH"
                        break
                    fi
                fi
            done
        fi
    fi
fi

echo "🚀 Starting Ad Warden custom build process..."
echo ""

# Step 0: Clean previous build outputs
echo "🧹 Step 0: Cleaning previous build outputs..."
if [ -d "$ROOT_DIR/custom-dist" ]; then
    echo "   🗑️  Removing existing custom-dist/..."
    rm -rf "$ROOT_DIR/custom-dist"
    echo "   ✅ custom-dist/ removed"
else
    echo "   ℹ️  No existing custom-dist/ to remove"
fi

# Clean any leftover custom files from source directories
echo "   🧹 Cleaning leftover custom files from source directories..."
if [ -f "$ROOT_DIR/chromium/js/user-registration.js" ]; then
    echo "   🗑️  Removing chromium/js/user-registration.js..."
    rm -f "$ROOT_DIR/chromium/js/user-registration.js"
fi
if [ -f "$ROOT_DIR/firefox/js/user-registration.js" ]; then
    echo "   🗑️  Removing firefox/js/user-registration.js..."
    rm -f "$ROOT_DIR/firefox/js/user-registration.js"
fi
if [ -f "$ROOT_DIR/chromium/js/notifications.js" ]; then
    echo "   🗑️  Removing chromium/js/notifications.js..."
    rm -f "$ROOT_DIR/chromium/js/notifications.js"
fi
if [ -f "$ROOT_DIR/firefox/js/notifications.js" ]; then
    echo "   🗑️  Removing firefox/js/notifications.js..."
    rm -f "$ROOT_DIR/firefox/js/notifications.js"
fi
echo "   ✅ Cleanup complete"
echo ""

# Step 1: Verify build prerequisites (chromium/ and firefox/ must exist from prior 'make')
echo "📦 Step 1: Verifying build prerequisites..."
echo ""

if [ -f "$ROOT_DIR/Makefile" ]; then
    echo "   Makefile found. Checking submodule..."
    
    # Check if uBlock submodule is initialized
    if [ ! -d "$ROOT_DIR/uBlock" ] || [ -z "$(ls -A "$ROOT_DIR/uBlock" 2>/dev/null)" ]; then
        echo "   ⚠️  uBlock submodule not initialized. Initializing..."
        cd "$ROOT_DIR"
        git submodule update --init --recursive || true
    fi
else
    echo "   ℹ️  No Makefile found. Assuming build output already exists."
fi

echo ""

# Step 2: Copy chromium/ and firefox/ to custom-dist/ (originals untouched)
echo "📋 Step 2: confirming chromium/ and firefox/ exist"
if [ ! -d "$ROOT_DIR/chromium" ]; then
    echo "   ❌ chromium/ directory not found!"
    echo "   Please run the uBlock build process first to create chromium/"
    exit 1
fi

if [ ! -d "$ROOT_DIR/firefox" ]; then
    echo "   ⚠️  firefox/ directory not found (will skip firefox build)"
fi

# Create custom-dist directory (already cleaned in Step 0)
mkdir -p "$ROOT_DIR/custom-dist"

# Remove destination dirs before copy to avoid "File exists" errors (e.g. WSL, stale mounts)
rm -rf "$ROOT_DIR/custom-dist/chromium" "$ROOT_DIR/custom-dist/firefox"

# Copy chromium to custom-dist/chromium
echo "   📦 Copying chromium/ → custom-dist/chromium/..."
cp -r "$ROOT_DIR/chromium" "$ROOT_DIR/custom-dist/chromium"

if [ $? -ne 0 ]; then
    echo "   ❌ Failed to copy chromium/ to custom-dist/chromium/!"
    exit 1
fi

# Copy firefox to custom-dist/firefox (if it exists)
if [ -d "$ROOT_DIR/firefox" ]; then
    echo "   📦 Copying firefox/ → custom-dist/firefox/..."
    cp -r "$ROOT_DIR/firefox" "$ROOT_DIR/custom-dist/firefox"
    
    if [ $? -ne 0 ]; then
        echo "   ❌ Failed to copy firefox/ to custom-dist/firefox/!"
        exit 1
    fi
fi

# Remove _metadata - Chrome rejects extensions with underscore-prefixed dirs
if [ -d "$ROOT_DIR/custom-dist/chromium/_metadata" ]; then
    rm -rf "$ROOT_DIR/custom-dist/chromium/_metadata"
    echo "   🗑️  Removed custom-dist/chromium/_metadata (Chrome reserved)"
fi
if [ -d "$ROOT_DIR/custom-dist/firefox/_metadata" ]; then
    rm -rf "$ROOT_DIR/custom-dist/firefox/_metadata"
    echo "   🗑️  Removed custom-dist/firefox/_metadata (Chrome reserved)"
fi

echo "   ✅ custom-dist/ created successfully"
echo ""

# Step 2b: Inject custom popup (Ad Warden UI)
echo "🖼️  Step 2b: Injecting custom popup UI..."
cd "$ROOT_DIR"
node build-scripts/inject-popup.js

if [ $? -ne 0 ]; then
    echo "❌ Popup injection failed!"
    exit 1
fi

# Step 2c: Patch css-api.js for Extension context invalidated
echo "🔧 Step 2c: Patching css-api.js..."
node build-scripts/patch-css-api.js

# Step 2c2: Patch scripting-manager.js to avoid scriptlet errors in sandboxed iframes (YouTube Shorts)
echo "🔧 Step 2c2: Patching scripting-manager.js..."
node build-scripts/patch-scripting-manager.js

# Step 2c2b: Patch contentscript.js to add cosmetic filter exceptions for Ad Warden popup overlay
echo "🔧 Step 2c2b: Patching contentscript.js (Ad Warden exceptions)..."
node build-scripts/patch-contentscript-adwarden.js

# Step 2c3: Patch theme.js to default to dark theme
echo "🎨 Step 2c3: Patching theme.js for default dark theme..."
node build-scripts/patch-theme.js

echo ""

# Step 3: Replace icons with Ad Warden logo
# Uses sharp (requires Node 14.18+). If run with sudo, system Node may be old - skip with warning.
echo "🖼️  Step 3: Replacing icons with Ad Warden logo..."
cd "$ROOT_DIR"
if node build-scripts/replace-icons.js; then
    echo "   ✅ Icons replaced"
else
    echo "   ⚠️  Icon replacement failed - continuing build (run without sudo to use your nvm Node)"
fi

# Step 3a: Patch dashboard logo (ublock.svg -> icon_64.png)
echo "🖼️  Step 3a: Patching dashboard logo..."
node build-scripts/patch-dashboard.js

# Step 3b: Remove element picker (zapper, unpicker, picker) - Ad Warden does not provide this
echo "🗑️  Step 3b: Removing element picker..."
node build-scripts/remove-element-picker.js

echo ""

# Step 4: Update extension name to Ad Warden
echo "📝 Step 4: Updating extension name to 'Ad Warden'..."
cd "$ROOT_DIR"
node build-scripts/update-extension-name.js

if [ $? -ne 0 ]; then
    echo "❌ Extension name update failed!"
    exit 1
fi

echo ""

# Step 5: Inject custom files
echo "📥 Step 5: Injecting custom files into platform builds..."
cd "$ROOT_DIR"
node build-scripts/inject-custom.js

if [ $? -ne 0 ]; then
    echo "❌ Custom file injection failed!"
    exit 1
fi

echo ""


# Step 6: Inject custom modules into background.js (Chromium + Firefox)
echo "📥 Step 6: Injecting custom modules into background.js..."
node build-scripts/inject-background.js

echo ""

# Step 7: Merge manifests (permissions, host_permissions, notifications, alarms)
echo "📝 Step 7: Merging manifests (permissions, host_permissions)..."
node build-scripts/merge-manifest.js

if [ $? -ne 0 ]; then
    echo "❌ Manifest merging failed!"
    exit 1
fi

echo ""

# Step 8: Verify custom files are present
echo "🔍 Step 8: Verifying custom files in build outputs..."
VERIFICATION_FAILED=0

# Check custom-dist/chromium/ (custom build)
CUSTOM_DIST_CHROMIUM_FILE="$ROOT_DIR/custom-dist/chromium/js/notifications.js"
if [ -f "$CUSTOM_DIST_CHROMIUM_FILE" ]; then
    echo "   ✅ custom-dist/chromium/js/notifications.js exists"
else
    echo "   ❌ custom-dist/chromium/js/notifications.js NOT FOUND"
    VERIFICATION_FAILED=1
fi

# Check custom-dist/firefox/ (if it exists)
if [ -d "$ROOT_DIR/custom-dist/firefox" ]; then
    CUSTOM_DIST_FIREFOX_FILE="$ROOT_DIR/custom-dist/firefox/js/notifications.js"
    if [ -f "$CUSTOM_DIST_FIREFOX_FILE" ]; then
        echo "   ✅ custom-dist/firefox/js/notifications.js exists"
    else
        echo "   ❌ custom-dist/firefox/js/notifications.js NOT FOUND"
        VERIFICATION_FAILED=1
    fi
fi

# Verify chromium/ is untouched (should NOT have custom files)
CHROMIUM_CUSTOM_FILE="$ROOT_DIR/chromium/js/notifications.js"
if [ -f "$CHROMIUM_CUSTOM_FILE" ]; then
    echo "   ⚠️  WARNING: chromium/js/notifications.js exists (chromium/ should be untouched!)"
    echo "   💡 This file may be from a previous build. Consider cleaning chromium/ directory."
    # Don't fail - just warn, as this might be from a previous run
else
    echo "   ✅ chromium/ is untouched (no custom files)"
fi

# Verify firefox/ is untouched (should NOT have custom files)
if [ -d "$ROOT_DIR/firefox" ]; then
    FIREFOX_CUSTOM_FILE="$ROOT_DIR/firefox/js/notifications.js"
    if [ -f "$FIREFOX_CUSTOM_FILE" ]; then
        echo "   ⚠️  WARNING: firefox/js/notifications.js exists (firefox/ should be untouched!)"
        echo "   💡 This file may be from a previous build. Consider cleaning firefox/ directory."
        # Don't fail - just warn
    else
        echo "   ✅ firefox/ is untouched (no custom files)"
    fi
fi

if [ $VERIFICATION_FAILED -eq 1 ]; then
    echo ""
    echo "❌ Verification failed! Custom files are missing in custom-dist/."
    exit 1
fi

echo ""
echo "✅ Custom build complete!"
echo ""
echo "📦 Build outputs:"
echo "   - chromium/               → Pure uBOL build (untouched)"
echo "   - firefox/                → Pure uBOL build (untouched)"
echo "   - custom-dist/chromium/   → Ad Warden build (Chromium)"
echo "   - custom-dist/firefox/    → Ad Warden build (Firefox)"
echo ""
