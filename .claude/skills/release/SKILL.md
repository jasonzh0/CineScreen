---
name: release
description: Cut a CineScreen release — version bump, tag, CI pipeline, Sparkle appcast, and the invariants that keep auto-update working. Use when releasing a new version or debugging the release/update pipeline.
---

# Cutting a release

## The happy path

1. Bump `MARKETING_VERSION` in **project.yml** (nowhere else).
2. Commit and push to main; wait for CI green.
3. Tag and push — the tag must match the version exactly:

   ```bash
   git tag v2.6.0 && git push origin v2.6.0
   ```

4. `release.yml` takes over: preflight asserts tag == MARKETING_VERSION,
   then the reusable build workflow signs with Developer ID (secrets),
   notarizes the app ZIP + DMG, staples, EdDSA-signs the ZIP, generates
   `appcast.xml`, publishes a GitHub Release, and deploys the appcast to
   `gh-pages`. Existing users auto-update via Sparkle.

## Invariants — break these and auto-update breaks

- **Tag == MARKETING_VERSION.** CI preflight fails the release otherwise.
  Without it, Sparkle would still push mismatched assets to every user,
  because…
- **CFBundleVersion = `git rev-list --count HEAD`** (set by
  scripts/make_release.sh). It must increase every release. Never rewrite
  main's history in a way that drops the commit count below the previous
  release's count.
- **Sparkle framework is pinned to exactly 2.6.4** in project.yml, matching
  the `SPARKLE_VERSION` CLI tools pinned in build-workflow.yml. Bump both
  together.
- **`SUPublicEDKey` in Info.plist is the real production key.** Updates are
  signature-verified against it; the matching private key is the
  `SPARKLE_PRIVATE_KEY` repo secret.
- In-place updates preserve TCC grants (Screen Recording/Accessibility)
  because the app is replaced at its existing path with the same signing
  identity — don't change the bundle id or signing identity casually.

## Artifacts

`CineScreen-<version>-universal.{dmg,zip}` — the archive is universal
(ARCHS_STANDARD, ONLY_ACTIVE_ARCH=NO). The ZIP is what the appcast
enclosures point at; the DMG is the human download.

## Local / debugging

- `bash scripts/make_release.sh` is the real pipeline (the Makefile's
  archive/export/dmg targets are a simplified local approximation).
- `--archive-only` stops after archiving.
- Notarization credentials: `xcrun notarytool store-credentials
  cinescreen-notary …` (see README).
- There is deliberately **no workflow_dispatch** on release.yml — running it
  from a branch baked broken enclosure URLs into the appcast. Tag pushes
  only.
