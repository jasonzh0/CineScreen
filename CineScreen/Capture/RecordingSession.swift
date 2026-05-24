import Foundation
import AppKit

enum SessionState: Equatable {
    case idle
    case starting
    case recording(startedAt: Date)
    case stopping
    case error(String)
}

struct SessionResult {
    var videoURL: URL
    var metadataURL: URL
    var frames: Int64
    var durationMs: Double
    var webcamURL: URL?
}

enum SessionError: LocalizedError {
    case missingPermissions
    case noOutputDirectory
    case alreadyRecording
    case notRecording
    case captureFailed(String)
    case writeFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingPermissions:  return "Screen Recording and Accessibility permission are required."
        case .noOutputDirectory:   return "Pick an output folder in the Recording tab first."
        case .alreadyRecording:    return "A recording is already in progress."
        case .notRecording:        return "No recording in progress."
        case let .captureFailed(m):     return "Capture failed: \(m)"
        case let .writeFailed(m):       return "Failed to write metadata: \(m)"
        }
    }
}

/// Owns the lifecycle of one recording — coordinates the screen-capture and
/// mouse-tracking services, then writes the .mov + .json bundle.
@MainActor
@Observable
final class RecordingSession {
    var state: SessionState = .idle
    var lastResult: SessionResult?

    private let capture = ScreenCaptureService()
    private let mouse = MouseTrackingService()
    private let webcam = WebcamCaptureService()
    private var startWallTime: Date?
    /// Resolved webcam destination for the active recording. nil if the user
    /// disabled webcam or no camera was available.
    private var webcamOutputURL: URL?

    // MARK: - Public API

    func start(_ request: CaptureRequest) async throws {
        // Allow retry after a prior error.
        switch state {
        case .idle, .error: break
        case .starting, .recording, .stopping:
            throw SessionError.alreadyRecording
        }
        let perm = Permissions.currentStatus()
        guard perm.allRequiredGranted else { throw SessionError.missingPermissions }

        Log.session.info("Recording session start requested")
        state = .starting
        startWallTime = Date()

        let info: CaptureInfo
        do {
            info = try await capture.start(request)
        } catch {
            Log.session.error("capture.start failed: \(error.localizedDescription)")
            state = .idle  // Reset so user can retry without restarting the app.
            throw SessionError.captureFailed(error.localizedDescription)
        }

        let regionOffset: CGPoint = request.region?.origin ?? .zero
        do {
            try mouse.start(
                displayBoundsPoints: info.displayBounds,
                pixelSize: CGSize(width: info.pixelWidth, height: info.pixelHeight),
                regionOffsetPixels: regionOffset
            )
        } catch {
            Log.session.error("mouse.start failed: \(error.localizedDescription)")
            _ = try? await capture.stop()
            state = .idle
            throw SessionError.captureFailed(error.localizedDescription)
        }

        // Start webcam in parallel. Failure here doesn't abort the recording —
        // the user still gets a working screen capture, just without the
        // webcam overlay. We surface the error via statusMessage from the
        // caller side.
        if request.captureCamera {
            let webcamURL = request.webcamURL
                ?? request.outputURL.deletingLastPathComponent()
                    .appendingPathComponent(Project.webcamFileName)
            do {
                try webcam.start(outputURL: webcamURL, deviceID: request.cameraDeviceID)
                webcamOutputURL = webcamURL
            } catch {
                Log.session.warning("Webcam start failed (continuing without it): \(error.localizedDescription)")
                webcamOutputURL = nil
            }
        } else {
            webcamOutputURL = nil
        }

        state = .recording(startedAt: startWallTime ?? Date())
        let webcamRunning = webcamOutputURL != nil
        Log.session.info("Recording session started — \(info.pixelWidth)x\(info.pixelHeight)@\(info.fps)fps webcam=\(webcamRunning)")
    }

