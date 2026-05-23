# CineScreen

Native macOS screen recording app — Swift / SwiftUI / Metal.

## Bootstrap

Prereqs: macOS 14+, Xcode 15+, [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
brew install xcodegen
make project   # generate CineScreen.xcodeproj from project.yml
make open      # open in Xcode
```

`CineScreen.xcodeproj` is gitignored — it's regenerated from `project.yml`. Edit `project.yml` (not the pbxproj) when adding files or changing settings.

## Build · Run · Release

```bash
make build           # debug build (current arch)
make build-release   # release build (universal)
make archive         # xcarchive for distribution
make export          # signed .app from archive
make dmg             # package .app into .dmg
make notarize        # submit DMG to Apple and staple
make release         # full pipeline
make clean           # nuke build/ and CineScreen.xcodeproj
```

For local notarization, run once:

```bash
xcrun notarytool store-credentials cinescreen-notary \
  --apple-id YOU@example.com \
  --team-id JAT3GYBPJ4 \
  --password APP-SPECIFIC-PASSWORD
```

CI handles signing + notarization in `.github/workflows/build.yml`.

## Layout

```
.
├── project.yml              # XcodeGen spec
├── Makefile                 # build/sign/notarize targets
├── exportOptions.plist      # xcodebuild -exportArchive options
├── scripts/
└── CineScreen/
    ├── App/                 # @main + root views
    ├── Capture/             # ScreenCaptureKit + mouse tracking
    ├── Compositor/          # Metal renderer
    ├── ControlBar/          # floating control bar window
    ├── Editor/              # SwiftUI editor + per-frame state
    ├── Export/              # AVAssetWriter export pipeline
    ├── MainWindow/          # projects library, settings
    ├── Models/              # metadata + project structs
    ├── Projects/            # project library on disk
    ├── StatusItem/          # menu-bar UI
    ├── Util/
    └── Resources/           # Assets.xcassets, Info.plist, entitlements
```

## Min macOS

14.0 (Sonoma).
