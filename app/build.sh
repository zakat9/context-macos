#!/bin/bash
# Builds "Context.app" on this Mac and runs its self-test. Nothing is downloaded, uploaded or published.
# Needs the Swift compiler that comes with Apple's Command Line Tools:  xcode-select --install
#   ./build.sh            build into ./build and run the self-test
#   ./build.sh install    the same, then copy the app to ~/Applications
# The build is signed for this Mac only ("ad hoc"). Developer ID signing and notarization are a separate,
# not-yet-done step: see ../RELEASE-PLAN.md.
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(uname -s)" != "Darwin" ]; then echo "This builds a macOS app. Run it on a Mac."; exit 1; fi
if ! command -v swiftc >/dev/null 2>&1; then echo "The Swift compiler was not found. Install Apple's Command Line Tools:  xcode-select --install"; exit 1; fi
for made in popover.html access.html settings.html status.js insert.js composer-extension/manifest.json; do
  if [ ! -f "Resources/$made" ]; then echo "Resources/$made is missing. It is made by: node ../dev/build-popover.js"; exit 1; fi
done

APP="build/Context.app"
rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -swift-version 5 -parse-as-library \
  -target "$(uname -m)-apple-macos12.0" \
  -framework AppKit -framework WebKit -framework JavaScriptCore -framework Carbon \
  -o "$APP/Contents/MacOS/WorkIndex" \
  Sources/App.swift Sources/Access.swift Sources/Status.swift Sources/Bridge.swift Sources/Host.swift Sources/Scripts.swift \
  Sources/Settings.swift Sources/HotKey.swift Sources/Composer.swift Sources/ComposerHost.swift Sources/SelfTest.swift

cp Info.plist "$APP/Contents/Info.plist"
cp Resources/popover.html Resources/access.html Resources/settings.html Resources/status.js Resources/insert.js "$APP/Contents/Resources/"
cp -R Resources/composer-extension "$APP/Contents/Resources/composer-extension"
codesign --force --sign - "$APP" >/dev/null

echo "Built: $(pwd)/$APP"
echo
"$APP/Contents/MacOS/WorkIndex" --self-test

if [ "${1:-}" = "install" ]; then
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Context.app"
  cp -R "$APP" "$HOME/Applications/Context.app"
  echo
  echo "Installed: $HOME/Applications/Context.app"
fi
echo
echo "Start it with:  open \"$APP\"   (a tag icon appears in the menu bar; Quit is at the bottom of its popover)"
