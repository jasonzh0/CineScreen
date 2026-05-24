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
    var metadata: RecordingMetadata?

    // Playback state — bindable
    var currentTimeMs: Double = 0
    var durationMs: Double = 0
    var isPlaying: Bool = false
    var loadError: String?

    // Trim — the current edit (not yet saved back to metadata)
    var trimStartMs: Double = 0
    var trimEndMs: Double = 0

    // Canvas styling (Phase 4) — backgrounds + padding + rounded corners.
    // Defaults give a polished out-of-the-box look (subtle padding, rounded
    // corners, drop shadow) so new recordings already feel "designed".
    var canvasPadding: Double = 0.05
    var canvasCornerRadius: Double = 0.025
    var canvasBackground: CanvasBackground = .solid("#1a1a1a")
    var canvasDropShadow: Bool = true

    /// Timeline horizontal zoom (1.0 = fit, >1 = zoomed in). Persists per
    /// editor instance only.
    var timelineZoom: Double = 1.0

    /// Index of the zoom section the user has selected in the editor.
    var selectedZoomIndex: Int?

    var canvasStyle: CanvasStyle {
        CanvasStyle(
            padding: Float(canvasPadding),
            cornerRadius: Float(canvasCornerRadius),
            background: canvasBackground,
            dropShadow: canvasDropShadow
        )
    }

    // Underlying AVFoundation
    let player: AVPlayer
    private var playerItem: AVPlayerItem?
    /// Skipped by `@Observable` (it isn't observable state) and held nonisolated
    /// so deinit can remove it without hopping actors.
    @ObservationIgnored
    nonisolated(unsafe) private var timeObserver: Any?

    // Cursor smoothing state — preview-only.
    @ObservationIgnored private var cursorSmoother = SmoothPosition2D(x: 0, y: 0, smoothTime: 0.25)
    @ObservationIgnored private var lastCursorSampleMs: Double?

    // Auto-generated zoom sections cached on first access.
    @ObservationIgnored private var cachedZoomSections: [ZoomSection]?

    init(videoURL: URL, metadataURL: URL? = nil) {
        self.videoURL = videoURL

        // Auto-discover sidecar JSON if not supplied (sibling with same stem).
        if let metadataURL = metadataURL {
            self.metadataURL = metadataURL
        } else {
            let candidate = videoURL.deletingPathExtension().appendingPathExtension("json")
            self.metadataURL = FileManager.default.fileExists(atPath: candidate.path) ? candidate : nil
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
        do {
            metadata = try RecordingMetadata.decode(from: url)
            if let trim = metadata?.trim {
                trimStartMs = trim.startMs
                trimEndMs = trim.endMs
            }
            Log.editor.info("Loaded metadata: \(url.lastPathComponent)")
        } catch {
            loadError = "Could not parse metadata: \(error.localizedDescription)"
            Log.editor.error("Metadata decode failed: \(error.localizedDescription)")
        }
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
            }
        }
    }

    private func loadDuration(asset: AVURLAsset) async {
        do {
            let cmDuration = try await asset.load(.duration)
            await MainActor.run {
                let ms = cmDuration.seconds * 1000
                self.durationMs = ms
                if self.trimEndMs == 0 { self.trimEndMs = ms }
            }
        } catch {
            await MainActor.run {
                self.loadError = "Could not load video duration: \(error.localizedDescription)"
            }
        }
    }

    // MARK: - Playback controls

    func play() {
        player.play()
        isPlaying = true
    }

    func pause() {
        player.pause()
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
        // Drop the smoother's history — otherwise it tries to catch up across the jump.
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

    /// Live-preview cursor state — snapshot's base position with spring
    /// smoothing layered on top. The export uses the same snapshot + a
    /// separate `ExportCursorSmoother` instance.
    func cursorState(atMilliseconds ms: Double? = nil) -> CursorRenderState? {
        guard let snapshot = makeRenderSnapshot() else { return nil }
        let t = ms ?? currentTimeMs
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
        cursorSmoother.smoothTime = snapshot.cursorSmoothTime

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
        return snapshot.clickRingStates(atMilliseconds: ms ?? currentTimeMs)
    }

    /// Zoom transform at the playhead — pure delegation.
    func zoomState(atMilliseconds ms: Double? = nil) -> ZoomState {
        guard let snapshot = makeRenderSnapshot() else { return .identity }
        return snapshot.zoomState(atMilliseconds: ms ?? currentTimeMs)
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
    /// 1200ms after the last.
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
        var centerXSum = downClicks[0].x
        var centerYSum = downClicks[0].y
        var count = 1.0

        func flush() {
            let start = max(0, clusterStart.timestamp - preroll)
            let end = min(videoDuration, clusterEnd.timestamp + postroll)
            sections.append(ZoomSection(
                startTime: start,
                endTime: end,
                scale: scale,
                centerX: centerXSum / count,
                centerY: centerYSum / count
            ))
        }

        for i in 1..<downClicks.count {
            let c = downClicks[i]
            if c.timestamp - clusterEnd.timestamp <= clusterGapMs {
                clusterEnd = c
                centerXSum += c.x
                centerYSum += c.y
                count += 1
            } else {
                flush()
                clusterStart = c
                clusterEnd = c
                centerXSum = c.x
                centerYSum = c.y
                count = 1
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
        cachedZoomSections = nil
    }

    /// Adds a new 2-second zoom section centred on the current playhead.
    /// Mimics the Electron studio's "Add Zoom" action.
    func addZoomSection() {
        materializeIfAuto()
        guard var metadata = metadata else { return }
        let now = currentTimeMs
        let duration = max(500.0, min(metadata.video.duration - now, 2000.0))
        let centerX = Double(metadata.video.width) / 2
        let centerY = Double(metadata.video.height) / 2
        let section = ZoomSection(
            startTime: max(0, now - duration / 2),
            endTime: min(metadata.video.duration, now + duration / 2),
            scale: metadata.zoom.config.level,
            centerX: centerX,
            centerY: centerY
        )
        var sections = metadata.zoom.sections
        sections.append(section)
        sections.sort { $0.startTime < $1.startTime }
        metadata.zoom.sections = sections
        self.metadata = metadata
        cachedZoomSections = nil
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
        cachedZoomSections = nil
        selectedZoomIndex = nil
    }

    func removeZoomSection(at index: Int) {
        materializeIfAuto()
        guard var metadata = metadata, metadata.zoom.sections.indices.contains(index) else { return }
        metadata.zoom.sections.remove(at: index)
        self.metadata = metadata
        cachedZoomSections = nil
        if selectedZoomIndex == index { selectedZoomIndex = nil }
        else if let s = selectedZoomIndex, s > index { selectedZoomIndex = s - 1 }
    }

    func updateZoomSection(at index: Int, startTime: Double? = nil, endTime: Double? = nil,
                           scale: Double? = nil, centerX: Double? = nil, centerY: Double? = nil) {
        materializeIfAuto()
        guard var metadata = metadata, metadata.zoom.sections.indices.contains(index) else { return }
        var section = metadata.zoom.sections[index]
        if let s = startTime { section.startTime = max(0, s) }
        if let e = endTime { section.endTime = min(metadata.video.duration, e) }
        if let z = scale { section.scale = max(1.0, min(z, 6.0)) }
        if let x = centerX { section.centerX = x }
        if let y = centerY { section.centerY = y }
        metadata.zoom.sections[index] = section
        // DO NOT re-sort here — dragging a block past a neighbour would
        // reorder the array mid-drag, the captured drag index would suddenly
        // point at a different section, and the block would flicker / jump
        // between identities. We sort only on add/suggest/save.
        self.metadata = metadata
        cachedZoomSections = nil
    }

    /// Builds a Sendable snapshot of everything the export pipeline needs to
    /// compute per-frame state. Capture this on the main actor BEFORE
    /// kicking off the export; the closures passed to the pipeline then call
    /// methods on the snapshot from any queue without actor crashes.
    func makeRenderSnapshot() -> RenderSnapshot? {
        guard let metadata = metadata else { return nil }
        let sections = activeZoomSections(metadata: metadata)
        return RenderSnapshot(metadata: metadata, zoomSections: sections)
    }

}
