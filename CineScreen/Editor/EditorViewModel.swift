import Foundation
import AVFoundation
import Observation
import AppKit

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
            guard metadata != oldValue else { return }
            cachedSnapshot = nil
            renderRevision &+= 1
            if metadata?.clicks != oldValue?.clicks || metadata?.video.duration != oldValue?.video.duration || metadata?.zoom.config != oldValue?.zoom.config {
                cachedZoomSections = nil
            }
            prepareMotionSnapshot()
            guard !suppressAutosave else { return }
            history.recordChange(from: oldValue, to: metadata)
            hasUnsavedChanges = true
            if metadata?.output != oldValue?.output { applyAudioSettings() }
            if metadata?.editSegments != oldValue?.editSegments || metadata?.trim != oldValue?.trim { rebuildEditedPlayback() }
            scheduleAutosave()
        }
    }

    private(set) var hasUnsavedChanges = false
    private(set) var lastSavedAt: Date?
    let projectTitle: String
    private(set) var renderRevision = 0
    private static func title(for videoURL: URL) -> String {
        let folder = videoURL.deletingLastPathComponent()
        if let data = try? Data(contentsOf: folder.appendingPathComponent(Project.projectFileName)),
           let project = try? JSONDecoder().decode(ProjectDescriptor.self, from: data) { return project.name }
        return videoURL.deletingPathExtension().lastPathComponent
    }
    private var history = EditorHistory()
    var canUndo: Bool { history.canUndo(current: metadata) }
    var canRedo: Bool { history.canRedo }

    /// One pointer gesture is one history entry, even for hundreds of changes.
    func beginEditing() { history.beginEditing(current: metadata) }
    func endEditing() { history.endEditing(current: metadata) }
    func sliderEditing(_ editing: Bool) {
        if editing { beginEditing() } else { endEditing() }
    }
    func performEdit(_ edit: () -> Void) {
        let ownsTransaction = !history.isEditing
        if ownsTransaction { beginEditing() }
        defer { if ownsTransaction { endEditing() } }
        edit()
    }
    func undo() {
        if let previous = history.undo(current: metadata) { restore(previous) }
    }
    func redo() {
        if let next = history.redo(current: metadata) { restore(next) }
    }
    private func restore(_ value: RecordingMetadata) {
        let playbackChanged = metadata?.trim != value.trim || metadata?.editSegments != value.editSegments
        pause()
        suppressAutosave = true
        metadata = value
        trimStartMs = value.trim?.startMs ?? 0
        trimEndMs = value.trim?.endMs ?? durationMs
        webcamLayout = value.webcam ?? .default
        applyCanvas(value.canvas ?? .default)
        suppressAutosave = false
        selectedZoomIndex = nil
        selectedSegmentID = nil
        hasUnsavedChanges = true
        applyAudioSettings()
        if playbackChanged { rebuildEditedPlayback() }
        scheduleAutosave()
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

    // Canvas bindings mirror the persisted configuration.
    // Defaults give a polished out-of-the-box look so new recordings already
    // feel "designed". Mutations push into metadata so they survive Save.
    var canvasPadding: Double = CanvasStyleConfig.default.padding {
        didSet { syncCanvasToMetadata() }
    }
    var canvasBackground: CanvasBackground = CanvasStyleConfig.default.background {
        didSet { syncCanvasToMetadata() }
    }
    var canvasDropShadow: Bool = CanvasStyleConfig.default.dropShadow {
        didSet { syncCanvasToMetadata() }
    }
    var canvasShadowStrength: Double = CanvasStyleConfig.default.resolvedShadowStrength {
        didSet { syncCanvasToMetadata() }
    }

    var canvasShadowSoftness: Double = CanvasStyleConfig.default.resolvedShadowSoftness { didSet { syncCanvasToMetadata() } }
    var canvasShadowDistance: Double = CanvasStyleConfig.default.resolvedShadowDistance { didSet { syncCanvasToMetadata() } }
    var canvasShadowAngle: Double = CanvasStyleConfig.default.resolvedShadowAngle { didSet { syncCanvasToMetadata() } }
    var canvasCornerRadius: Double = CanvasStyleConfig.default.resolvedCornerRadius { didSet { syncCanvasToMetadata() } }
    private var suppressCanvasSync: Bool = false

    private var canvasConfiguration: CanvasStyleConfig {
        CanvasStyleConfig(background: canvasBackground, padding: canvasPadding,
                          dropShadow: canvasDropShadow, shadowStrength: canvasShadowStrength,
                          shadowSoftness: canvasShadowSoftness, shadowDistance: canvasShadowDistance,
                          shadowAngle: canvasShadowAngle, cornerRadius: canvasCornerRadius)
    }

    private func syncCanvasToMetadata() {
        guard !suppressCanvasSync, !suppressAutosave else { return }
        metadata?.canvas = canvasConfiguration
    }

    /// Loading and undo restore the bindings without writing a second metadata
    /// value. A preset calls syncCanvasToMetadata once after this atomic update.
    private func applyCanvas(_ config: CanvasStyleConfig) {
        let wasSuppressed = suppressCanvasSync
        suppressCanvasSync = true
        defer { suppressCanvasSync = wasSuppressed }
        canvasBackground = config.background
        canvasPadding = config.padding
        canvasDropShadow = config.dropShadow
        canvasShadowStrength = config.resolvedShadowStrength
        canvasShadowSoftness = config.resolvedShadowSoftness
        canvasShadowDistance = config.resolvedShadowDistance
        canvasShadowAngle = config.resolvedShadowAngle
        canvasCornerRadius = config.resolvedCornerRadius
    }

    /// User-editable webcam overlay layout. Mirrored from metadata so the
    /// drag overlay can read/write through a single binding; persisted back
    /// into `metadata.webcam` on every mutation.
    var webcamLayout: WebcamLayout = .default

    /// Camera warm-up offset between the webcam file's t=0 and the screen
    /// recording's t=0: screenT = webcamT + offset. 0 for recordings made
    /// before the offset was captured.
    private var webcamOffsetMs: Double { metadata?.webcamOffsetMs ?? 0 }

    /// Timeline horizontal zoom (1.0 = fit, >1 = zoomed in). Persists per
    /// editor instance only.
    var timelineZoom: Double = 1.0
    private(set) var timelineThumbnails: [NSImage] = []
    private(set) var timelineWaveform: [Float] = []
    @ObservationIgnored private var mediaTask: Task<Void, Never>?
    @ObservationIgnored private var seekInFlight = false
    @ObservationIgnored private var pendingSeekMs: Double?
    private(set) var playbackTimeline: EditTimeline?
    private(set) var isPreparingPlayback = false
    @ObservationIgnored private var playbackBuildTask: Task<Void, Never>?
    @ObservationIgnored private var playbackGeneration = 0
    @ObservationIgnored private var webcamSegmentID: UUID?

    /// Index of the zoom section the user has selected in the editor.
    var selectedZoomIndex: Int? {
        didSet { if selectedZoomIndex != nil { selectedSegmentID = nil } }
    }

    var canvasStyle: CanvasStyle { canvasConfiguration.renderStyle }

    /// Width/height of the recording. The preview locks its canvas to this
    /// so canvas-relative placement (webcam position, padding, shadow)
    /// matches the export, whose canvas is exactly the video frame — an
    /// unconstrained preview diverged from the exported result whenever the
    /// window aspect differed from the video's.
    var previewAspect: CGFloat? {
        guard let video = metadata?.video, video.height > 0 else { return nil }
        let dimensions = outputSettings.dimensions(sourceWidth: video.width, sourceHeight: video.height)
        return CGFloat(dimensions.width) / CGFloat(dimensions.height)
    }

    var selectedSegmentID: UUID? {
        didSet { if selectedSegmentID != nil { selectedZoomIndex = nil } }
    }
    var editTimeline: EditTimeline {
        EditTimeline(segments: metadata?.editSegments, durationMs: durationMs,
                     trim: TrimRange(startMs: trimStartMs, endMs: trimEndMs))
    }
    var retainedSegments: [EditSegment] { editTimeline.segments }
    var editedDurationMs: Double { editTimeline.durationMs }
    var editedTimeMs: Double { editTimeline.outputTime(atSourceMs: currentTimeMs) ?? 0 }
    var outputSettings: OutputSettings {
        get { metadata?.output ?? .default }
        set { metadata?.output = newValue }
    }
    func selectSegment(_ id: UUID) {
        selectedSegmentID = id
    }
    func splitAtPlayhead() {
        let segments = retainedSegments
        let split = EditTimeline.split(segments: segments, atSourceMs: currentTimeMs)
        guard split.count > segments.count else { return }
        metadata?.editSegments = split
        selectedSegmentID = split.first(where: { abs($0.startMs - currentTimeMs) < 0.01 })?.id
    }
    func removeSelectedSegment() {
        guard let id = selectedSegmentID else { return }
        metadata?.editSegments = EditTimeline.removing(segments: retainedSegments, id: id)
        selectedSegmentID = nil
        pause()
        if let next = retainedSegments.first(where: { $0.endMs > currentTimeMs }) ?? retainedSegments.first {
            seek(toMilliseconds: max(next.startMs, min(currentTimeMs, next.endMs)))
        }
    }
    func setSelectedSegmentSpeed(_ speed: Double) {
        guard let id = selectedSegmentID else { return }
        var segments = retainedSegments
        guard let index = segments.firstIndex(where: { $0.id == id }) else { return }
        segments[index].speed = max(0.25, min(4, speed))
        metadata?.editSegments = segments
    }
    func resetCuts() {
        metadata?.editSegments = nil
        selectedSegmentID = nil
    }
    func deleteSelection() {
        if let selectedZoomIndex { removeZoomSection(at: selectedZoomIndex) }
        else { removeSelectedSegment() }
    }
    func snapTime(_ ms: Double, toleranceMs: Double) -> Double {
        let candidates: [Double] = [0, durationMs, currentTimeMs, trimStartMs, trimEndMs]
            + retainedSegments.flatMap { [$0.startMs, $0.endMs] }
            + effectiveZoomSections.flatMap { [$0.startTime, $0.endTime] }
        let nearest = candidates.min { abs($0 - ms) < abs($1 - ms) } ?? ms
        return abs(nearest - ms) <= toleranceMs ? nearest : ms
    }
    var playbackTimeMs: Double {
        playbackTimeline?.outputTime(atSourceMs: currentTimeMs) ?? currentTimeMs
    }
    func sourceTimeForPlayback(_ outputMs: Double) -> Double {
        guard outputMs.isFinite else { return currentTimeMs }
        guard let timeline = playbackTimeline else { return max(0, outputMs) }
        let clamped = max(0, min(outputMs, timeline.durationMs))
        return timeline.sourceTime(atOutputMs: clamped) ?? timeline.segments.last?.endMs ?? 0
    }
    private func nearestRetainedSourceTime(_ sourceMs: Double, timeline: EditTimeline) -> Double {
        if timeline.outputTime(atSourceMs: sourceMs) != nil { return sourceMs }
        return timeline.segments.first(where: { $0.startMs >= sourceMs })?.startMs
            ?? timeline.segments.last?.endMs ?? 0
    }
    private func rebuildEditedPlayback() {
        guard durationMs > 0 else { return }
        let timeline = editTimeline
        playbackBuildTask?.cancel()
        playbackGeneration &+= 1
        if timeline == playbackTimeline {
            isPreparingPlayback = false
            player.currentItem?.cancelPendingSeeks()
            seekInFlight = false
            pendingSeekMs = nil
            seek(toMilliseconds: currentTimeMs)
            return
        }
        pause()
        let generation = playbackGeneration
        isPreparingPlayback = true
        playbackBuildTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(80))
            guard !Task.isCancelled, let self else { return }
            guard !timeline.segments.isEmpty else {
                self.player.replaceCurrentItem(with: nil)
                self.playbackTimeline = timeline
                self.isPreparingPlayback = false
                self.renderRevision &+= 1
                return
            }
            do {
                let result = try await EditedAssetBuilder.build(source: AVURLAsset(url: self.videoURL), timeline: timeline)
                guard !Task.isCancelled, self.playbackGeneration == generation else { return }
                let sourceTime = self.nearestRetainedSourceTime(self.currentTimeMs, timeline: timeline)
                let item = AVPlayerItem(asset: result.asset)
                item.audioTimePitchAlgorithm = .timeDomain
                self.player.replaceCurrentItem(with: item)
                self.playbackTimeline = timeline
                self.webcamSegmentID = nil
                self.seekInFlight = false
                self.pendingSeekMs = nil
                self.isPreparingPlayback = false
                self.applyAudioSettings()
                self.seek(toMilliseconds: sourceTime)
                self.renderRevision &+= 1
            } catch {
                guard !Task.isCancelled, self.playbackGeneration == generation else { return }
                self.isPreparingPlayback = false
                self.loadError = "Could not prepare edited playback: \(error.localizedDescription)"
            }
        }
    }
    private func synchronizeEditedPlayback() {
        guard isPlaying, !seekInFlight else { return }
        let timeline = playbackTimeline ?? editTimeline
        let segments = timeline.segments
        guard !segments.isEmpty else { pause(); return }
        if let current = segments.first(where: { currentTimeMs >= $0.startMs && currentTimeMs < $0.endMs }) {
            player.rate = playbackTimeline == nil ? Float(current.speed) : 1
            if currentTimeMs >= webcamOffsetMs {
                if webcamSegmentID != current.id {
                    webcamPlayer?.seek(to: CMTime(seconds: max(0, currentTimeMs - webcamOffsetMs) / 1000, preferredTimescale: 60_000), toleranceBefore: .zero, toleranceAfter: .zero)
                    webcamSegmentID = current.id
                }
                webcamPlayer?.rate = Float(current.speed)
            } else { webcamPlayer?.pause() }
        } else if playbackTimeline == nil, let next = segments.first(where: { $0.startMs > currentTimeMs }) {
            seek(toMilliseconds: next.startMs)
            player.rate = Float(next.speed)
        } else {
            pause()
            seek(toMilliseconds: segments.last!.endMs)
        }
    }

    private(set) var lookPresets: [LookPreset] = {
        guard let data = UserDefaults.standard.data(forKey: "CineScreen.lookPresets"),
              let presets = try? JSONDecoder().decode([LookPreset].self, from: data) else { return [] }
        return presets
    }()
    func saveLookPreset(named name: String) {
        guard let metadata else { return }
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty else { return }
        lookPresets.removeAll { $0.name == cleanName }
        lookPresets.append(LookPreset(name: cleanName, canvas: canvasConfiguration, cursor: metadata.cursor.config,
                                     zoom: metadata.zoom.config, effects: metadata.effects,
                                     webcam: webcamLayout, output: outputSettings))
        if lookPresets.count > 20 { lookPresets.removeFirst() }
        if let data = try? JSONEncoder().encode(lookPresets) { UserDefaults.standard.set(data, forKey: "CineScreen.lookPresets") }
    }
    func applyLookPreset(_ preset: LookPreset) {
        performEdit {
            applyCanvas(preset.canvas)
            syncCanvasToMetadata()
            metadata?.cursor.config = preset.cursor
            metadata?.zoom.config = preset.zoom
            metadata?.effects = preset.effects
            outputSettings = preset.output
            setWebcamLayout(preset.webcam)
        }
    }

    // Underlying AVFoundation
    let player: AVPlayer
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
    @ObservationIgnored private var motionSnapshot: RenderSnapshot?
    @ObservationIgnored private var motionTask: Task<Void, Never>?
    @ObservationIgnored private var pendingMotionMetadata: RecordingMetadata?
    @ObservationIgnored private var pendingMotionSections: [ZoomSection]?
    @ObservationIgnored private var motionGeneration = 0

    init(videoURL: URL, metadataURL: URL? = nil) {
        self.videoURL = videoURL
        self.projectTitle = Self.title(for: videoURL)

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
        mediaTask?.cancel()
        motionTask?.cancel()
        playbackBuildTask?.cancel()
        if let observer = timeObserver {
            player.removeTimeObserver(observer)
        }
    }

    private func applyAudioSettings() {
        let settings = outputSettings
        player.isMuted = settings.audioMuted
        guard let item = player.currentItem else { return }
        Task { [weak self, weak item] in
            guard let item,
                  let tracks = try? await item.asset.loadTracks(withMediaType: .audio),
                  self?.player.currentItem === item else { return }
            let mix = AVMutableAudioMix()
            mix.inputParameters = tracks.map { track in
                let parameters = AVMutableAudioMixInputParameters(track: track)
                parameters.setVolume(settings.effectiveAudioGain, at: .zero)
                return parameters
            }
            guard self?.outputSettings == settings else { return }
            item.audioMix = mix
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
            applyCanvas(metadata?.canvas ?? .default)
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
        guard let url = metadataURL, let metadata else {
            lastSaveError = "This recording has no editable metadata file."
            return false
        }
        do {
            try metadata.write(to: url)
            lastSaveError = nil
            hasUnsavedChanges = false
            lastSavedAt = Date()
            Log.editor.info("Saved edits to \(url.lastPathComponent)")
            return true
        } catch {
            lastSaveError = error.localizedDescription
            Log.editor.error("Autosave failed: \(error.localizedDescription)")
            return false
        }
    }

    // MARK: - Click effects

    /// Defaults matching the renderer's fallbacks (RenderSnapshot falls back
    /// to size 64 / duration 600 / white when fields are absent).
    private static let defaultClickCircles = MouseEffectsConfig.ClickCircles(
        enabled: true, size: 64, color: "#ffffff", duration: 600
    )

    var clickRingsEnabled: Bool {
        get { metadata?.effects?.clickCircles.enabled ?? false }
        set { withClickCircles { $0.enabled = newValue } }
    }

    var clickRingSize: Double {
        get { metadata?.effects?.clickCircles.size ?? Self.defaultClickCircles.size }
        set { withClickCircles { $0.size = newValue } }
    }

    var clickRingDuration: Double {
        get { metadata?.effects?.clickCircles.duration ?? Self.defaultClickCircles.duration }
        set { withClickCircles { $0.duration = newValue } }
    }

    var clickRingColorHex: String {
        get { metadata?.effects?.clickCircles.color ?? Self.defaultClickCircles.color }
        set { withClickCircles { $0.color = newValue } }
    }

    /// The recorder writes `effects: nil`, so the first edit materialises the
    /// whole effects config (trail/highlight stay disabled — schema-only
    /// features). Routing the write through `self.metadata` hits the didSet
    /// hook (snapshot invalidation + autosave) like every other mutation.
    private func withClickCircles(_ mutate: (inout MouseEffectsConfig.ClickCircles) -> Void) {
        guard var metadata = metadata else { return }
        var effects = metadata.effects ?? MouseEffectsConfig(
            clickCircles: Self.defaultClickCircles,
            trail: MouseEffectsConfig.Trail(enabled: false, length: 0, fadeSpeed: 0, color: "#ffffff"),
            highlightRing: MouseEffectsConfig.HighlightRing(enabled: false, size: 0, color: "#ffffff", pulseSpeed: 0)
        )
        mutate(&effects.clickCircles)
        metadata.effects = effects
        self.metadata = metadata
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
        player.replaceCurrentItem(with: item)
        applyAudioSettings()

        Task {
            await loadDuration(asset: asset)
        }

        // Periodic time observer — updates currentTimeMs at 30Hz for the timeline.
        // The callback runs on .main so we can assert MainActor isolation.
        let interval = CMTime(value: 1, timescale: 30)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self else { return }
                if !self.seekInFlight {
                    self.currentTimeMs = self.sourceTimeForPlayback(time.seconds * 1000)
                }
                self.synchronizeEditedPlayback()

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
                self.mediaTask = Task { [weak self] in
                    guard let url = self?.videoURL else { return }
                    let media = await TimelineMedia.load(url: url, durationMs: ms)
                    guard !Task.isCancelled else { return }
                    self?.timelineThumbnails = media.thumbnails.map { NSImage(cgImage: $0, size: .zero) }
                    self?.timelineWaveform = media.waveform
                }
                self.suppressAutosave = true
                self.metadata?.video.duration = ms
                if self.trimEndMs > ms { self.trimEndMs = ms }
                self.suppressAutosave = false
                if self.trimEndMs == 0 {
                    // Derived default, not a user edit — don't autosave it.
                    self.suppressAutosave = true
                    self.trimEndMs = ms
                    self.suppressAutosave = false
                }
                if self.metadata?.editSegments != nil || self.metadata?.trim != nil { self.rebuildEditedPlayback() }
            }
        } catch {
            await MainActor.run {
                self.loadError = "Could not load video duration: \(error.localizedDescription)"
            }
        }
    }

    // MARK: - Playback controls

    func play() {
        guard !isPreparingPlayback, let first = retainedSegments.first else { return }
        if !retainedSegments.contains(where: { currentTimeMs >= $0.startMs && currentTimeMs < $0.endMs }) {
            seek(toMilliseconds: first.startMs)
        }
        isPlaying = true
        player.rate = playbackTimeline == nil ? Float(retainedSegments.first(where: { currentTimeMs >= $0.startMs && currentTimeMs < $0.endMs })?.speed ?? 1) : 1
        if currentTimeMs >= webcamOffsetMs { webcamPlayer?.rate = Float(retainedSegments.first(where: { currentTimeMs >= $0.startMs && currentTimeMs < $0.endMs })?.speed ?? 1) }
        synchronizeEditedPlayback()
    }

    func pause() {
        player.pause()
        webcamPlayer?.pause()
        isPlaying = false
    }

    func togglePlayPause() {
        if isPlaying { pause() } else { play() }
    }

    /// One-frame step at the recording's native rate; pauses playback so the
    /// stepped frame stays visible.
    func stepFrame(_ direction: Int) {
        pause()
        let fps = max(1.0, metadata?.video.frameRate ?? 60)
        let outputTime = editTimeline.outputTime(atSourceMs: currentTimeMs) ?? 0
        let next = max(0, min(editedDurationMs, outputTime + Double(direction) * (1000.0 / fps)))
        if let source = editTimeline.sourceTime(atOutputMs: next) { seek(toMilliseconds: source) }
    }

    func seek(toMilliseconds ms: Double) {
        let bounded = max(0, min(ms, durationMs))
        let clamped = playbackTimeline.map { nearestRetainedSourceTime(bounded, timeline: $0) } ?? bounded
        currentTimeMs = clamped
        if seekInFlight {
            pendingSeekMs = clamped
            return
        }
        performSeek(to: clamped)
    }

    private func performSeek(to ms: Double) {
        seekInFlight = true
        let itemMs = playbackTimeline?.outputTime(atSourceMs: ms) ?? ms
        let seekGeneration = playbackGeneration
        player.seek(to: CMTime(seconds: itemMs / 1000, preferredTimescale: 60_000),
                    toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.playbackGeneration == seekGeneration else { return }
                self.renderRevision &+= 1
                if let pending = self.pendingSeekMs {
                    self.pendingSeekMs = nil
                    self.performSeek(to: pending)
                } else {
                    self.seekInFlight = false
                    self.synchronizeEditedPlayback()
                    let webcamSeconds = max(0, ms - self.webcamOffsetMs) / 1000
                    self.webcamPlayer?.seek(to: CMTime(seconds: webcamSeconds, preferredTimescale: 600),
                                            toleranceBefore: .zero, toleranceAfter: .zero)
                }
            }
        }
    }

    // MARK: - Per-frame state

    /// Sample one snapshot and timestamp for all overlays in a preview draw.
    func compositionState(atMilliseconds ms: Double) -> CompositionState {
        let snapshot = makePreviewSnapshot()
        return CompositionState(cursor: snapshot?.cursorStateForExport(atMilliseconds: ms),
                                clicks: snapshot?.clickRingStates(atMilliseconds: ms) ?? [],
                                zoom: snapshot?.zoomState(atMilliseconds: ms) ?? .identity,
                                canvas: canvasStyle, output: outputSettings, webcamLayout: webcamLayout)
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
            scale: level,
            transitionMs: metadata.zoom.config.transitionSpeed
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
        scale: Double,
        transitionMs: Double = 700
    ) -> [ZoomSection] {
        let downClicks = clicks.filter { $0.action == .down && $0.timestamp.isFinite }.sorted { $0.timestamp < $1.timestamp }
        guard !downClicks.isEmpty else { return [] }

        var sections: [ZoomSection] = []
        let clusterGapMs = max(2_000.0, transitionMs * 2 + 1_200)
        let ramp = max(120, min(1200, transitionMs))
        let preroll = ramp
        let postroll = ramp + 1_200.0

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
        let ownsTransaction = !history.isEditing
        if ownsTransaction { beginEditing() }
        defer { if ownsTransaction { endEditing() } }
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
        let ownsTransaction = !history.isEditing
        if ownsTransaction { beginEditing() }
        defer { if ownsTransaction { endEditing() } }
        guard var metadata = metadata else { return }
        let generated = Self.generateZoomSections(
            from: metadata.clicks,
            videoDuration: metadata.video.duration,
            scale: metadata.zoom.config.level,
            transitionMs: metadata.zoom.config.transitionSpeed
        )
        metadata.zoom.sections = generated
        self.metadata = metadata
        selectedZoomIndex = nil
    }

    func removeZoomSection(at index: Int) {
        let ownsTransaction = !history.isEditing
        if ownsTransaction { beginEditing() }
        defer { if ownsTransaction { endEditing() } }
        materializeIfAuto()
        guard var metadata = metadata, metadata.zoom.sections.indices.contains(index) else { return }
        metadata.zoom.sections.remove(at: index)
        self.metadata = metadata
        if selectedZoomIndex == index { selectedZoomIndex = nil }
        else if let s = selectedZoomIndex, s > index { selectedZoomIndex = s - 1 }
    }

    func updateZoomSection(at index: Int, startTime: Double? = nil, endTime: Double? = nil,
                           scale: Double? = nil) {
        let ownsTransaction = !history.isEditing
        if ownsTransaction { beginEditing() }
        defer { if ownsTransaction { endEditing() } }
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

    func updateZoomTarget(at index: Int, mode: ZoomTargetMode? = nil, x: Double? = nil, y: Double? = nil) {
        performEdit {
            materializeIfAuto()
            guard var value = metadata, value.zoom.sections.indices.contains(index) else { return }
            var section = value.zoom.sections[index]
            if let mode {
                if mode == .fixed, section.targetMode != .fixed { section.centerX = 0.5; section.centerY = 0.5 }
                section.targetMode = mode
            }
            if let x { section.centerX = max(0, min(1, x)) }
            if let y { section.centerY = max(0, min(1, y)) }
            value.zoom.sections[index] = section
            metadata = value
        }
    }

    private func sameMotion(_ first: RecordingMetadata, _ second: RecordingMetadata, _ firstSections: [ZoomSection], _ secondSections: [ZoomSection]) -> Bool {
        first.cursor.keyframes == second.cursor.keyframes && first.clicks == second.clicks
            && first.video == second.video && first.zoom.config == second.zoom.config
            && firstSections == secondSections
    }

    /// Expensive trajectory work runs away from the UI. Debouncing avoids
    /// repeatedly integrating a long recording while a zoom edge is dragged.
    private func prepareMotionSnapshot() {
        guard let metadata, let previous = motionSnapshot else { return }
        let sections = activeZoomSections(metadata: metadata)
        if sameMotion(previous.metadata, metadata, previous.zoomSections, sections) {
            motionTask?.cancel()
            motionTask = nil
            pendingMotionMetadata = nil
            return
        }
        if let pendingMotionMetadata, let pendingMotionSections,
           sameMotion(pendingMotionMetadata, metadata, pendingMotionSections, sections) { return }
        motionTask?.cancel()
        motionGeneration &+= 1
        let generation = motionGeneration
        pendingMotionMetadata = metadata
        pendingMotionSections = sections
        motionTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(40))
            guard !Task.isCancelled else { return }
            let worker = Task.detached(priority: .userInitiated) {
                RenderSnapshot(metadata: metadata, zoomSections: sections)
            }
            let computed = await worker.value
            guard !Task.isCancelled, let self, self.motionGeneration == generation,
                  let current = self.metadata else { return }
            self.motionSnapshot = computed
            self.cachedSnapshot = RenderSnapshot(metadata: current, zoomSections: sections,
                                                 panSamples: computed.panSamples, cursorSamples: computed.cursorSamples)
            self.motionTask = nil
            self.pendingMotionMetadata = nil
            self.renderRevision &+= 1
        }
    }
    private func makePreviewSnapshot() -> RenderSnapshot? {
        if motionTask != nil, let motionSnapshot { return motionSnapshot }
        return makeRenderSnapshot()
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
        let snapshot: RenderSnapshot
        if let previous = motionSnapshot,
           sameMotion(previous.metadata, metadata, previous.zoomSections, sections) {
            snapshot = RenderSnapshot(metadata: metadata, zoomSections: sections,
                                      panSamples: previous.panSamples, cursorSamples: previous.cursorSamples)
        } else {
            motionTask?.cancel()
            motionTask = nil
            pendingMotionMetadata = nil
            snapshot = RenderSnapshot(metadata: metadata, zoomSections: sections)
            motionSnapshot = snapshot
        }
        cachedSnapshot = snapshot
        return snapshot
    }

}
