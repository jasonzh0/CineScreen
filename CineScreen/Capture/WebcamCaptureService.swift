import Foundation
import AVFoundation
import CoreMedia

/// Standalone webcam recorder. Runs in parallel with `ScreenCaptureService` so
/// the carefully-tuned ScreenCaptureKit + AVAssetWriter pipeline for the main
/// screen recording stays untouched.
///
/// Writes a 1280×720 H.264 MP4 to the given URL. The editor (and a future
/// export pass) read this sibling file to composite the webcam overlay.
@MainActor
final class WebcamCaptureService: NSObject {
    private(set) var isRecording = false
    private(set) var outputURL: URL?

    private var session: AVCaptureSession?
    private var writer: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var output: AVCaptureVideoDataOutput?
    private var delegate: WebcamFrameDelegate?
    private let frameQueue = DispatchQueue(label: "com.cinescreen.webcam.frames", qos: .userInteractive)

    /// Discoverable webcam devices, newest first. Used by the device picker in
    /// Settings.
    static func availableDevices() -> [AVCaptureDevice] {
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera],
            mediaType: .video,
            position: .unspecified
        )
        return discovery.devices
    }

    static func device(withUniqueID id: String?) -> AVCaptureDevice? {
        if let id = id, let d = AVCaptureDevice(uniqueID: id) { return d }
        return AVCaptureDevice.default(for: .video)
    }

    /// Begin capturing. Throws if no camera is available or the writer can't
    /// be configured. On success the writer is in `.writing` state and frames
    /// start landing as soon as the session warms up.
    func start(outputURL: URL, deviceID: String?) throws {
        guard !isRecording else { return }
        guard let device = Self.device(withUniqueID: deviceID) else {
            throw WebcamError.noDevice
        }

        // Tear down a stale file at the target path. AVAssetWriter refuses to
        // initialize over an existing file.
        try? FileManager.default.removeItem(at: outputURL)
        try FileManager.default.createDirectory(
            at: outputURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        // 1. Capture session — discrete from the screen recorder's session so
        //    it can be configured independently.
        let session = AVCaptureSession()
        session.beginConfiguration()
        session.sessionPreset = .high

        let input: AVCaptureDeviceInput
        do {
            input = try AVCaptureDeviceInput(device: device)
        } catch {
            throw WebcamError.deviceInput(error.localizedDescription)
        }
        guard session.canAddInput(input) else {
            throw WebcamError.deviceInput("cannot add device input")
        }
        session.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        output.alwaysDiscardsLateVideoFrames = true
        guard session.canAddOutput(output) else {
            throw WebcamError.outputSetup("cannot add video data output")
        }
        session.addOutput(output)

        // 2. Pick the output dimensions. Webcam frames are usually 1280×720 or
        //    1920×1080; we clamp the longest side to 1280 so the overlay file
        //    stays small and easy to scrub.
        let format = device.activeFormat
        let desc = format.formatDescription
        let dims = CMVideoFormatDescriptionGetDimensions(desc)
        let srcW = Int(dims.width)
        let srcH = Int(dims.height)
        let maxSide = 1280
        let scale = max(srcW, srcH) > maxSide ? Double(maxSide) / Double(max(srcW, srcH)) : 1.0
        let outW = (Int(Double(srcW) * scale) / 2) * 2
        let outH = (Int(Double(srcH) * scale) / 2) * 2

        // 3. Asset writer
        let writer: AVAssetWriter
        do {
            writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        } catch {
            throw WebcamError.writerSetup(error.localizedDescription)
        }
        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: outW,
            AVVideoHeightKey: outH,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 3_500_000,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            ]
        ]
        let vInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        vInput.expectsMediaDataInRealTime = true
        guard writer.canAdd(vInput) else {
            throw WebcamError.writerSetup("writer rejected video input")
        }
        writer.add(vInput)

        let delegate = WebcamFrameDelegate(writer: writer, input: vInput)
        output.setSampleBufferDelegate(delegate, queue: frameQueue)

        session.commitConfiguration()

        guard writer.startWriting() else {
            throw WebcamError.writerSetup(
                writer.error?.localizedDescription ?? "startWriting returned false"
            )
        }

        // Kick the session on a background queue — startRunning() blocks until
        // the device is warm and would stall the main thread otherwise.
        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }

        self.session = session
        self.writer = writer
        self.videoInput = vInput
        self.output = output
        self.delegate = delegate
        self.outputURL = outputURL
        self.isRecording = true

        Log.capture.info("Webcam capture started \(outW)x\(outH) device=\(device.localizedName)")
    }

    func stop() async -> URL? {
        guard isRecording, let session = session, let writer = writer else { return nil }
        isRecording = false

        session.stopRunning()
        videoInput?.markAsFinished()

        // If no frames ever landed, finishWriting will fail — return nil so the
        // caller can clean up the empty file.
        if delegate?.sessionStarted != true {
            writer.cancelWriting()
            try? FileManager.default.removeItem(at: outputURL ?? URL(fileURLWithPath: "/dev/null"))
            resetState()
            Log.capture.warning("Webcam stopped before any frames arrived")
            return nil
        }

        await writer.finishWriting()
        let url = outputURL
        let success = writer.status == .completed
        if !success {
            Log.capture.error("Webcam writer finish failed: \(writer.error?.localizedDescription ?? "unknown")")
        }
        resetState()
        return success ? url : nil
    }

    private func resetState() {
        session = nil
        writer = nil
        videoInput = nil
        output = nil
        delegate = nil
        outputURL = nil
    }
}

enum WebcamError: LocalizedError {
    case noDevice
    case deviceInput(String)
    case outputSetup(String)
    case writerSetup(String)

    var errorDescription: String? {
        switch self {
        case .noDevice:              return "No camera device available."
        case let .deviceInput(m):    return "Camera input error: \(m)"
        case let .outputSetup(m):    return "Camera output setup failed: \(m)"
        case let .writerSetup(m):    return "Webcam writer setup failed: \(m)"
        }
    }
}

/// Routes camera frames into the asset writer. We start the writer's session
/// on the FIRST frame and rebase to .zero — the same trick the screen pipeline
/// uses so the output file timeline starts at t=0.
private final class WebcamFrameDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    private let stateLock = NSLock()
    private var _sessionStart: CMTime?

    var sessionStarted: Bool {
        stateLock.lock(); defer { stateLock.unlock() }
        return _sessionStart != nil
    }

    init(writer: AVAssetWriter, input: AVAssetWriterInput) {
        self.writer = writer
        self.input = input
    }

    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        guard sampleBuffer.isValid else { return }
        guard writer.status == .writing else { return }

        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        stateLock.lock()
        if _sessionStart == nil {
            writer.startSession(atSourceTime: .zero)
            _sessionStart = pts
        }
        let base = _sessionStart ?? pts
        stateLock.unlock()

        guard input.isReadyForMoreMediaData else { return }
        guard let rebased = rebase(sampleBuffer, base: base) else { return }
        _ = input.append(rebased)
    }

    private func rebase(_ buffer: CMSampleBuffer, base: CMTime) -> CMSampleBuffer? {
        var info = CMSampleTimingInfo()
        info.presentationTimeStamp = CMTimeSubtract(
            CMSampleBufferGetPresentationTimeStamp(buffer), base
        )
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
}
