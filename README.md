# CineScreen

> Cinematic screen recording for macOS — turn raw captures into polished product videos.

Native macOS screen recorder built in Swift, SwiftUI, and Metal. Capture any
window or display with **ScreenCaptureKit**; polish it in a per-frame
timeline editor with smooth cursor motion, automatic zooms, and gradient
backdrops; then export through an **AVAssetWriter** pipeline that never drops a
frame.

Free and open source (MIT) · macOS 14+ · Apple Silicon & Intel.

**[⬇ Download for Mac](https://github.com/jasonzh0/CineScreen/releases/latest)** · [Product page & demo](https://jasonzhang.dev/apps/cinescreen)

## Features

### 🎥 Capture — pixel-perfect ScreenCaptureKit
Apple's native capture API drives every frame. Pick a window or a display —
CineScreen pipes the raw stream straight into a Metal compositor.

### ✨ Compose — polish without thinking
Smooth cursor motion, automatic click highlights, and zoom keyframes you tune
in the timeline. Style recordings with gradient backdrops, padding, and rounded
window chrome.

### 📦 Export — AVAssetWriter, no compromises
A dedicated export compositor renders the final video offline at a locked frame
rate. ProRes or H.264, no dropped frames, signed and notarized `.dmg`.

## How it works

Tap record, pick a window or display, and the editor opens with your clip
already loaded.

1. **Install** — drag CineScreen into Applications and launch it.
2. **Grant access** — enable Screen Recording for CineScreen in System Settings, then relaunch.
3. **Record** — open the floating control bar, pick a window or display, hit record. Stop, and your clip drops straight into the editor.
4. **Export** — style, scrub, and tune; the Metal compositor renders every frame offline at a locked frame rate.

## Auto-updates

CineScreen updates itself in place via [Sparkle](https://sparkle-project.org).
Because the app is replaced at its existing path, macOS keeps the Screen
Recording / Accessibility permissions you already granted — **no re-granting
after updates**. The app verifies each download against an embedded EdDSA key
before installing. See [docs/UPDATES.md](docs/UPDATES.md) for the full pipeline.

## Tech stack

`Swift 5.9` · `SwiftUI` · `Metal` · `ScreenCaptureKit` · `AVFoundation` · `AVAssetWriter` · `AppKit` · [`Sparkle`](https://github.com/sparkle-project/Sparkle)

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

**Cutting a release:** bump `MARKETING_VERSION` in `project.yml`, commit, then push a
`vX.Y.Z` tag. The `.github/workflows/release.yml` pipeline signs with Developer ID,
notarizes, publishes the GitHub Release, and deploys the Sparkle appcast to GitHub
Pages — which auto-updates existing users.

## Layout

```
.
├── project.yml              # XcodeGen spec
├── Makefile                 # build/sign/notarize targets
├── exportOptions.plist      # xcodebuild -exportArchive options
├── scripts/                 # make_release.sh (archive→sign→notarize→DMG/appcast)
├── docs/                    # UPDATES.md (Sparkle auto-update setup)
├── Tests/                   # CineScreenTests unit tests (`make test`)
└── CineScreen/
    ├── App/                 # @main + root views, Sparkle updater
    ├── Capture/             # ScreenCaptureKit + mouse tracking
    ├── Compositor/          # Metal renderer
    ├── ControlBar/          # floating control bar window
    ├── Editor/              # SwiftUI editor + per-frame state
    ├── Export/              # AVAssetWriter export pipeline
    ├── MainWindow/          # projects library, settings
    ├── Models/              # metadata + project structs
    ├── Projects/            # project library on disk
    ├── Util/
    └── Resources/           # Assets.xcassets, Info.plist, entitlements
```

## Requirements

macOS 14 (Sonoma) or later · Apple Silicon & Intel.

## License

MIT — see [LICENSE](LICENSE).
