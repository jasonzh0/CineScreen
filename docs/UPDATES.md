# Auto-updates (Sparkle)

CineScreen updates itself in place with [Sparkle](https://sparkle-project.org).
Updating the app at its existing path keeps its Developer ID code-signing
identity, so macOS (TCC) preserves the permissions the user already granted —
**Accessibility and Screen Recording survive updates with no re-granting.**
This is the whole reason we use Sparkle instead of "download a new DMG": a
freshly downloaded bundle is re-quarantined and gets a new on-disk identity,
which is what forced users to re-grant before.

## How it works

- The app reads its feed from `SUFeedURL` in `Info.plist`:
  `https://jasonzh0.github.io/CineScreen/appcast.xml` (GitHub Pages).
- Each release's CI run signs the `.zip` with an EdDSA key, writes an
  `appcast.xml` whose enclosure points at that tag's GitHub release asset, and
  publishes the appcast to the `gh-pages` branch.
- The app verifies the download against the EdDSA **public** key embedded in
  `Info.plist` (`SUPublicEDKey`) before installing.
- "Check for Updates…" lives in the app menu (after About) and in
  Settings → General → Updates, alongside the automatic-check toggle.

Sparkle compares `CFBundleVersion` to decide what's newer. `project.yml` pins
it to `1`; `make_release.sh` overrides it per release with a monotonic build
number from `git rev-list --count HEAD`, so CI must check out full history
(`fetch-depth: 0`, already set).

## One-time setup (required before the first updatable release)

### 1. Generate the EdDSA signing key

Run Sparkle's `generate_keys` once (download the Sparkle release tarball from
<https://github.com/sparkle-project/Sparkle/releases> and use `bin/generate_keys`):

```sh
./bin/generate_keys
```

It stores the **private** key in your login keychain and prints the **public**
key (a base64 string).

- Put the public key in `CineScreen/Info.plist` under `SUPublicEDKey`,
  replacing `REPLACE_WITH_SPARKLE_PUBLIC_ED_KEY`.
- Export the private key for CI:

  ```sh
  ./bin/generate_keys -x sparkle_private_key.txt
  ```

  Copy the file's contents into a GitHub Actions secret named
  **`SPARKLE_PRIVATE_KEY`** (repo → Settings → Secrets and variables → Actions).
  Then delete the file. Keep this key safe and backed up — losing it means
  clients can no longer verify updates and you'd have to ship a hard-coded new
  key in a non-Sparkle update.

### 2. Enable GitHub Pages

Repo → Settings → Pages → Build and deployment → Source: **Deploy from a
branch**, branch **`gh-pages`** / root. The release workflow creates and pushes
to `gh-pages` automatically; you just need Pages serving from it. Confirm the
published URL matches `SUFeedURL`
(`https://jasonzh0.github.io/CineScreen/appcast.xml`).

## Cutting a release

Unchanged from before — push a `vX.Y.Z` tag. The pipeline now additionally:

1. derives the build number, signs the zip, and writes `release/appcast.xml`;
2. uploads `appcast.xml` alongside the DMG/ZIP artifacts;
3. publishes the GitHub Release, then deploys `appcast.xml` to `gh-pages`.

## Local appcast generation (optional)

`make_release.sh` generates the appcast only when the Sparkle tools and key are
available:

```sh
export SPARKLE_BIN=/path/to/Sparkle/bin               # dir with generate_appcast
export SPARKLE_PRIVATE_KEY_FILE=/path/to/private_key  # exported via generate_keys -x
export SPARKLE_DOWNLOAD_URL_PREFIX=https://github.com/jasonzh0/CineScreen/releases/download/v2.3.2/
bash scripts/make_release.sh
```

Without these it skips the appcast step and behaves exactly as before.

## Notarization

Sparkle ships nested executables (`Updater.app`, `Autoupdate`, XPC services).
`xcodebuild -exportArchive` with `method=developer-id` deep-signs them with the
Developer ID identity, hardened runtime, and a secure timestamp, which is what
notarization requires. Sanity-check the first Sparkle release: if `notarytool`
reports issues, run `xcrun notarytool log <submission-id>` — it pinpoints any
nested binary that wasn't signed correctly.

## Migration note

The first build that ships Sparkle still has to be installed the old way (it's
the version users already have, or a fresh download). From then on, every
subsequent update flows through Sparkle in place, and the re-granting problem
is gone.
