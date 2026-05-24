import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import CoreGraphics
import AppKit

/// What the caller asked us to capture.
struct CaptureRequest {
    var outputURL: URL
    var displayID: CGDirectDisplayID = CGMainDisplayID()
    /// Set to capture a single window instead of the full display.
    var windowID: CGWindowID? = nil
    /// Pre-built filter from the native `SCContentSharingPicker`. Takes
    /// precedence over `windowID` / `displayID` when set.
    var preBuiltFilter: SCContentFilter? = nil
    var region: CGRect? = nil          // in pixels, top-left origin
    var fps: Int = 60
    var quality: Quality = .medium
    var captureSystemAudio: Bool = false
    var captureMic: Bool = false
    var captureCamera: Bool = false
    /// AVCaptureDevice uniqueID. `nil` = system default camera.
    var cameraDeviceID: String? = nil
    /// URL the webcam capture writes to. Defaults to a sibling of `outputURL`
    /// named `webcam.mp4`. Caller can override.
    var webcamURL: URL? = nil

    enum Quality: String, Codable {
        case low, medium, high
    }
}

/// One window available for window-only capture.
struct CaptureWindow: Identifiable, Hashable {
    let id: CGWindowID
    let title: String
    let appName: String
    let size: CGSize
}

/// What the caller can read off the service after `start()` returns.
struct CaptureInfo {
    var outputURL: URL
    var pixelWidth: Int
    var pixelHeight: Int
    var fps: Int
    var displayBounds: CGRect       // in points
    var scaleFactor: CGFloat
    var hasSystemAudio: Bool
    var hasMic: Bool
    var webcamURL: URL? = nil
}

struct CaptureResult {
    var outputURL: URL
    var frames: Int64
    var info: CaptureInfo
}

enum CaptureError: LocalizedError {
    case alreadyRunning
    case notRunning
    case noDisplay
    case writerSetup(String)
    case writerStartFailed(String)
    case streamSetup(String)
    case writerFinishFailed(String)
    case missingMicDevice
    case micSetup(String)

    var errorDescription: String? {
        switch self {
        case .alreadyRunning:    return "A capture session is already running."
        case .notRunning:        return "No capture session is running."
        case .noDisplay:         return "No display is available to capture."
        case let .writerSetup(m):     return "AVAssetWriter setup failed: \(m)"
        case let .writerStartFailed(m): return "AVAssetWriter failed to start: \(m)"
        case let .streamSetup(m):     return "SCStream setup failed: \(m)"
        case let .writerFinishFailed(m): return "AVAssetWriter finish failed: \(m)"
        case .missingMicDevice:  return "No microphone device available."
        case let .micSetup(m):        return "Microphone capture setup failed: \(m)"
        }
    }
}

@MainActor
final class ScreenCaptureService: NSObject {
    // Public, observable-ish state. Kept simple; the orchestrator can wrap
    // it in @Observable.
    private(set) var info: CaptureInfo?
    private(set) var isRecording: Bool = false

    // Internals
    private var stream: SCStream?
    private var streamOutput: StreamOutput?
    private var assetWriter: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var systemAudioInput: AVAssetWriterInput?
    private var micInput: AVAssetWriterInput?
    private var micSession: AVCaptureSession?
    private var micOutputDelegate: MicOutputDelegate?

    private let sampleQueue = DispatchQueue(label: "com.cinescreen.capture.samples", qos: .userInteractive)
    private let micQueue = DispatchQueue(label: "com.cinescreen.capture.mic", qos: .userInteractive)

    private var frameCount: Int64 = 0

    private var cursorHidden = false

    // MARK: - Discovery

    /// List on-screen windows large enough to record (≥100×100). Used by the
    /// "Record window" picker in the recording tab.
    static func availableWindows() async throws -> [CaptureWindow] {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        return content.windows
            .filter { $0.frame.width >= 100 && $0.frame.height >= 100 }
            .map {
                CaptureWindow(
                    id: $0.windowID,
                    title: $0.title ?? "",
                    appName: $0.owningApplication?.applicationName ?? "",
                    size: $0.frame.size
                )
            }
    }

    // MARK: - Lifecycle

