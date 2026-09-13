#!/usr/bin/env bash
# Package Scrubber for each browser.
#
#   ./build.sh stage      -> build/extension/  (only the files an extension may contain)
#   ./build.sh chrome     -> dist/scrubber-<version>.zip  (same zip serves Edge Add-ons)
#   ./build.sh edge       -> alias for chrome; the stores take an identical package
#   ./build.sh safari     -> stages, converts, and repairs the Xcode project
#   ./build.sh safari-app -> the above, then builds Scrubber.app and installs it
#   ./build.sh safari-ios -> convert with the iOS target too (needs the iOS platform:
#                            xcodebuild -downloadPlatform iOS)
#
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
STAGE="$ROOT/build/extension"
PROJECT="$(dirname "$ROOT")/scrubber-safari"
XCODEPROJ="$PROJECT/Scrubber/Scrubber.xcodeproj"
APP_NAME="Scrubber"
BUNDLE_ID="dev.myndar.scrubber"
INSTALL_DIR="/Applications"

# Single source of truth for the version: manifest.json. Both the zip name and
# the Safari wrapper app's MARKETING_VERSION come from here, so they cannot drift.
version() {
  /usr/bin/python3 -c 'import json;print(json.load(open("manifest.json"))["version"])'
}

stage() {
  # Only the staging dir. build/ also holds DerivedData for the Safari target, and
  # Xcode's SWBBuildService daemon outlives the build and recreates its module cache
  # under us — so rm -rf on the whole tree intermittently fails "Directory not empty"
  # and set -e takes the script down with it.
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  # ONLY extension files. No README, build.sh, dist/, .gitignore, or previous
  # output directories — the converter reads the whole folder it is given.
  cp manifest.json "$STAGE/"
  cp -R src "$STAGE/"
  cp -R icons "$STAGE/"
  # strip macOS cruft that can upset packaging
  find "$STAGE" -name '.DS_Store' -delete 2>/dev/null || true
  xattr -cr "$STAGE" 2>/dev/null || true
  echo "staged -> $STAGE"
}

# The converter does not copy the extension payload into the generated project.
# It adds manifest.json / src / icons to the appex Resources build phase as file
# references pointing back at whatever folder it was handed — here build/extension,
# which stage() deletes on the next run. The project then builds an extension with
# no resources, and Safari registers something that silently does nothing.
#
# Fix: copy the payload into "<target> Extension/Resources" and rewrite those
# references to point there, so the project stands on its own.
resdir() {
  local ext_dir
  ext_dir="$PROJECT/Scrubber/$APP_NAME Extension"
  [ -d "$ext_dir" ] || ext_dir="$PROJECT/Scrubber/Shared (Extension)"
  [ -d "$ext_dir" ] || { echo "no extension target dir under $PROJECT/Scrubber" >&2; exit 1; }
  echo "$ext_dir/Resources"
}

