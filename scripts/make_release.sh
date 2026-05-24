#!/usr/bin/env bash
# Build a Release archive of CineScreen.app, optionally sign with Developer ID,
# notarize with Apple, staple, and package into DMG + ZIP. Final artifacts land
# in release/.
#
# Modes:
#   make_release.sh                  Full pipeline (archive -> sign -> notarize -> DMG/ZIP)
#   make_release.sh --archive-only   Stop after archiving; useful for smoke tests
#   make_release.sh --no-notarize    Skip notarization (still signs + packages)
#
# Required env for signing (omit and the script falls back to ad-hoc signing,
# which produces an unnotarized build only useful on the build machine itself):
#   DEVELOPER_ID_APPLICATION     e.g. "Developer ID Application: Jane Doe (ABCDE12345)"
#   APPLE_TEAM_ID                e.g. "ABCDE12345"
#
# Required env for notarization (only if not --no-notarize):
#   APPLE_ID                     Apple ID email
#   APPLE_APP_SPECIFIC_PASSWORD  app-specific password from appleid.apple.com
#
# Optional env (used by the GitHub Actions workflow):
#   KEYCHAIN_NAME / KEYCHAIN_PASSWORD  Temporary keychain that the workflow
#                                       imports the cert into. Unlocked before
#                                       signing.

set -euo pipefail

ARCHIVE_ONLY=0
NOTARIZE=1
for arg in "$@"; do
  case "$arg" in
    --archive-only) ARCHIVE_ONLY=1 ;;
    --no-notarize)  NOTARIZE=0 ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT="CineScreen.xcodeproj"
SCHEME="CineScreen"
RELEASE_DIR="release"
BUILD_DIR="$RELEASE_DIR/build"
ARCHIVE_PATH="$BUILD_DIR/CineScreen.xcarchive"
EXPORT_PATH="$BUILD_DIR/export"
APP_PATH="$EXPORT_PATH/CineScreen.app"

VERSION="$(grep -E '^\s*MARKETING_VERSION:' project.yml | head -1 | sed 's/.*"\(.*\)".*/\1/')"
ARCH="$(uname -m)"
DMG_PATH="$RELEASE_DIR/CineScreen-${VERSION}-${ARCH}.dmg"
ZIP_PATH="$RELEASE_DIR/CineScreen-${VERSION}-${ARCH}.zip"

rm -rf "$RELEASE_DIR/build" "$EXPORT_PATH"
mkdir -p "$BUILD_DIR" "$RELEASE_DIR"

# ---------------------------------------------------------------------------
# Archive
# ---------------------------------------------------------------------------
echo "==> xcodebuild archive (Release, $ARCH)"

XCODEBUILD_ARGS=(
  -project "$PROJECT"
  -scheme "$SCHEME"
  -configuration Release
  -archivePath "$ARCHIVE_PATH"
  -destination "generic/platform=macOS"
)

