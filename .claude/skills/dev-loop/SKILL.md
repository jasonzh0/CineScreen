---
name: dev-loop
description: Build, test, and iterate on CineScreen — XcodeGen workflow, make targets, stale-module fixes, and verification discipline. Use when building, running, or testing this repo, or when the build fails mysteriously.
---

# CineScreen development loop

## Project generation — edit project.yml, never the pbxproj

`CineScreen.xcodeproj` is **gitignored and generated**. Adding files, targets,
settings, or SPM packages happens in `project.yml`, then:

```bash
make project     # xcodegen generate
```

New Swift files under `CineScreen/` or `Tests/CineScreenTests/` are picked up
by the source globs automatically — but the xcodeproj must be regenerated to
see them.

## Build / test / run

```bash
make build       # Debug build (the type-check gate — run before claiming any change works)
make test        # unit tests (CineScreenTests, app-hosted, ~20s incremental)
make open        # open in Xcode
```

Verification discipline: a change is not done until `make build` (or
`make test` when logic changed) passes. There is no standalone type-checker —
the build IS the check.

## Known failure modes

- **SourceKit/IDE diagnostics say "Cannot find type X in scope" everywhere**
  for types that clearly exist (CTheme, RecordingMetadata, Log, …): false
  positives when the xcodeproj hasn't been generated or is stale. Ignore
  them; trust `make build`. Run `make project` to quiet the IDE.
- **"file has been modified since the module file was built"** (usually a
  Sparkle header): stale precompiled modules after a dependency version
  change. Fix: `rm -rf build/derived` and rebuild.
- **Sparkle is pinned to exactly 2.6.4** in project.yml. Don't float it —
  Package.resolved lives inside the gitignored xcodeproj and can't pin
  anything, and CI pins the 2.6.4 appcast CLI tools to match.

## CI

`.github/workflows/build.yml` builds + tests every PR **and every push to
main** (unsigned Debug). Releases run `release.yml` on `v*.*.*` tags only —
see the `release` skill.