# The project carries its own copy of the payload, so editing src/ does nothing
# until that copy is refreshed. Every build re-syncs it rather than trusting
# whatever was captured at conversion time.
syncres() {
  local res; res="$(resdir)"
  rm -rf "$res"
  mkdir -p "$res"
  cp -R "$STAGE"/* "$res/"
  find "$res" -name '.DS_Store' -delete 2>/dev/null || true
  echo "resources synced -> $res"
}

selfcontain() {
  syncres

  # path = ../../../..<abs path>/build/extension/src  ->  path = Resources/src
  /usr/bin/sed -i '' -E 's#path = "?\.\.[^;"]*/build/extension/([^;"]*)"?;#path = Resources/\1;#' \
    "$XCODEPROJ/project.pbxproj"

  if grep -q 'build/extension' "$XCODEPROJ/project.pbxproj"; then
    echo "FAILED — project.pbxproj still references the staging folder:" >&2
    grep -n 'build/extension' "$XCODEPROJ/project.pbxproj" >&2
    exit 1
  fi
  echo "self-contained -> $res"
}

# The converter derives the two bundle identifiers from different inputs: the app
# gets <prefix>.<AppName> (from --app-name, so "Scrubber") while the appex gets
# <--bundle-identifier>.Extension (so "scrubber"). The case differs, so the appex
# id is not prefixed by the app id and ValidateEmbeddedBinary fails the build.
# Pin both to $BUNDLE_ID — ViewController.swift already hardcodes the .Extension form.
fixbundleids() {
  local pbx="$XCODEPROJ/project.pbxproj"
  /usr/bin/awk -v app="$BUNDLE_ID" -v ext="$BUNDLE_ID.Extension" '
    /PRODUCT_BUNDLE_IDENTIFIER = / {
      if ($0 ~ /\.Extension;/) sub(/= [^;]*;/, "= " ext ";")
      else                      sub(/= [^;]*;/, "= " app ";")
    }
    { print }
  ' "$pbx" > "$pbx.tmp" && mv "$pbx.tmp" "$pbx"
  echo "bundle ids -> $BUNDLE_ID / $BUNDLE_ID.Extension"
}

verify() {
  local res
  res="$(dirname "$XCODEPROJ")/$APP_NAME Extension/Resources"
  [ -d "$res" ] || res="$(dirname "$XCODEPROJ")/Shared (Extension)/Resources"
  if [ -f "$res/manifest.json" ]; then
    echo "OK — extension resources in place:"
    find "$res" -type f | sed "s|$res/|  |"
  else
    echo "FAILED — no Resources/manifest.json in the generated project." >&2
    echo "Full converter output is in build/convert.log" >&2
    exit 1
  fi
}

convert() {
  command -v xcrun >/dev/null || { echo "xcrun not found — needs macOS with Xcode" >&2; exit 1; }
  xcrun --find safari-web-extension-converter >/dev/null 2>&1 || {
    echo "safari-web-extension-converter not found. It ships inside Xcode.app only:" >&2
    echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
    exit 1
  }
  stage
  rm -rf "$PROJECT"

  # The converter dies during iOS platform setup when the iOS platform isn't
  # fully installed — it prints "Platform: All" and exits silently. macOS-only
  # skips that code path.
  local platform_flag="--macos-only"
  [ "${1:-}" = "ios" ] && platform_flag=""

  echo
  echo "converting $STAGE -> $PROJECT ${platform_flag:-(all platforms)}"
  echo
  set +e
  xcrun safari-web-extension-converter "$STAGE" \
    --app-name "$APP_NAME" \
    --bundle-identifier "$BUNDLE_ID" \
    --project-location "$PROJECT" \
    $platform_flag \
    --no-open 2>&1 | tee "$ROOT/build/convert.log"
  local rc=${PIPESTATUS[0]}
  set -e
  [ "$rc" -ne 0 ] && echo "converter exited with status $rc"
  echo
  selfcontain
  fixbundleids
  verify
}

case "${1:-chrome}" in
  stage)
    stage
    find "$STAGE" -type f | sed "s|$STAGE/|  |"
    ;;

  # One package serves both Chromium stores — Edge Add-ons accepts a Chrome MV3
  # zip unchanged, so there is nothing to vary between them. Named by version
  # because both dashboards reject a re-upload that reuses a published version.
  chrome|edge|package)
    stage
    mkdir -p dist
    V="$(version)"
    ZIP="$ROOT/dist/scrubber-$V.zip"
    rm -f "$ZIP"
    # -X strips the extra file attributes (uid/gid, resource forks) that make the
    # archive differ between machines for identical input.
    ( cd "$STAGE" && zip -qrX "$ZIP" . )
    echo "dist/scrubber-$V.zip  ->  upload to both Chrome Web Store and Edge Add-ons"
    ;;

  safari)
    convert
    echo
    echo "next: ./build.sh safari-app   (or open \"$XCODEPROJ\" and Run)"
    ;;

  safari-ios)
    convert ios
    ;;

  safari-app)
    if [ -d "$XCODEPROJ" ]; then stage; syncres; else convert; fi
    DD="$ROOT/build/DerivedData"
    # Keep the wrapper app's version in step with the extension's, otherwise the
    # app reports the converter's placeholder 1.0 next to a 0.2.0 extension.
    VERSION="$(version)"

    # Safari refuses to even LIST an ad-hoc signed extension — no error, it just
    # omits it — unless Develop > "Allow unsigned extensions" is on, and that
    # resets on every Safari restart. So sign properly whenever an Apple ID is
    # signed into Xcode. Team is auto-detected; override with DEV_TEAM=XXXX.
    DEV_TEAM="${DEV_TEAM:-$(/usr/bin/plutil -p ~/Library/Preferences/com.apple.dt.Xcode.plist 2>/dev/null \
      | /usr/bin/awk -F'"' '/"teamID"/{print $4; exit}')}"

    if [ -n "$DEV_TEAM" ]; then
      echo
      echo "building $APP_NAME.app $VERSION (signed, team $DEV_TEAM)"
      echo
      SIGN_ARGS=(
        -allowProvisioningUpdates
        CODE_SIGN_STYLE=Automatic
        DEVELOPMENT_TEAM="$DEV_TEAM"
      )
    else
      echo
      echo "building $APP_NAME.app $VERSION (ad-hoc — no Apple ID in Xcode;"
      echo "  Safari will need Develop > Allow unsigned extensions every restart)"
      echo
      SIGN_ARGS=(
        CODE_SIGN_IDENTITY="-"
        CODE_SIGN_STYLE=Manual
        DEVELOPMENT_TEAM=""
        PROVISIONING_PROFILE_SPECIFIER=""
      )
    fi

    xcodebuild -project "$XCODEPROJ" \
      -scheme "$APP_NAME" \
      -configuration Release \
      -derivedDataPath "$DD" \
      "${SIGN_ARGS[@]}" \
      MARKETING_VERSION="$VERSION" \
      build

    BUILT="$DD/Build/Products/Release/$APP_NAME.app"
    [ -d "$BUILT" ] || { echo "FAILED — no app at $BUILT" >&2; exit 1; }

    # Safari only registers an extension whose containing app it can see in a
    # stable location; a DerivedData path is not one.
    rm -rf "${INSTALL_DIR:?}/$APP_NAME.app"
    cp -R "$BUILT" "$INSTALL_DIR/"

    # Why the extension kept "disappearing" from Safari:
    #
    # xcodebuild registers the appex it just built — the one in DerivedData — with
    # pluginkit. Copying the app to /Applications afterwards does NOT move that
    # registration. pluginkit keeps one record per bundle identifier, and that record
    # went on pointing into build/DerivedData. So Safari was loading the extension
    # from a build directory, and the moment that directory was cleaned or rebuilt the
    # record dangled and Safari silently dropped the extension from its list.
    #
    # Point the registration at the copy that is actually meant to be permanent.
    pluginkit -r "$BUILT/Contents/PlugIns/$APP_NAME Extension.appex" 2>/dev/null || true
    pluginkit -a "$INSTALL_DIR/$APP_NAME.app/Contents/PlugIns/$APP_NAME Extension.appex"

    echo
    echo "installed -> $INSTALL_DIR/$APP_NAME.app"
    echo "registered -> $(pluginkit -mAv 2>/dev/null | grep -i "$APP_NAME Extension.appex" | head -1 | sed 's|.*\t||')"
    find "$INSTALL_DIR/$APP_NAME.app/Contents/PlugIns/$APP_NAME Extension.appex/Contents/Resources" \
      -type f 2>/dev/null | sed "s|.*Resources/|  appex: |"
    ;;

  *)
    echo "usage: ./build.sh [stage|chrome|edge|safari|safari-app|safari-ios]" >&2; exit 1 ;;
esac
