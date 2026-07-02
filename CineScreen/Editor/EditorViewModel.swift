import Foundation
import AVFoundation
import Observation

/// Owns one open recording — its metadata, the AVPlayer driving playback,
/// and any unsaved edits.
@MainActor
@Observable
final class EditorViewModel {
    // Inputs
    let videoURL: URL
    let metadataURL: URL?
    var metadata: RecordingMetadata? {
        didSet {
            // Any metadata change invalidates the cached per-frame snapshot
            // AND the auto-generated zoom sections (they derive from clicks,
            // duration, and zoom level). This central hook covers every
            // mutator — including sidebar bindings that write into metadata
            // directly, which used to bypass invalidation entirely.
            cachedSnapshot = nil
            cachedZoomSections = nil
            guard !suppressAutosave else { return }
            scheduleAutosave()
        }
    }

    // Playback state — bindable
    var currentTimeMs: Double = 0
    var durationMs: Double = 0
    var isPlaying: Bool = false
    var loadError: String?

    // Trim — mirrored into metadata.trim on every change so the debounced
    // autosave persists trim edits like everything else.
    var trimStartMs: Double = 0 {
        didSet { syncTrimToMetadata() }
    }
    var trimEndMs: Double = 0 {
        didSet { syncTrimToMetadata() }
    }

    private func syncTrimToMetadata() {
        guard !suppressAutosave, trimEndMs > trimStartMs else { return }
        metadata?.trim = TrimRange(startMs: trimStartMs, endMs: trimEndMs)
    }

    // Canvas styling (Phase 4) — backgrounds + padding + drop shadow.
    // Defaults give a polished out-of-the-box look so new recordings already
    // feel "designed". Mutations push into metadata so they survive Save.
    var canvasPadding: Double = 0.05 {
        didSet { syncCanvasToMetadata() }
    }
    var canvasBackground: CanvasBackground = .solid("#1a1a1a") {
        didSet { syncCanvasToMetadata() }
    }
    var canvasDropShadow: Bool = true {
        didSet { syncCanvasToMetadata() }
    }
    var canvasShadowStrength: Double = 0.45 {
        didSet { syncCanvasToMetadata() }
    }

    private var suppressCanvasSync: Bool = false

    private func syncCanvasToMetadata() {
        guard !suppressCanvasSync else { return }
        metadata?.canvas = CanvasStyleConfig(
            background: canvasBackground,
            padding: canvasPadding,
            dropShadow: canvasDropShadow,
            shadowStrength: canvasShadowStrength
        )
    }

    /// User-editable webcam overlay layout. Mirrored from metadata so the
    /// drag overlay can read/write through a single binding; persisted back
    /// into `metadata.webcam` on every mutation.
    var webcamLayout: WebcamLayout = .default

    /// Timeline horizontal zoom (1.0 = fit, >1 = zoomed in). Persists per
    /// editor instance only.
    var timelineZoom: Double = 1.0

    /// Index of the zoom section the user has selected in the editor.
    var selectedZoomIndex: Int?

    var canvasStyle: CanvasStyle {
        CanvasStyle(
            padding: Float(canvasPadding),
            background: canvasBackground,
            dropShadow: canvasDropShadow,
            shadowStrength: Float(canvasShadowStrength)
        )
    }

    /// Width/height of the recording. The preview locks its canvas to this
    /// so canvas-relative placement (webcam position, padding, shadow)
    /// matches the export, whose canvas is exactly the video frame — an
    /// unconstrained preview diverged from the exported result whenever the
    /// window aspect differed from the video's.
    var previewAspect: CGFloat? {
        guard let video = metadata?.video, video.height > 0 else { return nil }
        return CGFloat(video.width) / CGFloat(video.height)
    }

    // Underlying AVFoundation
    let player: AVPlayer
    private var playerItem: AVPlayerItem?
    /// Skipped by `@Observable` (it isn't observable state) and held nonisolated
    /// so deinit can remove it without hopping actors.
    @ObservationIgnored
    nonisolated(unsafe) private var timeObserver: Any?

