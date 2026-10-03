# CineScreen feature parity and motion audit

> Baseline audit of commit `996d7dc`. The findings below describe the pre-change build. See [the implementation follow-up](SCREEN_STUDIO_IMPLEMENTATION.md) for completed changes and current validation.

CineScreen has the basic capture and rendering foundation, but its motion behavior and editing workflow still leave substantial reasons to choose Screen Studio. The highest-value next release should improve cursor and camera behavior, make editing reversible, and support cuts and output framing. Adding more background choices would have much less impact.

Audited October 3, 2026: repository commit `996d7dc`, version 2.7.0, and installed CineScreen 2.7.0. The comparison uses Screen Studio's official product page and guides available on that date. Some guides retain older options; the matrix focuses on capabilities rather than assuming every historical setting remains in its current UI. Screen Studio's rendering implementation was not inspected or benchmarked.

## Evidence and limits

- Inspected capture, telemetry, editor, timeline, preview, compositor, export, permissions, and project management code.
- Opened an existing recording in the installed editor, exercised playback, and inspected its export options without exporting or changing its settings.
- Ran a standalone Swift harness against the production `RenderSnapshot`, metadata, and spring code. Only render payload declarations and existing fixture builders are extracted to avoid GPU setup.
- Re-ran 17 existing metadata, snapshot, and spring tests in a temporary Swift package; all passed. This validates that subset, not the app host or full test suite.
- `make test CODE_SIGNING_ALLOWED=NO` could not build because Xcode's Metal Toolchain is missing. No toolchain was installed.
- No new screen, microphone, or camera recording was made. Capture synchronization and GPU frame pacing observations below need instrumented reproduction. Numeric trajectory defects are reproduced; their contribution to this user's subjective experience still needs a representative recording comparison.

## Feature parity

Present means the capability is implemented, not that quality parity is established. Partial means the basic operation exists but lacks important behavior or controls. Missing means no implementation or exposed workflow was found in this repository.

