# Screen Studio audit implementation follow-up

This implements the motion and everyday editing priorities from the [baseline audit](SCREEN_STUDIO_AUDIT.md), plus the requested cinematic background and shadow improvements. The audit's original parity matrix is historical; this follow-up describes the current working tree.

## Motion and rendering

- Mouse events carry a monotonic timestamp captured before the main queue hop, then align to the screen video's first-frame epoch. Events beyond the video's range are discarded; a pre-frame position can become the initial cursor seed without inventing a click.
- Cursor movement holds through idle gaps, ignores synthetic endpoint anchors for visibility, and constrains click landing with a smooth correction. The constant-speed audit's click spike falls from 2.88× to 1.16× under its unchanged 1.5× budget. Move-stop-click overshoot is zero in the regression fixture.
- Zoom planning allocates a readable hold, applies transition/follow/dead-zone settings, and supports fixed targets. Camera movement follows with lookahead instead of abrupt edge resets.
- Preview video, cursor, clicks, zoom and camera share a draw timestamp. During a paused seek, overlays follow the decoded image. Seek requests coalesce and completion invalidates the paused preview. Idle previews stop continuous GPU drawing.
- Appearance changes reuse immutable motion arrays. Motion edits debounce and recompute away from the main actor; export always freezes an exact snapshot.

## Editing and output

- Project title, autosave state/errors, undo/redo, split, zoom and aspect controls are visible in the editor toolbar. Pointer gestures form one undo entry. Suggest replacement and look-preset application are reversible.
- Edit and Appearance inspectors separate clip/zoom work from visual styling. Selected clips expose delete and speed controls; zooms expose follow/fixed target editing.
- The source timeline has cached thumbnails, audio peaks, fractional ticks, larger grips and snapping. The transport reports edited time. Removed ranges and segment speeds use the same composition in playback and export.
- Original, wide, square, vertical, classic and portrait output ratios share normalized crop geometry between preview and MP4/GIF. Audio gain/mute and output frame rate are editable. Screen/audio retiming is identical; cursor, click, zoom and camera callbacks map output time back to source metadata.
- H.264 exports carry explicit Rec.709 color tags to prevent legacy decoder color shifts. Video-track bounds prevent old, mis-stamped audio from extending exports.
- Export completion offers Open, Reveal and Copy. README now describes the implemented H.264 MP4/GIF formats.

## Cinematic appearance

- Six new lighting presets: Midnight, Slate, Dusk, Ocean, Amber and Studio. Existing solid/gradient presets remain available.
- Radial or linear lighting, subtle vignette and stable grain reduce flatness and gradient banding.
- Shadow strength, softness, distance and direction are adjustable. Ambient/contact falloff, corner radius and offsets use physical viewport proportions, avoiding stretched shadows on vertical or wide canvases.
- Rounded corners use consistent pixel proportions for video and shadow. Cursor and click overlays respect the cropped frame and its corner mask. Asymmetric crops retain neutral identity framing and bounded camera targets.
- Personal look presets retain canvas, cursor, zoom, camera and output settings.

## Validation

- Optimized Release app builds successfully as a universal Apple Silicon/Intel binary. Local build: `build/derived/Build/Products/Release/CineScreen.app`.
- Full Debug app and test host compile for Apple Silicon and Intel; all **64 XCTest tests pass**, including native production-GPU export and composition playback tests.
- `bash scripts/audit-motion.sh`: **seven checks pass**, including accurate clicks, held/hidden idle cursor, effective settings, readable zoom hold, bounded acceleration and no move-stop-click overshoot.
- Production MP4 and GIF tests verify retained source ranges, speed changes, 2.5-second edited duration, synchronized audio, vertical dimensions, source/export colors and GIF frame count. Direct compositor checks verify asymmetric crop, rounded corners, directional shadow and click-ring radius. Empty edits preserve existing destinations. A legacy delayed-audio fixture cannot extend video export bounds.
- Visual QA in the native editor verified the dark default and light Studio lighting/shadow, appearance controls, undo/redo, keyboard splitting and contextual selection. The optimized build also loaded a cut/speed project, played it to the 7.05-second edited end, held its final frame, and displayed a square asymmetric crop. Tests cover fixed-target geometry and exact playback mapping.
- `git diff --check` passes.

Reproduce the full suite:

```sh
xcodegen generate
xcodebuild -project CineScreen.xcodeproj -scheme CineScreen -configuration Debug -derivedDataPath build/derived test CODE_SIGNING_ALLOWED=NO
bash scripts/audit-motion.sh
```

The Xcode Metal toolchain was installed to enable native shader compilation. Local unsigned builds have their own macOS permission state; live capture was not exercised in this pass. Capture clock normalization is covered by unit tests. Numeric motion checks support the identified fixes; they do not establish perceptual equivalence with Screen Studio.

## Remaining parity work

This pass does not implement area capture, recording pause/countdown/input preview, captions or transcript editing, privacy masks, animated camera layout tracks, cursor visibility sections, camera cutout/face tracking, mobile-device capture, hosted sharing, advanced magnification or upscaling. Moving/resizing a captured window still needs dynamic capture-coordinate mapping validation. Undo history is scoped to the open editor session.