    func start(_ request: CaptureRequest) async throws -> CaptureInfo {
        guard !isRecording else { throw CaptureError.alreadyRunning }

        // 1. Resolve the display (and optional window)
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == request.displayID })
              ?? content.displays.first else {
            throw CaptureError.noDisplay
        }
        let window: SCWindow? = request.windowID.flatMap { id in
            content.windows.first(where: { $0.windowID == id })
        }

        let scale = Self.backingScale(for: display.displayID)
        let displayPoints = CGRect(x: 0, y: 0, width: CGFloat(display.width), height: CGFloat(display.height))

        // 2. Output dimensions in pixels, sourceRect in points
        var outputW: Int
        var outputH: Int
        var sourceRect: CGRect? = nil
        if let preBuilt = request.preBuiltFilter {
            // Native picker gave us a filter — its contentRect is in points,
            // and pointPixelScale converts to native pixels. Using contentRect
            // (not window.frame) is what captures the FULL window chrome —
            // title bar / toolbar / drop shadow region — without cropping.
            let rect = preBuilt.contentRect
            let pxScale = CGFloat(preBuilt.pointPixelScale)
            outputW = Int(rect.width * pxScale)
            outputH = Int(rect.height * pxScale)
        } else if let window = window {
            // Window capture (legacy windowID path): build the filter early
            // so we can use its contentRect for sizing. This is what makes
            // the title bar render — window.frame alone excludes the chrome
            // padding SCK adds around the window.
            let probeFilter = SCContentFilter(desktopIndependentWindow: window)
            let rect = probeFilter.contentRect
            let pxScale = CGFloat(probeFilter.pointPixelScale)
            outputW = Int(rect.width * pxScale)
            outputH = Int(rect.height * pxScale)
        } else if let region = request.region {
            outputW = Int(region.width)
            outputH = Int(region.height)
            sourceRect = CGRect(
                x: region.origin.x / scale,
                y: region.origin.y / scale,
                width: region.size.width / scale,
                height: region.size.height / scale
            )
        } else {
            outputW = Int(CGFloat(display.width) * scale)
            outputH = Int(CGFloat(display.height) * scale)
        }

        // Cap the longest side to 2560px so the encoder doesn't get drowned
        // at 60fps. 14"/16" MBPs report 3456×2234 native; scaling to roughly
        // 2560×1654 keeps near-Retina detail while staying well inside what
        // VideoToolbox HEVC + AVAssetWriter handles reliably on this machine.
        let maxLongestSide = 2560
        let longest = max(outputW, outputH)
        if longest > maxLongestSide {
            let factor = Double(maxLongestSide) / Double(longest)
            outputW = (Int(Double(outputW) * factor) / 2) * 2
            outputH = (Int(Double(outputH) * factor) / 2) * 2
        }

        // 3. Build SCStreamConfiguration
        //
        // NV12 (420YpCbCr8BiPlanarFullRange) is HEVC's native input format —
        // no BGRA→YUV conversion in the encoder hot path. The combination of
        // BGRA + HEVC at 4K was where the encoder was choking with err=-16122.
        let cfg = SCStreamConfiguration()
        cfg.width = outputW
        cfg.height = outputH
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(request.fps))
        cfg.queueDepth = 8
        cfg.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        cfg.colorSpaceName = CGColorSpace.sRGB
        cfg.showsCursor = false
        cfg.scalesToFit = false
        // Single-window capture: drop the OS drop shadow so the window chrome
        // (title bar, traffic lights, toolbar) sits flush at the frame edge.
        // The editor then composites its own shadow over the gradient bg.
        cfg.ignoreShadowsSingleWindow = true
        // Include child windows (popovers, sheets, accessory bars attached to
        // the title bar). Without this, sheets and the menu would clip away.
        if #available(macOS 14.2, *) {
            cfg.includeChildWindows = true
        }
        if let rect = sourceRect { cfg.sourceRect = rect }
        if request.captureSystemAudio {
            cfg.capturesAudio = true
            cfg.sampleRate = 48000
            cfg.channelCount = 2
            cfg.excludesCurrentProcessAudio = true
        }

        let filter: SCContentFilter = {
            if let preBuilt = request.preBuiltFilter {
                return preBuilt
            }
            if let window = window {
                return SCContentFilter(desktopIndependentWindow: window)
            }
            return SCContentFilter(display: display, excludingWindows: [])
        }()

        // 4. AVAssetWriter
        let url = request.outputURL
        try? FileManager.default.removeItem(at: url)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        let fileType: AVFileType = (url.pathExtension.lowercased() == "mp4") ? .mp4 : .mov
        let writer: AVAssetWriter
        do {
            writer = try AVAssetWriter(outputURL: url, fileType: fileType)
        } catch {
            throw CaptureError.writerSetup(error.localizedDescription)
        }

        // Video input + pixel-buffer adaptor.
        //
        // HEVC + the pixel-buffer adaptor pattern is what Apple's own SCK
        // sample code uses for high-resolution capture. The adaptor wraps
        // the input and lets us append raw CVPixelBuffers — VideoToolbox
        // handles format negotiation cleanly without the FigAssetWriter
        // rejections we saw with direct CMSampleBuffer appends.
        let evenW = outputW - (outputW % 2)
        let evenH = outputH - (outputH % 2)
        let bitrate = Self.videoBitrate(
            quality: request.quality, width: evenW, height: evenH, fps: request.fps
        )
        // Use Apple's `AVOutputSettingsAssistant` to source known-good codec
        // settings, then override only width/height. Following Nonstrict's
        // SCK + AVAssetWriter recipe — hand-crafted settings kept getting
        // rejected at decode time (VRP err=-12852, FigFilePlayer err=-12860).
        // The assistant picks H.264 + sane profile/level for the preset.
        let assistantPreset: AVOutputSettingsPreset = {
            let longest = max(evenW, evenH)
            if longest > 1920 { return .preset3840x2160 }
            if longest > 1280 { return .preset1920x1080 }
            return .preset1280x720
        }()
        let assistant = AVOutputSettingsAssistant(preset: assistantPreset)
        var videoSettings: [String: Any] = assistant?.videoSettings ?? [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: evenW,
            AVVideoHeightKey: evenH,
        ]
        videoSettings[AVVideoWidthKey] = evenW
        videoSettings[AVVideoHeightKey] = evenH
        let codec = (videoSettings[AVVideoCodecKey] as? String) ?? "h264"
        Log.capture.info("Using preset \(assistantPreset.rawValue) for \(evenW)x\(evenH), codec=\(codec)")
        let vInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        vInput.expectsMediaDataInRealTime = true
        guard writer.canAdd(vInput) else {
            throw CaptureError.writerSetup("video input cannot be added (\(evenW)x\(evenH), codec=\(codec))")
        }
        writer.add(vInput)

        // Adaptor exposes a pixel buffer pool that matches the encoder's
        // expected format. We use it to ingest SCK's pixel buffers without
        // any format mismatch chance.
        let pbAdaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: vInput,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
                kCVPixelBufferWidthKey as String: evenW,
                kCVPixelBufferHeightKey as String: evenH,
                kCVPixelBufferMetalCompatibilityKey as String: true,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:],
            ]
        )
        Log.capture.info("Video input added")

        // System audio input
        var sysInput: AVAssetWriterInput? = nil
        if request.captureSystemAudio {
            let s = AVAssetWriterInput(mediaType: .audio, outputSettings: Self.aacSettings(channels: 2, bitrate: 128_000))
            s.expectsMediaDataInRealTime = true
            if writer.canAdd(s) {
                writer.add(s)
                sysInput = s
            } else {
                Log.capture.warning("Could not add system-audio writer input; proceeding without it")
            }
        }

        // Mic input
        var mInput: AVAssetWriterInput? = nil
        var session: AVCaptureSession? = nil
        var micDelegate: MicOutputDelegate? = nil
        if request.captureMic {
            let m = AVAssetWriterInput(mediaType: .audio, outputSettings: Self.aacSettings(channels: 1, bitrate: 96_000))
            m.expectsMediaDataInRealTime = true
            guard writer.canAdd(m) else {
                throw CaptureError.writerSetup("mic input cannot be added")
            }
            writer.add(m)
            mInput = m
            (session, micDelegate) = try Self.makeMicSession(target: m, queue: micQueue, getSessionStart: { [weak self] in
                self?.streamOutput?.sessionStartTime
            })
        }

        // 5. Start writing first so it's ready when frames arrive
        guard writer.startWriting() else {
            throw CaptureError.writerStartFailed(writer.error?.localizedDescription ?? "unknown")
        }

        // 6. SCStream
        let output = StreamOutput(
            owner: self,
            writer: writer,
            videoInput: vInput,
            pixelBufferAdaptor: pbAdaptor,
            systemAudioInput: sysInput
        )
        let scStream = SCStream(filter: filter, configuration: cfg, delegate: output)
        do {
            try scStream.addStreamOutput(output, type: .screen, sampleHandlerQueue: sampleQueue)
            if request.captureSystemAudio {
                try scStream.addStreamOutput(output, type: .audio, sampleHandlerQueue: sampleQueue)
            }
        } catch {
            throw CaptureError.streamSetup(error.localizedDescription)
        }

        do {
            try await scStream.startCapture()
        } catch {
            throw CaptureError.streamSetup("startCapture: \(error.localizedDescription)")
        }
        session?.startRunning()

        // 7. Hide cursor (ref-counted; matched in stop())
        CGDisplayHideCursor(display.displayID)
        cursorHidden = true

        // Commit state
        self.stream = scStream
        self.streamOutput = output
        self.assetWriter = writer
        self.videoInput = vInput
        self.systemAudioInput = sysInput
        self.micInput = mInput
        self.micSession = session
        self.micOutputDelegate = micDelegate
        self.isRecording = true
        self.frameCount = 0

        let info = CaptureInfo(
            outputURL: url,
            pixelWidth: outputW,
            pixelHeight: outputH,
            fps: request.fps,
            displayBounds: displayPoints,
            scaleFactor: scale,
            hasSystemAudio: sysInput != nil,
            hasMic: mInput != nil
        )
        self.info = info
        Log.capture.info("Capture started \(outputW)x\(outputH) @ \(request.fps)fps scale=\(scale)")
        return info
    }

    func stop() async throws -> CaptureResult {
        guard isRecording else { throw CaptureError.notRunning }
        guard let info = info, let writer = assetWriter else {
            throw CaptureError.notRunning
        }
        Log.capture.info("Stop requested. Writer status: \(writer.status.rawValue)")

        // Stop SCStream and mic first so no more samples arrive.
        if let stream = stream {
            Log.capture.debug("Stopping SCStream…")
            do { try await stream.stopCapture() } catch {
                Log.capture.warning("stopCapture threw: \(error.localizedDescription)")
            }
            Log.capture.debug("SCStream stopped")
        }
        micSession?.stopRunning()

        // Show cursor (single decrement matching the single hide call).
        if cursorHidden {
            CGDisplayShowCursor(CGMainDisplayID())
            cursorHidden = false
        }

        // Mark inputs finished and finalize.
        videoInput?.markAsFinished()
        systemAudioInput?.markAsFinished()
        micInput?.markAsFinished()
        Log.capture.debug("Inputs marked finished")

        // If the writer never actually started a session (no first frame),
        // finishWriting() will fail. Detect this and surface a clear error
        // instead of hanging.
        if streamOutput?.sessionStartTime == nil {
            Log.capture.warning("No frames captured before stop; aborting writer")
            try? FileManager.default.removeItem(at: info.outputURL)
            resetState()
            throw CaptureError.writerFinishFailed(
                "No frames were captured before stop. Try recording for at least a second."
            )
        }

        // Race finishWriting against a hard timeout so the UI doesn't hang.
        let finished = await withTimeout(seconds: 15) {
            await writer.finishWriting()
        }
        if !finished {
            Log.capture.error("Writer.finishWriting timed out after 15s")
        }
        let frames = streamOutput?.frameCount ?? 0
        Log.capture.info("Writer status after finish: \(writer.status.rawValue), frames=\(frames)")

        let success = writer.status == .completed
        defer { resetState() }

        if success {
            Log.capture.info("Capture stopped, frames=\(frames)")
            return CaptureResult(outputURL: info.outputURL, frames: frames, info: info)
        } else {
            // Surface as much detail as we can about the writer failure —
            // localizedDescription is usually just "The operation could not
            // be completed" which is useless on its own.
            let detail = Self.describe(error: writer.error, writerStatus: writer.status)
            Log.capture.error("AVAssetWriter finish failed → \(detail)")
            throw CaptureError.writerFinishFailed(detail)
        }
    }

    private static func describe(error: Error?, writerStatus: AVAssetWriter.Status) -> String {
        guard let err = error as NSError? else {
            return "status=\(writerStatus.rawValue), no NSError"
        }
        let underlying = err.userInfo[NSUnderlyingErrorKey] as? NSError
        var parts = [
            "domain=\(err.domain)",
            "code=\(err.code)",
            "desc=\(err.localizedDescription)"
        ]
        if let reason = err.localizedFailureReason {
            parts.append("reason=\(reason)")
        }
        if let underlying = underlying {
            parts.append("underlying=(domain=\(underlying.domain) code=\(underlying.code))")
        }
        return parts.joined(separator: " · ")
    }

    private func resetState() {
        self.stream = nil
        self.streamOutput = nil
        self.assetWriter = nil
        self.videoInput = nil
        self.systemAudioInput = nil
        self.micInput = nil
        self.micSession = nil
        self.micOutputDelegate = nil
        self.isRecording = false
    }

    /// Returns true if `operation` completed before the timeout.
    private func withTimeout(seconds: Double, operation: @escaping () async -> Void) async -> Bool {
        await withTaskGroup(of: Bool.self) { group in
            group.addTask {
                await operation()
                return true
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                return false
            }
            let first = await group.next() ?? false
            group.cancelAll()
            return first
        }
    }

    // MARK: - Helpers

    private static func backingScale(for displayID: CGDirectDisplayID) -> CGFloat {
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        for screen in NSScreen.screens {
            if let n = screen.deviceDescription[key] as? NSNumber, n.uint32Value == displayID {
                return screen.backingScaleFactor
            }
        }
        return NSScreen.main?.backingScaleFactor ?? 2.0
    }

    private static func videoBitrate(quality: CaptureRequest.Quality, width: Int, height: Int, fps: Int) -> Int {
        // Lowered from the original (0.05, 0.10, 0.20) — those were busting
        // the auto-selected H.264 level at 4K-ish resolutions and the encoder
        // would silently fail (err=-16122). H.264 high-profile auto level
        // tops out around 50 Mbps for level 5.x; we stay well under that.
        let pixelsPerSecond = Double(width * height * fps)
        let bitsPerPixel: Double
        switch quality {
        case .low:    bitsPerPixel = 0.04
        case .medium: bitsPerPixel = 0.08
        case .high:   bitsPerPixel = 0.14
        }
        // Cap at 40 Mbps regardless to stay inside level 5.x limits.
        return min(40_000_000, Int(pixelsPerSecond * bitsPerPixel))
    }

    private static func aacSettings(channels: Int, bitrate: Int) -> [String: Any] {
        [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVNumberOfChannelsKey: channels,
            AVSampleRateKey: 48000,
            AVEncoderBitRateKey: bitrate
        ]
    }

    private static func makeMicSession(
        target: AVAssetWriterInput,
        queue: DispatchQueue,
        getSessionStart: @escaping () -> CMTime?
    ) throws -> (AVCaptureSession, MicOutputDelegate) {
        let session = AVCaptureSession()
        session.beginConfiguration()
        guard let device = AVCaptureDevice.default(for: .audio) else {
            throw CaptureError.missingMicDevice
        }
        let input: AVCaptureDeviceInput
        do {
            input = try AVCaptureDeviceInput(device: device)
        } catch {
            throw CaptureError.micSetup(error.localizedDescription)
        }
        guard session.canAddInput(input) else {
            throw CaptureError.micSetup("cannot add device input")
        }
        session.addInput(input)

        let output = AVCaptureAudioDataOutput()
        let delegate = MicOutputDelegate(target: target, getSessionStart: getSessionStart)
        output.setSampleBufferDelegate(delegate, queue: queue)
        guard session.canAddOutput(output) else {
            throw CaptureError.micSetup("cannot add audio output")
        }
        session.addOutput(output)
        session.commitConfiguration()
        return (session, delegate)
    }
}