| Capability | Screen Studio reference | CineScreen status and evidence | Priority |
| --- | --- | --- | --- |
| Display, window, and area capture | [Recording guide](https://screen.studio/guide) | Present: ScreenCaptureKit, native window picker, and region picker. Movement and synchronization risks remain. | Harden |
| Microphone, system sound, and webcam | [Product page](https://screen.studio/) | Present: separate capture paths and webcam overlay. Device selection lives in Settings; no live levels or input preview in the recording bar. | P1 UX |
| Pause, resume, countdown, speaker notes | [Product page](https://screen.studio/) | Missing: session states are idle, starting, recording, stopping, error; HUD has Stop and Cancel. | P1 |
| Global recording shortcut | [Guide](https://screen.studio/guide) | Partial: shortcut opens the control bar when idle and stops an active take. Source selection starts recording immediately. | P2 |
| Automatic zoom | [Zoom editing](https://screen.studio/guide/adding-and-editing-zooms) | Partial: fixed 2-second click clustering, 300 ms anticipation, 1,200 ms postroll, uniform 2× default; no semantic activity planning. | P0 |
| Manual zoom target | [Zoom editing](https://screen.studio/guide/adding-and-editing-zooms) | Partial: time, length, and scale are editable; focal point is always auto-pan. Stored centerX and centerY are ignored. | P1 |
| Smooth cursor | [Animations](https://screen.studio/guide/animations) | Partial: deterministic adaptive spring track; click acceleration burst and idle-gap interpolation reproduced. No raw-motion option. | P0 |
| Screen motion blur | [Animations](https://screen.studio/guide/animations) | Missing: blur samples apply to cursor sprite only. Screen zoom and pan remain sharp. | P1 after trajectory fixes |
| Cursor size, shapes, idle hiding, click feedback | [Cursor](https://screen.studio/guide/cursor) | Partial: size, captured system shapes, idle hiding, rings, and press dip exist. No global hide, touch style selection, loop closure, or per-section visibility UI. | P1 |
| Aspect ratios and crop | [Aspect ratio](https://screen.studio/guide/aspect-ratio) | Missing: canvas follows source dimensions. Downscaling is available; output shape and source cropping are not. | P1 |
| Trim, split, delete middle, segment speed | [Trimming](https://screen.studio/guide/trimming), [guide](https://screen.studio/guide) | Partial: a single start/end trim range. No cut list, multiple clips, ripple deletion, or speed segments. | P1 |
| Undo and redo | Editor capability audit | Missing for CineScreen edits: no history model or UndoManager registration found. Autosave persists changes. | P0 UX |
| Background, padding, corners, shadow | [Product page](https://screen.studio/) | Partial: 12 fixed background tiles, padding, fixed corner treatment, shadow toggle/strength. No custom image or reusable project appearance presets. | P2 |
| Save and reuse a complete look | [Creating presets](https://screen.studio/guide/creating-preset) | Missing: background tiles are color presets, not saved project settings. | P1 |
| Dynamic webcam layouts | [Camera layouts](https://screen.studio/guide/dynamic-camera-layouts-) | Partial: one circular overlay with global position, size, enable flag. No layout track, fullscreen camera, or animated transitions. | P2 |
| Captions and transcript editing | [Captions](https://screen.studio/guide/captions), [product page](https://screen.studio/) | Missing: no caption/transcript model, UI, or compositor pass. | P2 |
| Audio editing and enhancement | [Guide](https://screen.studio/guide), [product page](https://screen.studio/) | Missing: no waveform, mute/gain controls, noise reduction, normalization, or music editor. Export re-encodes captured tracks. | P1 basic controls; P2 enhancement |
| Masks and highlights | [Product page](https://screen.studio/) | Missing: no editable region masks or highlight track. MouseEffectsConfig.highlightRing is schema only and is not a redaction feature. | P2 |
| Video import | [Guide](https://screen.studio/guide) | Missing as a supported workflow; export is disabled without recording metadata. | P2 |
| iPhone and iPad capture and device framing | [Product page](https://screen.studio/) | Missing: capture modes are display, window, and area. | P3 |
| MP4 and GIF export | [Export settings](https://screen.studio/guide/explanation-of-export-settings) | Partial: H.264 MP4 and GIF implemented. GIF capped at 15 fps/960 px; MP4 controls are Full/75%/50% and Low/Medium/High; no export FPS selector. | P1 |
| Share links and clipboard delivery | [Product page](https://screen.studio/) | Missing: local save panel and completion text only; no hosted playback or copy-video action. | P2 clipboard; P3 hosting |
| Project library | CineScreen source and installed UI | Present: search, rename, duplicate, Finder reveal, and Trash. Editor still displays generic recording filename rather than project name. | P1 polish |
| Recording recovery | [Product page](https://screen.studio/) | Partial: runtime failures salvage through normal stopping. No periodic recovery manifest, fragmented recording configuration, or next-launch recovery workflow found. | P2 reliability |

## Reproduced motion findings

### P0 Cursor catch-up accelerates at clicks

On a constant-speed 1,000 px/s input path, the sampled cursor peaks at 1,000.02 px/s without a click and 2,880.55 px/s with a mouse-down at 1,500 ms. The only changed input is the click. The snapshot multiplies smoothTime by a proximity ramp that reaches zero at the click; its accumulated tracking lag is rapidly discharged. This is a plausible source of the visible catch-up feeling even though the resulting track is deterministic.

Evidence: [RenderSnapshot.swift](/Users/jasonzhang/Projects/CineScreen/CineScreen/Editor/RenderSnapshot.swift:496). Existing tests check that the cursor lands near clicks, but do not limit the acceleration required to get there.

Recommendation: use click-constrained trajectory planning with lookahead and bounded velocity/acceleration, then compare move-stop-click, rapid clicks, and drag fixtures. Preserve target accuracy without collapsing a lagging spring at the event. The audit harness's 1.5× speed ceiling is a proposed quality guard for this fixture, not a measured Screen Studio specification.

### P1 Idle gaps become invented motion

Mouse capture is event driven. A fixture with the cursor at x=100 at 2,000 ms and the first later movement at x=110 at 5,000 ms yields raw x=105 and rendered x=104.17 at 3,500 ms. There was no movement event during that gap. Both the public raw sampler and the precomputation interpolate across the entire gap, so smoothing receives an already incorrect path. The effect can also influence auto-pan.

Evidence: [MouseTrackingService.swift](/Users/jasonzhang/Projects/CineScreen/CineScreen/Capture/MouseTrackingService.swift:179), [RenderSnapshot.swift](/Users/jasonzhang/Projects/CineScreen/CineScreen/Editor/RenderSnapshot.swift:459).

Recommendation: record explicit holds or regularly sampled telemetry; normalize legacy sparse tracks with a documented gap policy. Keep intentional short transition smoothing separate from interpolation over seconds of inactivity.

### P1 Idle cursor reappears at the synthetic endpoint

RecordingSession appends a final position keyframe even when the cursor never moved again. Idle hiding treats every keyframe as activity. An anchored fixture has opacity 0 at 4,999 ms and 1 at 5,000 ms, despite unchanged position. This is reproduced at the endpoint, including seeking there; whether an exported frame samples that exact boundary depends on export timing.

Evidence: [RenderSnapshot.swift](/Users/jasonzhang/Projects/CineScreen/CineScreen/Editor/RenderSnapshot.swift:178), [RecordingSession.swift](/Users/jasonzhang/Projects/CineScreen/CineScreen/Capture/RecordingSession.swift:293).

Recommendation: derive last activity from actual motion/click events, excluding synthetic anchors and duplicate positions. Define a smooth reappearance policy.

### P1 Zoom timing prioritizes transition over readability

A default isolated click produces a 1,500 ms section. Two 700 ms ramps leave only 100 ms fully zoomed. At the click, the nominal 2× zoom is only 1.3679×; it settles 400 ms after the action. This is an arithmetic/trajectory measurement; the readability judgment is an audit recommendation.

Evidence: [EditorViewModel.swift](/Users/jasonzhang/Projects/CineScreen/CineScreen/Editor/EditorViewModel.swift:519), [RenderSnapshot.swift](/Users/jasonzhang/Projects/CineScreen/CineScreen/Editor/RenderSnapshot.swift:279).

Recommendation: plan anticipation, arrival, readable hold, and exit together. Merge nearby actions when a zoom-out/zoom-in would add distraction. Add fixed-target zooms for content the cursor does not point at.

### P1 Full trajectory rebuilds occur on unrelated edits

Every metadata write invalidates both trajectories, including cursor size, webcam placement, click color, canvas style, and trim. The next preview request reconstructs the entire snapshot synchronously on the main actor. A 10-minute active fixture with 36,001 input keyframes and one long zoom measured about 17–29 ms per optimized rebuild across audit runs, producing roughly 72,001 samples in each track. That exceeds a 16.7 ms frame budget before other UI/render work. Timing varies with machine load; this is a CPU benchmark, not proof of a measured GPU frame drop in the installed app.

Evidence: [EditorViewModel.swift](/Users/jasonzhang/Projects/CineScreen/CineScreen/Editor/EditorViewModel.swift:13), [EditorViewModel.swift](/Users/jasonzhang/Projects/CineScreen/CineScreen/Editor/EditorViewModel.swift:687).

Recommendation: cache trajectories by their actual inputs, separate appearance state, and rebuild motion off the main actor with revision checks. A style slider should not reintegrate ten minutes of cursor motion.

### P2 Stored animation settings are partly inert

Changing transitionSpeed, followSpeed, and deadZone produces identical pan tracks and zoom scale in the harness. The renderer uses hardcoded timing and framing constants. Glide changes cursor smoothing; camera springs use their own fixed constants despite a sidebar source comment saying Glide drives both.

Recommendation: define separate, working cursor and camera presets and migrate legacy fields intentionally. Avoid exposing additional controls until their effects are implemented.

## Source supported risks needing live reproduction

1. **Telemetry and video use different time origins.** Video is rebased to its first frame's host-clock PTS. Mouse tracking starts after capture.start and timestamps events with CFAbsoluteTime at queued callback processing time. There is no persisted mouse offset comparable to webcamOffsetMs. Unify the clock and preserve event timestamps; measure startup offset and main-loop delays. The size and direction of the visible error have not been measured here.
2. **Preview image and effects do not share one frame timestamp.** Video output is queried using host-time-to-item-time mapping and discards itemTimeForDisplay; effects independently sample player.currentTime, or the requested seek target while paused. Exact seeks have no coalescing or completion gating. Instrument requested time, decoded frame time, and effect time; introduce one frame context before claiming pixel-identical preview/export behavior.
3. **Fast pan safety clamps can change the camera path abruptly.** The auto-pan loop directly resets camera position at its frame-edge limit. Test fast cross-screen drags and high zoom levels; measure position/velocity continuity before replacing constants.
4. **Window mapping is fixed at capture start.** MouseTrackingService keeps its initial content rectangle and scales. Moving or resizing a recorded window requires mapping updates; no update method or caller was found. Outside-content events are clamped to the border instead of carrying visibility state. Reproduce with native window capture before prescribing the exact mapping fix.
5. **Pausing playback leaves the preview renderer active.** MetalRenderer sets MTKView.isPaused to false and renders at 60 Hz; no playback/export state changes that setting. The export path pauses AVPlayer while describing reduced GPU contention, but that does not stop these draw passes. Measure idle and export GPU usage, then render paused frames only when the image or appearance changes.

## UX changes with the greatest impact

**Make editing the primary workflow.** Add a persistent toolbar with project name, undo/redo, split, zoom, aspect ratio, and export. Show a contextual inspector when selecting a clip or zoom. Put general appearance settings in a separate tab; selecting a zoom should immediately reveal its controls without hunting below Background and Cursor.

**Give the timeline useful content.** Add cached thumbnails, audio waveforms, fractional ruler labels when tick spacing is below one second, and larger zoom-edge hit targets. Current 0.5-second ticks are formatted as whole seconds, visibly duplicating labels. Add snapping and keep the playhead/selection in view when changing timeline magnification. Preserve existing frame stepping, trim handles, and pinch support.

**Make exploration reversible.** Register gesture-level undo entries and show autosave state/errors beside the project title. Suggest currently replaces all zooms and autosaves the result, with no edit history. A replacement suggestion should be previewable and undoable.

**Improve recording setup.** Separate choosing a source from starting the take. Show selected display/window/area, camera preview, microphone device and level, and a clear Record button with optional countdown. Camera and microphone menus belong beside their toggles. Add pause/resume after capture clocks and edit time mapping support it.

**Make output choices concrete.** Show 1920×1080, 1080×1920, source dimensions, FPS, estimated size, and use-case presets. On completion offer Reveal in Finder, Open, and Copy Video. Keep MP4/GIF and cancellation. README currently promises ProRes, while the implemented export format enum and writer only expose H.264 MP4/GIF; correct the documentation or implement the promise.

**Use project identity consistently.** Projects can be renamed, but EditorView reads the title from recording.mp4. Open the editor with project identity and show its saved name. The inspected legacy clip displayed duration 6.525 s while metadata was 6.794 s and a zoom extended to 6.794 s. LoadDuration repairs the playback duration without reconciling metadata used for zoom generation. Normalize legacy metadata bounds against the actual video range.

## Recommended implementation order

| Stage | Scope | Acceptance criteria |
| --- | --- | --- |
| 1 Motion and edit trust | Common capture clock; event/hold normalization; click-constrained cursor path; coordinated zoom holds; frame-context preview; selective asynchronous cache; undo/redo. | All audit checks pass; clicks land accurately; held cursor stays still and hidden; scrubbing converges to requested image/effect time; appearance edits avoid full trajectory work; zoom replacement is undoable. |
| 2 Everyday demo editing | Contextual inspector; thumbnails/waveforms; split/delete and speed segments; fixed-target zoom; output ratios/crop; basic audio mute/gain; export presets. | Remove a middle mistake without re-recording; frame a static feature; export wide/square/vertical from one project; hear intended narration; use undo throughout. |
| 3 Repeatable production | Complete appearance presets; input preview/countdown/pause; caption workflow; masks; camera layout track; cursor visibility sections; output reveal/copy. | Create a second consistent demo with few repeated adjustments; hide sensitive regions; caption and deliver a finished clip. |
| 4 Broader competitive features | Camera cutout/face tracking, transcript editing, mobile-device capture, hosted sharing, advanced magnification and upscaling. | Evaluate these after users prefer CineScreen for the core record-edit-export loop. |

These stages are a proposed order, not delivery estimates. Stages 1 and 2 address the most credible reasons to keep choosing Screen Studio today.

## Reproduce the motion audit

From the repository root on macOS with Swift and Python 3 available:

```bash
bash scripts/audit-motion.sh
```

At the audited commit this exits 1 with three failed quality checks: idle gap position, endpoint visibility, and click acceleration. It also prints zoom timing, inert legacy settings, and rebuild costs. The 1.5× click speed budget is explicitly proposed; the position and visibility checks assert event semantics. No production source is modified, no app launches, and temporary compilation files are removed.

Existing tests pass because they check convergence, determinism, track sorting, and click landing. Extend coverage with idle holds, synthetic anchors, motion continuity, paired preview/export timestamps, and scene-based zoom behavior. Do not use these numeric checks alone as proof of perceptual parity: finish with representative 30/60 fps clips covering hover, move-stop-click, typing, dragging, window movement, trimming, and aspect-ratio changes.