    /// Sibling webcam track if the recording included one. nil when there's no
    /// webcam.mp4 next to the screen recording.
    let webcamURL: URL?
    /// Secondary player that mirrors the main player's clock — playback rate
    /// and seeks are mirrored so the webcam overlay stays in sync.
    @ObservationIgnored let webcamPlayer: AVPlayer?

    // Cursor smoothing state — preview-only.
    @ObservationIgnored private var cursorSmoother = SmoothPosition2D(x: 0, y: 0, smoothTime: 0.25)
    @ObservationIgnored private var lastCursorSampleMs: Double?

    // Autosave — every metadata mutation schedules a debounced write so
    // edits survive closing the window without pressing Save.
    @ObservationIgnored private var autosaveTask: Task<Void, Never>?
    /// Set while loading state INTO the view model so initial population
    /// doesn't trigger a spurious write-on-open.
    @ObservationIgnored private var suppressAutosave: Bool = false
    /// Last persistence failure, for the sidebar to surface.
    private(set) var lastSaveError: String?

    // Auto-generated zoom sections cached on first access.
    @ObservationIgnored private var cachedZoomSections: [ZoomSection]?

    // Cached per-frame snapshot, invalidated on any metadata change. The
    // renderer's providers pull state three times per 60fps frame, and
    // RenderSnapshot.init integrates the whole auto-pan camera trajectory at
    // 240Hz — rebuilding it per pull burned millions of spring steps per
    // second on the main thread once a recording had real zoom coverage.
    @ObservationIgnored private var cachedSnapshot: RenderSnapshot?

    init(videoURL: URL, metadataURL: URL? = nil) {
        self.videoURL = videoURL

        // Auto-discover sidecar JSON if not supplied (sibling with same stem).
        if let metadataURL = metadataURL {
            self.metadataURL = metadataURL
        } else {
            let candidate = videoURL.deletingPathExtension().appendingPathExtension("json")
            self.metadataURL = FileManager.default.fileExists(atPath: candidate.path) ? candidate : nil
        }

        // Sibling webcam — same folder, fixed name.
        let webcamCandidate = videoURL.deletingLastPathComponent()
            .appendingPathComponent(Project.webcamFileName)
        if FileManager.default.fileExists(atPath: webcamCandidate.path) {
            self.webcamURL = webcamCandidate
            self.webcamPlayer = AVPlayer(url: webcamCandidate)
            self.webcamPlayer?.isMuted = true   // audio comes from the main file
        } else {
            self.webcamURL = nil
            self.webcamPlayer = nil
        }

        self.player = AVPlayer()

        loadMetadata()
        loadAsset()
    }

    deinit {
        if let observer = timeObserver {
            player.removeTimeObserver(observer)
        }
    }

    // MARK: - Loading