// MARK: - SCStream output handler

/// Holds the SCStreamOutput conformance separately so the service class can stay
/// @MainActor while the sample callbacks run on `sampleQueue`.
///
/// IMPORTANT: `startSession(atSourceTime:)` MUST be called synchronously on
/// the same queue that's about to call `appendSampleBuffer`, otherwise the
/// writer raises `NSInternalInconsistencyException`. So we hold the writer
/// here and start the session inline when the first complete frame arrives.
private final class StreamOutput: NSObject, SCStreamDelegate, SCStreamOutput {
    weak var owner: ScreenCaptureService?
    let writer: AVAssetWriter
    let videoInput: AVAssetWriterInput
    let pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor
    let systemAudioInput: AVAssetWriterInput?

    private let stateLock = NSLock()
    private var _sessionStartTime: CMTime?
    private(set) var frameCount: Int64 = 0

    /// Read by the mic delegate (on micQueue). nil until the screen session
    /// has actually started; samples received before this must be dropped.
    var sessionStartTime: CMTime? {
        stateLock.lock(); defer { stateLock.unlock() }
        return _sessionStartTime
    }

    init(owner: ScreenCaptureService,
         writer: AVAssetWriter,
         videoInput: AVAssetWriterInput,
         pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor,
         systemAudioInput: AVAssetWriterInput?) {
        self.owner = owner
        self.writer = writer
        self.videoInput = videoInput
        self.pixelBufferAdaptor = pixelBufferAdaptor
        self.systemAudioInput = systemAudioInput
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard sampleBuffer.isValid else { return }

        // Block any appends until the writer's session has actually started.
        // The session is started inline on the FIRST complete .screen sample.
        let started: Bool
        stateLock.lock()
        started = (_sessionStartTime != nil)
        stateLock.unlock()

        if !started {
            // Drop everything except the first complete screen frame.
            guard type == .screen else { return }
            guard
                let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                let info = attachments.first,
                let statusRaw = info[SCStreamFrameInfo.status] as? Int,
                let frameStatus = SCFrameStatus(rawValue: statusRaw),
                frameStatus == .complete
            else { return }

            // Make sure the writer is actually writing before we touch the session.
            guard self.writer.status == .writing else {
                let status = self.writer.status.rawValue
                Log.capture.warning("Writer status is \(status) at first frame; dropping")
                return
            }

            let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            // Rebase the output file timeline to start at 0. SCK delivers
            // PTS in the host clock (~880000s — days since boot). Writing
            // those raw into the file gave decoders trouble — even with
            // startSession matching, FigFilePlayer rejects with err=-12860.
            // Starting the file at PTS .zero is what every working sample
            // (camera, AirPlay, etc) does.
            writer.startSession(atSourceTime: .zero)
            stateLock.lock()
            _sessionStartTime = pts
            stateLock.unlock()
            Log.capture.info("Writer session started; rebasing host PTS \(pts.seconds)s → 0s in output file")
            // Fall through to append this same buffer below.
        }

        guard writer.status == .writing else { return }
        guard let baseTime = sessionStartTime else { return }

        switch type {
        case .screen:
            guard videoInput.isReadyForMoreMediaData else { return }
            guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
            let rawPts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            let rebasedPts = CMTimeSubtract(rawPts, baseTime)
            let ok = pixelBufferAdaptor.append(pixelBuffer, withPresentationTime: rebasedPts)
            if ok {
                frameCount &+= 1
            } else if self.writer.status == .failed {
                let err = self.writer.error?.localizedDescription ?? "unknown"
                Log.capture.error("Video append failed; writer.error: \(err)")
            }
        case .audio:
            guard let a = systemAudioInput, a.isReadyForMoreMediaData else { return }
            // Audio also needs to be rebased so it stays in sync with video.
            let rawPts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            let rebasedPts = CMTimeSubtract(rawPts, baseTime)
            if let rebased = Self.rebaseAudio(sampleBuffer, to: rebasedPts) {
                _ = a.append(rebased)
            }
        default:
            break
        }
    }