    func stop() async throws -> SessionResult {
        guard case .recording = state else { throw SessionError.notRecording }
        state = .stopping
        Log.session.info("Stopping recording session")

        let samples = mouse.stop()
        // Stop webcam concurrently with screen capture finalisation so the
        // user's "Stop" tap isn't held up by webcam writer flushing.
        async let webcamFinishedURL: URL? = webcam.stop()
        let captureResult: CaptureResult
        do {
            captureResult = try await capture.stop()
        } catch {
            _ = await webcamFinishedURL  // let the task complete
            state = .error(error.localizedDescription)
            throw SessionError.captureFailed(error.localizedDescription)
        }
        let finalWebcamURL = await webcamFinishedURL

        let durationMs: Double = (startWallTime.map { Date().timeIntervalSince($0) * 1000.0 }) ?? 0
        let info = captureResult.info
        let videoURL = captureResult.outputURL
        let metadataURL = videoURL.deletingPathExtension().appendingPathExtension("json")

        let metadata = Self.buildMetadata(
            videoURL: videoURL,
            info: info,
            durationMs: durationMs,
            samples: samples
        )

        do {
            try metadata.write(to: metadataURL)
        } catch {
            state = .error(error.localizedDescription)
            throw SessionError.writeFailed(error.localizedDescription)
        }

        let result = SessionResult(
            videoURL: videoURL,
            metadataURL: metadataURL,
            frames: captureResult.frames,
            durationMs: durationMs,
            webcamURL: finalWebcamURL
        )
        lastResult = result
        state = .idle
        Log.session.info("Session complete — \(captureResult.frames) frames, \(durationMs, format: .fixed(precision: 0))ms")
        return result
    }

    func cancel() async {
        guard case .recording = state else { return }
        Log.session.info("Cancelling recording session")
        _ = mouse.stop()
        async let webcamCleanup: URL? = webcam.stop()
        do {
            let result = try await capture.stop()
            // Delete the partial video — cancel discards.
            try? FileManager.default.removeItem(at: result.outputURL)
        } catch {
            Log.session.warning("Capture cleanup during cancel: \(error.localizedDescription)")
        }
        if let webcamURL = await webcamCleanup {
            try? FileManager.default.removeItem(at: webcamURL)
        }
        state = .idle
    }

    // MARK: - Metadata assembly

    private static func buildMetadata(
        videoURL: URL,
        info: CaptureInfo,
        durationMs: Double,
        samples: [MouseSample]
    ) -> RecordingMetadata {
        var keyframes: [CursorKeyframe] = []
        var clicks: [ClickEvent] = []

        for sample in samples {
            // Every sample contributes a position keyframe so the cursor
            // doesn't snap at click moments.
            keyframes.append(CursorKeyframe(
                timestamp: sample.timestamp,
                x: sample.x,
                y: sample.y,
                size: nil,
                shape: sample.cursorShape,
                easing: .linear
            ))
            switch sample.kind {
            case .move: break
            case .down(let button):
                clicks.append(ClickEvent(
                    timestamp: sample.timestamp, x: sample.x, y: sample.y,
                    button: button, action: .down
                ))
            case .up(let button):
                clicks.append(ClickEvent(
                    timestamp: sample.timestamp, x: sample.x, y: sample.y,
                    button: button, action: .up
                ))
            }
        }

        // Anchor the timeline endpoints so the editor always has a leading
        // and trailing keyframe to interpolate from.
        if keyframes.first?.timestamp ?? 0 > 0, let first = keyframes.first {
            keyframes.insert(CursorKeyframe(
                timestamp: 0, x: first.x, y: first.y,
                size: nil, shape: first.shape, easing: .linear
            ), at: 0)
        }
        if durationMs > 0, let last = keyframes.last, last.timestamp < durationMs {
            keyframes.append(CursorKeyframe(
                timestamp: durationMs, x: last.x, y: last.y,
                size: nil, shape: last.shape, easing: nil
            ))
        }

        keyframes.sort { $0.timestamp < $1.timestamp }
        clicks.sort { $0.timestamp < $1.timestamp }

        let video = VideoInfo(
            path: videoURL.path,
            width: info.pixelWidth,
            height: info.pixelHeight,
            frameRate: Double(info.fps),
            duration: durationMs
        )
        // Default cursor size is generous — Screen-Studio-style cursors are
        // ~2-3× the OS cursor so they read clearly in the rendered video.
        // The user can fine-tune via the sidebar's Size slider.
        let cursor = CursorTrack(
            keyframes: keyframes,
            segments: nil,
            config: CursorConfig(size: 96, shape: .arrow, motionBlur: nil, hideWhenStatic: nil)
        )
        let zoom = ZoomTrack(
            sections: [],
            config: ZoomConfig(
                enabled: true,
                level: 2.0,
                transitionSpeed: 300,
                padding: 0,
                followSpeed: 1.0,
                smoothness: nil,
                animationStyle: .mellow,
                deadZone: 15,
                motionBlur: nil,
                physics: nil,
                autoZoom: true
            )
        )

        return RecordingMetadata(
            version: RecordingMetadata.currentVersion,
            video: video,
            cursor: cursor,
            zoom: zoom,
            clicks: clicks,
            effects: nil,
            trim: nil,
            createdAt: Date().timeIntervalSince1970 * 1000
        )
    }
}
