---
name: pitfalls
description: CineScreen's sharp edges and invariants — metadata invalidation, zoom-section rules, coordinate spaces, PTS rebasing, AVFoundation callback traps, SwiftUI gesture state, autosave suppression. Read before modifying capture, editor, or export code.
---

# Common pitfalls & invariants

## Editor state

- **`EditorViewModel.metadata.didSet` is the single invalidation choke
  point**: it clears `cachedSnapshot` + `cachedZoomSections` and schedules
  the debounced autosave. Mutate metadata *through the property* (value-type
  write-back does this automatically, e.g. `metadata?.zoom.sections = …`).
  Never cache derived render state anywhere else.
- **`suppressAutosave` must wrap any code that loads state INTO the VM**
  (loadMetadata, derived defaults) — otherwise merely opening a recording
  rewrites its sidecar.
- **Trim lives twice** (vm.trimStartMs/EndMs ↔ metadata.trim) and is synced
  by the trim didSets. Don't add a third copy.
- **Zoom sections invariant: sorted by startTime, non-overlapping, ≥100ms.**
  `updateZoomSection` enforces it by clamping to neighbours (which is also
  why no mid-drag re-sort is needed — a drag can't cross a neighbour).
  `RenderSnapshot.init` sorts defensively; the pan table is binary-searched
  by time and breaks on non-monotonic input.
- **Drag gesture baselines must be `@GestureState`, not `@State`** — SwiftUI
  never calls `onEnded` for a *cancelled* gesture, and stale `@State` wedged
  scrubbing/drags before. Same for pinch: `MagnifyGesture.magnification` is
  cumulative from gesture start; scale a gesture-start baseline or it
  compounds exponentially.

## Coordinate spaces (four of them — never mix)

1. **CGEvent global points**: top-left origin of the primary display. This is
   what the mouse tap yields. (NSEvent.mouseLocation is bottom-left Cocoa —
   convert once using the *primary* screen, not NSScreen.main.)
2. **Recorded-file pixels**: top-left; metadata keyframes/clicks live here.
   Mapping: `(global − CaptureInfo.contentRectPoints.origin) × px/pt`.
3. **UV [0,1]²** in shaders (video space), then **NDC** with y-up; canvas
   passes multiply `aspectScale` then `canvas.contentScale` — every overlay
   pass (video, cursor, clicks) must apply both or it drifts under padding.
4. **Webcam layout norms** are relative to the *padded content rect*:
   on-screen px = norm × contentScale × viewSize. Invert exactly.

## Timing

- All capture PTS are **rebased so the file starts at 0** (first screen
  frame is the base; mic + system audio rebase against it and drop
  negative-PTS samples).
- **Webcam**: screenT = webcamT + `metadata.webcamOffsetMs` (camera warm-up).
  Editor seeks and export reads must apply the mapping; playback defers the
  webcam start inside the warm-up gap.
- Recorded duration comes from the **last video frame's rebased PTS**, not
  wall clock (wall clock includes ~0.3–1s of startup latency).

## AVFoundation traps

- `requestMediaDataWhenReady` blocks are **re-invoked after failures** (a
  failed writer forces `isReadyForMoreMediaData=true` so you can poll the
  error). Any continuation resumed from such a block needs a resume-once
  guard + `markAsFinished()` — see ExportPipeline's `finish(_:)` pattern.
  Double-resume = runtime trap.
- With multiple writer inputs, the writer **interleaves**: a stalled/failed
  input blocks the others forever. Mark the failed input finished so
  siblings' callbacks fire and can exit (shared `ExportSessionState`).
- `alwaysCopiesSampleData = true` on reader outputs feeding
  CVMetalTextureCache is load-bearing: cached textures pin decoder pool
  buffers; without copies the decoder stalls (~2s in, export "freezes").
- Export writes to a hidden temp file and promotes atomically on success —
  never write directly to the user's chosen path.

## Capture

- `ScreenCaptureService.stop()` tolerates an already-dead stream — stream
  death mid-recording routes through `onRuntimeFailure` → RecordingSession
  salvages via the normal stop path.
- The stop hotkey is **⌥⎋ exactly** (caps-lock tolerated). Never rebind to
  unmodified ESC (it silently ended recordings from the recorded app) and
  never match ⌘⌥⎋ (Force Quit).
- After granting Screen Recording, macOS requires an **app relaunch** before
  `CGPreflightScreenCaptureAccess()` returns true — a permission that "won't
  turn green" in-process is expected, not a bug.
- `_CGSCurrentCursorSeed` is private SPI (cursor-shape detection). It can
  vanish in an OS update; if cursor-shape code crashes at launch, look here.

## Process & release

- Each improvement = its own commit, pushed (user preference).
- `NSSupportsAutomaticTermination` must stay **false** — a recorder with all
  regular windows hidden must not be reclaimable mid-capture.
- CFBundleVersion = `git rev-list --count HEAD` (Sparkle monotonicity).
  History rewrites that reduce the commit count below the last release's
  would break auto-update — check before squashing/rebasing main.
- The release tag must equal project.yml's MARKETING_VERSION (CI preflight
  enforces it).