    /// Builds a copy of an audio sample buffer with its PTS rewritten so it
    /// aligns with the rebased video timeline.
    fileprivate static func rebaseAudio(_ buffer: CMSampleBuffer, to newPTS: CMTime) -> CMSampleBuffer? {
        var info = CMSampleTimingInfo()
        info.presentationTimeStamp = newPTS
        info.duration = CMSampleBufferGetDuration(buffer)
        info.decodeTimeStamp = .invalid
        var out: CMSampleBuffer?
        let status = CMSampleBufferCreateCopyWithNewTiming(
            allocator: kCFAllocatorDefault,
            sampleBuffer: buffer,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &info,
            sampleBufferOut: &out
        )
        return status == noErr ? out : nil
    }

    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        Log.capture.error("SCStream stopped with error: \(error.localizedDescription)")
    }
}

// MARK: - Mic delegate

private final class MicOutputDelegate: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    let target: AVAssetWriterInput
    let getSessionStart: () -> CMTime?

    init(target: AVAssetWriterInput, getSessionStart: @escaping () -> CMTime?) {
        self.target = target
        self.getSessionStart = getSessionStart
    }

    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        // Mic samples carry raw host-clock PTS (days-since-boot). Rebase by
        // the SCK session start the same way StreamOutput rebases video and
        // system audio — otherwise AVAssetWriter derives the file duration
        // from the mic PTS and the editor shows hundreds of hours.
        guard let baseTime = getSessionStart(), sampleBuffer.isValid else { return }
        guard target.isReadyForMoreMediaData else { return }
        let rawPts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let rebasedPts = CMTimeSubtract(rawPts, baseTime)
        // Mic samples buffered before SCK's first frame would rebase negative.
        guard rebasedPts >= .zero else { return }
        if let rebased = StreamOutput.rebaseAudio(sampleBuffer, to: rebasedPts) {
            _ = target.append(rebased)
        }
    }
}
