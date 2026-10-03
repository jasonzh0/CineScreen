# Codebase audit and maintenance guide

Audited on 2026-10-03 after the Screen Studio comparison and motion/editor improvements. This pass preserves those changes and focuses on ownership, duplicated behavior and resource lifetimes.

## Findings addressed

| Finding | Change | Why it matters |
| --- | --- | --- |
| Preview and export encoded six GPU passes independently; export called helpers on the preview renderer. | `FrameCompositor` owns the complete pass order and shader bindings. Geometry and GPU layouts live in `CompositorCore`. | A crop, shadow, cursor or webcam fix now reaches both paths through the same implementation. |
| CV texture bindings were discarded immediately; dummy references and comments attempted to preserve GPU lifetimes. | `PixelBufferTextures` returns a binding that retains the CV texture and pixel buffer. Preview retains it through command completion; export extends its lifetime through the synchronous GPU wait. | Frame replacement cannot release a binding while its command is still sampling. The existing cache expiry and decoder-copy policy remain in place. |
| Preview exposed overlapping time-based and untimed callbacks for cursor, clicks and zoom. | `CompositionState` carries one sampled frame; preview accepts one timestamp-based provider. | All overlays use one snapshot and the decoded frame's source timestamp. Paused seeks and edited playback retain their existing clock mapping. |
| Screen and webcam duplicated output installation/removal with uncancellable delayed callbacks. | `PlayerVideoOutput` owns the subscription and cancellable attachment retry. Preview rendering is explicitly main-actor isolated. | Replacement and teardown remove old outputs and prevent a delayed callback from attaching to an old player. |
| The editor managed stack limits, gesture starts, redo invalidation and restoration flags inline. | `EditorHistory` owns bounded history and gesture grouping; the model restores returned metadata without recording another edit. | History behavior can be tested without players, files or rendering. Nested commands preserve an enclosing gesture. |
| Loading, undo and presets repeated canvas restoration and legacy fallback values. | `CanvasStyleConfig` resolves optional legacy fields; one editor mapping restores bindings, and one configuration supplies persistence, presets and rendering. | A default has one owner. Loading and undo do not accidentally create canvas edits; presets update the canvas atomically. |
| Background models depended on the editor's motion snapshot for hex decoding. | `RGBAColor` owns the shared pure decoder. | Models and UI controls no longer depend on the motion engine for color parsing. |
| The motion audit sliced declarations out of a renderer source file. | Pure render payloads live in `RenderState.swift`; the audit compiles the actual file. | Moving or documenting GPU code can no longer silently break the audit's source extraction. |

## Where changes belong

| Responsibility | Owner |
| --- | --- |
| Persisted recording schema, optional-field compatibility | `Models/Metadata.swift` |
| Retained source ranges, speed and source/output time conversion | `Models/EditTimeline.swift` |
| Output dimensions and crop settings | `Models/OutputGeometry.swift` |
| Deterministic cursor/camera trajectory and per-time sampling | `Editor/RenderSnapshot.swift` |
| Frame payloads and persisted-style conversion | `Compositor/RenderState.swift` |
| Shader uniform layout, geometry, pipeline creation, cursor artwork | `Compositor/CompositorCore.swift` |
| Background → shadow → screen → clicks → cursor → webcam encoding | `Compositor/FrameCompositor.swift` |
| CV-to-Metal bindings and backing resource retention | `Compositor/PixelBufferTextures.swift` |
| Preview drawable submission | `Compositor/MetalRenderer.swift` |
| Player subscriptions and preview timestamp selection | `Editor/Preview/PlayerVideoOutput.swift`, `MetalPreviewView.swift` |
| Offline destination submission and GPU completion wait | `Export/ExportCompositor.swift` |
| AVFoundation composition building for playback and export | `Export/EditedAssetBuilder.swift` |
| Undo stacks and gesture coalescing | `Editor/EditorHistory.swift` |
| Editor bindings, playback orchestration and persistence | `Editor/EditorViewModel.swift` |

Keep adapters responsible for acquisition and submission. Add visual passes to `FrameCompositor`, not to either adapter. Uniform field order must match `Shaders.metal`; geometry tests assert their strides. Use `RGBAColor` for hex decoding rather than adding color parsing to a view or motion module.

Preview samples the player's continuous clock while playing, and the decoded image's display time while paused. Edited item times are mapped back to source times before sampling motion and webcam frames. Export captures an immutable `RenderSnapshot` before dispatching work; background render closures must not access the editor model.

Each compositor and texture cache is confined to its adapter's render queue. `PixelBufferTexture` is an immutable resource holder that can cross the GPU completion boundary; it does not authorize concurrent mutation of pixel data. Retain CV bindings until GPU completion. Do not flush the cache after every frame, and do not turn off `alwaysCopiesSampleData` in export without testing decoder-pool exhaustion on longer recordings.

## Remaining maintenance work

- `ExportPipeline` still mixes main-actor orchestration with AVFoundation objects captured by DispatchQueue callbacks. The current Swift 5 language mode reports Sendable warnings. A future Swift 6 migration should give each MP4/GIF job explicit ownership of its reader, writer, frame source and completion state, with cancellation and failure tests. Suppressing warnings or marking the entire job unchecked Sendable would hide the ownership problem.
- `EditorViewModel` still coordinates player composition rebuilds, seeks, autosave and asynchronous motion caching. History and canvas duplication are removed, but the model remains large. Extract a playback session or render cache when those responsibilities change, preserving seek coalescing, generation checks and appearance-only track reuse.
- `SidebarView` contains many independent settings sections and export presentation. Split it by feature when extending a section, with shared bindings owned by the editor rather than new layers forwarding every property.
- Capture services have separate synchronization and timestamp responsibilities. Live capture needs a signed, permission-enabled smoke test; the unsigned local build and offline tests do not verify macOS permission handling or long-running capture.

These are follow-up areas, not claims of failures in the completed cleanup.

## Validation

Generate the project after adding source files (`CineScreen.xcodeproj` is generated and ignored):

```sh
xcodegen generate
xcodebuild -project CineScreen.xcodeproj -scheme CineScreen -configuration Debug \
  -derivedDataPath build/derived test CODE_SIGNING_ALLOWED=NO
bash scripts/audit-motion.sh
xcodebuild -project CineScreen.xcodeproj -scheme CineScreen -configuration Release \
  -derivedDataPath build/derived build CODE_SIGNING_ALLOWED=NO
```

The expanded suite contains 72 tests: the prior 64 plus history-limit/redo/no-op-gesture cases, legacy canvas and nested preset restoration, and player-output replacement/deferred-teardown cases. GPU integration tests exercise exported colors, crop and corner geometry, directional shadows, click radii, edited MP4/GIF timing and audio. The standalone motion audit has seven behavioral checks and compiles production payloads directly.

Verified results for this pass: all 72 XCTest tests passed, all seven standalone motion checks passed, and the optimized Release build succeeded for arm64 and x86_64. Native Release QA verified initial frame rendering, playback, paused frame stepping, editor teardown/reopening and seeking to the final frame on an existing recording. Live capture was not exercised. Export's existing Sendable warnings remain visible and are described above.