if [[ -n "${DEVELOPER_ID_APPLICATION:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  echo "    Signing identity: $DEVELOPER_ID_APPLICATION"
  XCODEBUILD_ARGS+=(
    CODE_SIGN_STYLE=Manual
    "CODE_SIGN_IDENTITY=$DEVELOPER_ID_APPLICATION"
    "DEVELOPMENT_TEAM=$APPLE_TEAM_ID"
  )
  if [[ -n "${KEYCHAIN_NAME:-}" ]]; then
    XCODEBUILD_ARGS+=("OTHER_CODE_SIGN_FLAGS=--keychain $KEYCHAIN_NAME --timestamp")
  fi
else
  echo "    No DEVELOPER_ID_APPLICATION/APPLE_TEAM_ID set — building ad-hoc signed."
  XCODEBUILD_ARGS+=(
    CODE_SIGN_STYLE=Manual
    CODE_SIGN_IDENTITY="-"
    "DEVELOPMENT_TEAM="
  )
fi

if [[ -n "${KEYCHAIN_NAME:-}" && -n "${KEYCHAIN_PASSWORD:-}" ]]; then
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_NAME"
fi

xcodebuild archive "${XCODEBUILD_ARGS[@]}"

# ---------------------------------------------------------------------------
# Export — when signing with Developer ID, use exportArchive (it handles
# re-signing for distribution). Without an identity, just copy the .app out
# of the xcarchive directly.
# ---------------------------------------------------------------------------
mkdir -p "$EXPORT_PATH"
if [[ -n "${DEVELOPER_ID_APPLICATION:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  EXPORT_PLIST="$BUILD_DIR/ExportOptions.plist"
  cat > "$EXPORT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>developer-id</string>
  <key>signingStyle</key><string>manual</string>
  <key>teamID</key><string>$APPLE_TEAM_ID</string>
  <key>destination</key><string>export</string>
</dict>
</plist>
PLIST

  echo "==> xcodebuild -exportArchive (developer-id)"
  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_PATH" \
    -exportOptionsPlist "$EXPORT_PLIST"
else
  echo "==> Copying .app from xcarchive (no Developer ID set)"
  ARCHIVE_APP="$ARCHIVE_PATH/Products/Applications/CineScreen.app"
  if [[ ! -d "$ARCHIVE_APP" ]]; then
    echo "Archive did not produce $ARCHIVE_APP" >&2
    exit 1
  fi
  cp -R "$ARCHIVE_APP" "$EXPORT_PATH/"
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "Export did not produce $APP_PATH" >&2
  exit 1
fi

if [[ "$ARCHIVE_ONLY" == "1" ]]; then
  echo "==> Archive-only complete: $APP_PATH"
  exit 0
fi

# ---------------------------------------------------------------------------
# Notarize + staple (only when fully signed with Developer ID)
# ---------------------------------------------------------------------------
if [[ "$NOTARIZE" == "1" ]]; then
  if [[ -z "${APPLE_ID:-}" || -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" || -z "${APPLE_TEAM_ID:-}" ]]; then
    echo "==> Skipping notarization (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not all set)"
  elif [[ -z "${DEVELOPER_ID_APPLICATION:-}" ]]; then
    echo "==> Skipping notarization (build is ad-hoc signed, not Developer ID)"
  else
    NOTARY_ZIP="$BUILD_DIR/CineScreen-notary.zip"
    echo "==> Zipping for notarization: $NOTARY_ZIP"
    ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$NOTARY_ZIP"

    echo "==> notarytool submit (waiting for result)"
    xcrun notarytool submit "$NOTARY_ZIP" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_APP_SPECIFIC_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" \
      --wait

    echo "==> Stapling notarization ticket"
    xcrun stapler staple "$APP_PATH"
    xcrun stapler validate "$APP_PATH"
  fi
fi

# ---------------------------------------------------------------------------
# Package: DMG + ZIP
# ---------------------------------------------------------------------------
rm -f "$DMG_PATH" "$ZIP_PATH"

echo "==> Creating $ZIP_PATH"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

echo "==> Creating $DMG_PATH"
DMG_STAGE="$BUILD_DIR/dmg-stage"
rm -rf "$DMG_STAGE"
mkdir -p "$DMG_STAGE"
cp -R "$APP_PATH" "$DMG_STAGE/"
ln -s /Applications "$DMG_STAGE/Applications"
hdiutil create \
  -volname "CineScreen $VERSION" \
  -srcfolder "$DMG_STAGE" \
  -ov \
  -format UDZO \
  "$DMG_PATH" >/dev/null

if [[ "$NOTARIZE" == "1" && -n "${DEVELOPER_ID_APPLICATION:-}" \
   && -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  echo "==> Notarizing DMG"
  xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait
  xcrun stapler staple "$DMG_PATH"
fi

echo
echo "==> Done."
ls -lh "$DMG_PATH" "$ZIP_PATH"