    private func loadMetadata() {
        guard let url = metadataURL else { return }
        suppressAutosave = true
        defer { suppressAutosave = false }
        do {
            var decoded = try RecordingMetadata.decode(from: url)
            // Repair section order persisted by older builds, where a drag
            // could cross a neighbour and save the non-monotonic result.
            decoded.zoom.sections.sort { $0.startTime < $1.startTime }
            metadata = decoded
            if let trim = metadata?.trim {
                trimStartMs = trim.startMs
                trimEndMs = trim.endMs
            }
            if let layout = metadata?.webcam {
                webcamLayout = layout
            }
            if let saved = metadata?.canvas {
                suppressCanvasSync = true
                canvasPadding = saved.padding
                canvasBackground = saved.background
                canvasDropShadow = saved.dropShadow
                if let strength = saved.shadowStrength {
                    canvasShadowStrength = strength
                }
                suppressCanvasSync = false
            }
            Log.editor.info("Loaded metadata: \(url.lastPathComponent)")
        } catch {
            loadError = "Could not parse metadata: \(error.localizedDescription)"
            Log.editor.error("Metadata decode failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Persistence

    /// Debounce window between an edit and its disk write — long enough to
    /// coalesce slider storms into one write, short enough that little is at
    /// risk if the app dies.
    private static let autosaveDelay: Duration = .seconds(1)

    private func scheduleAutosave() {
        autosaveTask?.cancel()
        autosaveTask = Task { [weak self] in
            try? await Task.sleep(for: Self.autosaveDelay)
            guard !Task.isCancelled else { return }
            self?.persistMetadata()
        }
    }

    /// Flushes pending edits to disk immediately — used by window close and
    /// the explicit Save button.
    @discardableResult
    func saveNow() -> Bool {
        autosaveTask?.cancel()
        autosaveTask = nil
        return persistMetadata()
    }

    @discardableResult
    private func persistMetadata() -> Bool {
        guard let url = metadataURL, let metadata else { return false }
        do {
            try metadata.write(to: url)
            lastSaveError = nil
            Log.editor.info("Saved edits to \(url.lastPathComponent)")
            return true
        } catch {
            lastSaveError = error.localizedDescription
            Log.editor.error("Autosave failed: \(error.localizedDescription)")
            return false
        }
    }

    // MARK: - Webcam layout

    /// Persist a webcam layout change into the metadata model. The drag
    /// overlay calls these on every gesture tick — they're cheap (model
    /// mutation only); the disk write happens later via the existing save
    /// flow that runs on user "Save" or window close.
    func setWebcamLayout(_ layout: WebcamLayout) {
        webcamLayout = layout.clamped()
        metadata?.webcam = webcamLayout
    }

    func setWebcamEnabled(_ on: Bool) {
        var layout = webcamLayout
        layout.enabled = on
        setWebcamLayout(layout)
    }

    func resetWebcamLayout() {
        setWebcamLayout(.default)
    }

    private func loadAsset() {
        let asset = AVURLAsset(url: videoURL)
        let item = AVPlayerItem(asset: asset)
        playerItem = item
        player.replaceCurrentItem(with: item)

        Task {
            await loadDuration(asset: asset)
        }

        // Periodic time observer — updates currentTimeMs at 30Hz for the timeline.
        // The callback runs on .main so we can assert MainActor isolation.
        let interval = CMTime(value: 1, timescale: 30)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.currentTimeMs = time.seconds * 1000
                // Honor the trim range: loop playback within [trimStartMs, trimEndMs].
                // When we run off the out-point, pause and seek back to the in-point.
                // Require a positive range so a degenerate trim (start == end)
                // can't pause playback the instant it begins.
                if self.isPlaying,
                   self.trimEndMs > self.trimStartMs,
                   self.currentTimeMs >= self.trimEndMs {
                    self.pause()
                    self.seek(toMilliseconds: self.trimStartMs)
                }
            }
        }
    }

    private func loadDuration(asset: AVURLAsset) async {
        do {
            // Use the video track's range, not asset.duration. asset.duration
            // is max(track.timeRange.end) — older recordings (pre-mic-rebase
            // fix) have a mic track stamped with raw host-clock PTS, which
            // poisoned the asset duration with hundreds of hours.
            let videoTracks = try await asset.loadTracks(withMediaType: .video)
            let cmDuration: CMTime
            if let videoTrack = videoTracks.first {
                cmDuration = try await videoTrack.load(.timeRange).duration
            } else {
                cmDuration = try await asset.load(.duration)
            }
            await MainActor.run {
                let ms = cmDuration.seconds * 1000
                self.durationMs = ms
                if self.trimEndMs == 0 {
                    // Derived default, not a user edit — don't autosave it.
                    self.suppressAutosave = true
                    self.trimEndMs = ms
                    self.suppressAutosave = false
                }
            }
        } catch {
            await MainActor.run {
                self.loadError = "Could not load video duration: \(error.localizedDescription)"
            }
        }
    }

    // MARK: - Playback controls

    func play() {
        // Always start playback inside the trimmed region. If the playhead is
        // before the in-point or at/past the out-point, snap to trimStartMs.
        if currentTimeMs < trimStartMs || currentTimeMs >= trimEndMs {
            seek(toMilliseconds: trimStartMs)
        }
        player.play()
        webcamPlayer?.play()
        isPlaying = true
    }

    func pause() {
        player.pause()
        webcamPlayer?.pause()
        isPlaying = false
    }

    func togglePlayPause() {
        if isPlaying { pause() } else { play() }
    }

    func seek(toMilliseconds ms: Double) {
        let clamped = max(0, min(ms, durationMs))
        currentTimeMs = clamped
        let time = CMTime(seconds: clamped / 1000, preferredTimescale: 600)
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
        webcamPlayer?.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
        // Drop the smoother's history — otherwise it tries to catch up across
        // the jump. Reset to the raw position when one exists; but always
        // advance lastCursorSampleMs so an empty cursor track still resets the
        // smoother's dt baseline on the next cursorState() call.
        if let snapshot = makeRenderSnapshot(),
           let raw = RenderSnapshot.rawCursorPosition(atMilliseconds: clamped, metadata: snapshot.metadata) {
            cursorSmoother.reset(toX: Double(raw.x), y: Double(raw.y))
        }
        lastCursorSampleMs = clamped
    }

    // MARK: - Per-frame state (all delegated to RenderSnapshot)
    //
    // RenderSnapshot is the single source of truth for per-frame computation,
    // shared by the live preview AND the export pipeline. The viewmodel adds
    // only the live-preview spring smoothing — everything else flows through
    // the snapshot.

    /// Playback time sampled *fresh on every rendered frame*.
    ///
    /// The periodic time observer only refreshes `currentTimeMs` at 30 Hz (it
    /// drives the timeline playhead UI), but the Metal preview renders at
    /// 60 fps. Sampling the camera / cursor / clicks from the 30 Hz value made
    /// the zoom and pan visibly stair-step — half the frames saw no time
    /// advance at all. During playback we instead read the player's own clock
    /// so the camera advances every rendered frame; when paused or scrubbing
    /// we fall back to `currentTimeMs`, the authoritative seek target.
    var renderTimeMs: Double {
        guard isPlaying else { return currentTimeMs }
        let secs = player.currentTime().seconds
        return secs.isFinite ? secs * 1000 : currentTimeMs
    }

    /// Live-preview cursor state — snapshot's base position with spring
    /// smoothing layered on top. The export uses the same snapshot + a
    /// separate `ExportCursorSmoother` instance.
    func cursorState(atMilliseconds ms: Double? = nil) -> CursorRenderState? {
        guard let snapshot = makeRenderSnapshot() else { return nil }
        let t = ms ?? renderTimeMs
        guard var state = snapshot.cursorStateForExport(atMilliseconds: t) else { return nil }

        // Apply spring smoothing using the elapsed time since the last call.
        let raw = state.positionInVideoPixels
        let dt: Double
        if let last = lastCursorSampleMs {
            dt = max(0.0001, (t - last) / 1000.0)
        } else {
            cursorSmoother.reset(toX: Double(raw.x), y: Double(raw.y))
            dt = 1.0 / 60.0
        }
        lastCursorSampleMs = t
        cursorSmoother.smoothTime = snapshot.adaptiveCursorSmoothTime(
            atMilliseconds: t,
            spriteAt: SIMD2(Float(cursorSmoother.current.x), Float(cursorSmoother.current.y))
        )

        let smoothed = cursorSmoother.update(
            targetX: Double(raw.x),
            targetY: Double(raw.y),
            deltaTime: dt
        )
        state.positionInVideoPixels = SIMD2(Float(smoothed.x), Float(smoothed.y))
        return state
    }

    /// Click ring states at the playhead — pure delegation.
    func clickRingStates(atMilliseconds ms: Double? = nil) -> [ClickRingState] {
        guard let snapshot = makeRenderSnapshot() else { return [] }
        return snapshot.clickRingStates(atMilliseconds: ms ?? renderTimeMs)
    }

    /// Zoom transform at the playhead — pure delegation.
    func zoomState(atMilliseconds ms: Double? = nil) -> ZoomState {
        guard let snapshot = makeRenderSnapshot() else { return .identity }
        return snapshot.zoomState(atMilliseconds: ms ?? renderTimeMs)
    }

    private func activeZoomSections(metadata: RecordingMetadata) -> [ZoomSection] {
        if !metadata.zoom.sections.isEmpty { return metadata.zoom.sections }
        if let cached = cachedZoomSections { return cached }
        guard metadata.zoom.config.autoZoom ?? true else {
            cachedZoomSections = []
            return []
        }
        let level = metadata.zoom.config.level
        let generated = Self.generateZoomSections(
            from: metadata.clicks,
            videoDuration: metadata.video.duration,
            scale: level
        )
        cachedZoomSections = generated
        return generated
    }

    /// Auto-zoom: cluster click-down events within 2s into a single zoom
    /// section. Each section starts 300ms before the first click and ends
    /// 1200ms after the last. Pan within each section is auto-computed from
    /// the cursor track at render time, so we no longer carry a focal point.
    static func generateZoomSections(
        from clicks: [ClickEvent],
        videoDuration: Double,
        scale: Double
    ) -> [ZoomSection] {
        let downClicks = clicks.filter { $0.action == .down }
        guard !downClicks.isEmpty else { return [] }

        var sections: [ZoomSection] = []
        let clusterGapMs = 2_000.0
        let preroll = 300.0
        let postroll = 1_200.0

        var clusterStart = downClicks[0]
        var clusterEnd = downClicks[0]

        func flush() {
            let start = max(0, clusterStart.timestamp - preroll)
            let end = min(videoDuration, clusterEnd.timestamp + postroll)
            // centerX / centerY are legacy fields — auto-pan ignores them at
            // render time, but the model still carries them for on-disk
            // compatibility with older projects. Default to video center.
            sections.append(ZoomSection(
                startTime: start,
                endTime: end,
                scale: scale,
                centerX: 0,
                centerY: 0
            ))
        }

        for i in 1..<downClicks.count {
            let c = downClicks[i]
            if c.timestamp - clusterEnd.timestamp <= clusterGapMs {
                clusterEnd = c
            } else {
                flush()
                clusterStart = c
                clusterEnd = c
            }
        }
        flush()
        return sections
    }

    // MARK: - Zoom section mutations

    /// Whatever is actually being applied to playback right now — either
    /// manually-edited sections or the auto-generated fallback from clicks.
    /// The timeline + sidebar list bind to this so the UI matches what plays.
    var effectiveZoomSections: [ZoomSection] {
        guard let metadata = metadata else { return [] }
        return activeZoomSections(metadata: metadata)
    }

    /// True when no sections are explicitly stored in metadata but clicks
    /// are auto-generating them.
    var isAutoZoomMode: Bool {
        guard let metadata = metadata else { return false }
        return metadata.zoom.sections.isEmpty && (metadata.zoom.config.autoZoom ?? true)
    }

    /// Promote auto-generated sections to manually-stored ones. Called the
    /// first time the user edits anything zoom-related.
    private func materializeIfAuto() {
        guard var metadata = metadata, isAutoZoomMode else { return }
        metadata.zoom.sections = activeZoomSections(metadata: metadata)
        metadata.zoom.config.autoZoom = false
        self.metadata = metadata
    }

    /// Adds a new ~2-second zoom section centred on the current playhead,
    /// clamped into the free gap between existing sections. Adding inside an
    /// existing section selects it instead — the old behaviour inserted an
    /// invisible overlapping duplicate that appeared to do nothing.
    func addZoomSection() {
        materializeIfAuto()
        guard var metadata = metadata else { return }
        let now = currentTimeMs
        var sections = metadata.zoom.sections

        if let hit = sections.firstIndex(where: { now >= $0.startTime && now <= $0.endTime }) {
            selectedZoomIndex = hit
            return
        }

        // Free gap around the playhead (sections are sorted, non-overlapping).
        let prevEnd = sections.last(where: { $0.endTime <= now })?.endTime ?? 0
        let nextStart = sections.first(where: { $0.startTime >= now })?.startTime ?? metadata.video.duration
        let half = 1000.0
        let start = max(max(0, now - half), prevEnd)
        let end = min(min(metadata.video.duration, now + half), nextStart)
        guard end - start >= 100 else { return }

        let section = ZoomSection(
            startTime: start,
            endTime: end,
            scale: metadata.zoom.config.level,
            centerX: 0,
            centerY: 0
        )
        sections.append(section)
        sections.sort { $0.startTime < $1.startTime }
        metadata.zoom.sections = sections
        self.metadata = metadata
        selectedZoomIndex = sections.firstIndex(where: { $0.startTime == section.startTime })
    }

    /// Replaces the manually-edited sections with auto-detected ones from
    /// the click events ("Suggest" in the Electron studio).
    func suggestZoomSections() {
        guard var metadata = metadata else { return }
        let generated = Self.generateZoomSections(
            from: metadata.clicks,
            videoDuration: metadata.video.duration,
            scale: metadata.zoom.config.level
        )
        metadata.zoom.sections = generated
        self.metadata = metadata
        selectedZoomIndex = nil
    }

    func removeZoomSection(at index: Int) {
        materializeIfAuto()
        guard var metadata = metadata, metadata.zoom.sections.indices.contains(index) else { return }
        metadata.zoom.sections.remove(at: index)
        self.metadata = metadata
        if selectedZoomIndex == index { selectedZoomIndex = nil }
        else if let s = selectedZoomIndex, s > index { selectedZoomIndex = s - 1 }
    }

    func updateZoomSection(at index: Int, startTime: Double? = nil, endTime: Double? = nil,
                           scale: Double? = nil) {
        materializeIfAuto()
        guard var metadata = metadata, metadata.zoom.sections.indices.contains(index) else { return }
        var section = metadata.zoom.sections[index]

        // Clamp edits to the neighbouring sections. The array is kept sorted
        // and non-overlapping; without these clamps a block dragged past its
        // neighbour made the array non-monotonic — the pan lookup table is
        // binary-searched by time, so the camera jumped between arbitrary
        // sections, and the corrupted order was persisted. Overlaps also
        // caused instant scale jumps at boundaries, and a zero-length section
        // produced a one-frame full-scale zoom pop — the minimum length
        // prevents both. Because a drag can never cross a neighbour, sorted
        // order is invariant and no mid-drag re-sort (which would break the
        // captured drag index) is ever needed.
        let minLengthMs = 100.0
        let prevEnd = index > 0 ? metadata.zoom.sections[index - 1].endTime : 0
        let nextStart = index + 1 < metadata.zoom.sections.count
            ? metadata.zoom.sections[index + 1].startTime
            : metadata.video.duration
        let lo = max(0, prevEnd)
        let hi = min(metadata.video.duration, nextStart)

        if let s = startTime, let e = endTime {
            // Body drag — preserve the block's length, sliding it within the
            // free gap; shrink only if the gap itself is smaller.
            let length = min(max(minLengthMs, e - s), hi - lo)
            let newStart = min(max(s, lo), hi - length)
            section.startTime = newStart
            section.endTime = newStart + length
        } else if let s = startTime {
            section.startTime = min(max(s, lo), section.endTime - minLengthMs)
        } else if let e = endTime {
            section.endTime = max(min(e, hi), section.startTime + minLengthMs)
        }
        if let z = scale { section.scale = max(1.0, min(z, 6.0)) }
        metadata.zoom.sections[index] = section
        self.metadata = metadata
    }

    /// Returns the Sendable snapshot of everything per-frame state needs —
    /// cached until the next metadata mutation. The preview's providers call
    /// this every draw; the export captures it once on the main actor before
    /// kicking off, then calls methods on it from any queue without actor
    /// crashes.
    func makeRenderSnapshot() -> RenderSnapshot? {
        if let cachedSnapshot { return cachedSnapshot }
        guard let metadata = metadata else { return nil }
        let sections = activeZoomSections(metadata: metadata)
        let snapshot = RenderSnapshot(metadata: metadata, zoomSections: sections)
        cachedSnapshot = snapshot
        return snapshot
    }

}
