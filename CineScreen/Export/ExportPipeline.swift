import Foundation
import AVFoundation
import CoreVideo

/// One-shot export job. Reads the source video + audio, runs each frame
/// through `ExportCompositor`, and writes a new H.264 .mp4.
@MainActor
final class ExportPipeline {
    struct Input {
        var sourceVideoURL: URL
        var outputURL: URL
        /// Time range in milliseconds. Use `0..<0` to export the full file.
        var trimRangeMs: Range<Double>
        /// Returns the cursor state to render for the given timestamp (ms from
        /// the **start of the source file**, not the trimmed clip).
        var cursorAt: @Sendable (Double) -> CursorRenderState?
        /// Returns the click ring states active at the given timestamp.
        var clicksAt: @Sendable (Double) -> [ClickRingState] = { _ in [] }
        /// Returns the zoom transform at the given timestamp.
        var zoomAt: @Sendable (Double) -> ZoomState = { _ in .identity }
        /// Static canvas style applied to every frame.
        var canvas: CanvasStyle = .none
    }

    enum Progress {
        case starting
        case running(fraction: Double)
        case finished(URL)
        case failed(String)
    }

    private(set) var progress: Progress = .starting

    func export(_ input: Input, onProgress: @Sendable @escaping (Progress) -> Void) async throws -> URL {
        try? FileManager.default.removeItem(at: input.outputURL)

        let asset = AVURLAsset(url: input.sourceVideoURL)

        // Load track + duration metadata
        let duration = try await asset.load(.duration)
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        guard let videoTrack = videoTracks.first else {
            throw ExportError.noVideoTrack
        }
        let naturalSize = try await videoTrack.load(.naturalSize)
        let transform = try await videoTrack.load(.preferredTransform)
        let nominalFrameRate = try await videoTrack.load(.nominalFrameRate)
        let outputSize = applyTransform(transform, to: naturalSize)
        let fps = nominalFrameRate > 0 ? nominalFrameRate : 60

        // Trim
        let useFullRange = input.trimRangeMs.isEmpty
        let trimStartMs = useFullRange ? 0 : input.trimRangeMs.lowerBound
        let trimEndMs = useFullRange ? duration.seconds * 1000 : input.trimRangeMs.upperBound
        let startTime = CMTime(seconds: trimStartMs / 1000, preferredTimescale: 600)
        let endTime = CMTime(seconds: trimEndMs / 1000, preferredTimescale: 600)
        let timeRange = CMTimeRange(start: startTime, end: endTime)
        let trimmedSeconds = max(0.01, endTime.seconds - startTime.seconds)

        // Compositor
        guard let compositor = ExportCompositor() else {
            throw ExportError.compositorInitFailed
        }

        // Reader
        let reader = try AVAssetReader(asset: asset)
        reader.timeRange = timeRange

        let videoReaderOutput = AVAssetReaderTrackOutput(
            track: videoTrack,
            outputSettings: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferMetalCompatibilityKey as String: true,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:],
            ]
        )
        videoReaderOutput.alwaysCopiesSampleData = false
        guard reader.canAdd(videoReaderOutput) else {
            throw ExportError.readerSetupFailed("video output")
        }
        reader.add(videoReaderOutput)

        var audioReaderOutputs: [AVAssetReaderTrackOutput] = []
        for track in audioTracks {
            let out = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
            out.alwaysCopiesSampleData = false
            if reader.canAdd(out) {
                reader.add(out)
                audioReaderOutputs.append(out)
            }
        }

        // Writer
        let writer = try AVAssetWriter(outputURL: input.outputURL, fileType: .mp4)

        let videoBitrate = Int(Double(Int(outputSize.width) * Int(outputSize.height)) * Double(fps) * 0.10)
        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(outputSize.width),
            AVVideoHeightKey: Int(outputSize.height),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: videoBitrate,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoMaxKeyFrameIntervalKey: Int(fps),
                AVVideoExpectedSourceFrameRateKey: Int(fps),
                AVVideoAllowFrameReorderingKey: false,
            ],
        ]
        let videoWriterInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoWriterInput.expectsMediaDataInRealTime = false
        videoWriterInput.transform = transform

        let pixelBufferAttrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: Int(outputSize.width),
            kCVPixelBufferHeightKey as String: Int(outputSize.height),
            kCVPixelBufferMetalCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: videoWriterInput,
            sourcePixelBufferAttributes: pixelBufferAttrs
        )
        guard writer.canAdd(videoWriterInput) else {
            throw ExportError.writerSetupFailed("video input")
        }
        writer.add(videoWriterInput)

        var audioWriterInputs: [AVAssetWriterInput] = []
        for _ in audioTracks {
            let audioSettings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVNumberOfChannelsKey: 2,
                AVSampleRateKey: 48000,
                AVEncoderBitRateKey: 128_000,
            ]
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
            input.expectsMediaDataInRealTime = false
            if writer.canAdd(input) {
                writer.add(input)
                audioWriterInputs.append(input)
            }
        }

        guard writer.startWriting() else {
            throw ExportError.writerStartFailed(writer.error?.localizedDescription ?? "unknown")
        }
        writer.startSession(atSourceTime: startTime)

        guard reader.startReading() else {
            throw ExportError.readerStartFailed(reader.error?.localizedDescription ?? "unknown")
        }

        onProgress(.running(fraction: 0))

        // Video loop
        try await runVideoLoop(
            reader: reader,
            readerOutput: videoReaderOutput,
            writerInput: videoWriterInput,
            adaptor: adaptor,
            compositor: compositor,
            cursorAt: input.cursorAt,
            clicksAt: input.clicksAt,
            zoomAt: input.zoomAt,
            canvasStyle: input.canvas,
            timeRangeStart: startTime,
            trimmedSeconds: trimmedSeconds,
            onProgress: onProgress
        )

        // Audio loops — each in series for simplicity
        for (out, input) in zip(audioReaderOutputs, audioWriterInputs) {
            try await runAudioLoop(writerInput: input, readerOutput: out)
        }

        await writer.finishWriting()

        if writer.status == .completed {
            onProgress(.finished(input.outputURL))
            return input.outputURL
        } else {
            let msg = writer.error?.localizedDescription ?? "status=\(writer.status.rawValue)"
            onProgress(.failed(msg))
            throw ExportError.writeFailed(msg)
        }
    }

    // MARK: - Loops

    private func runVideoLoop(
        reader: AVAssetReader,
        readerOutput: AVAssetReaderTrackOutput,
        writerInput: AVAssetWriterInput,
        adaptor: AVAssetWriterInputPixelBufferAdaptor,
        compositor: ExportCompositor,
        cursorAt: @escaping @Sendable (Double) -> CursorRenderState?,
        clicksAt: @escaping @Sendable (Double) -> [ClickRingState],
        zoomAt: @escaping @Sendable (Double) -> ZoomState,
        canvasStyle: CanvasStyle,
        timeRangeStart: CMTime,
        trimmedSeconds: Double,
        onProgress: @Sendable @escaping (Progress) -> Void
    ) async throws {
        let processingQueue = DispatchQueue(label: "com.cinescreen.export.video", qos: .userInitiated)

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            writerInput.requestMediaDataWhenReady(on: processingQueue) {
                while writerInput.isReadyForMoreMediaData {
                    guard reader.status == .reading,
                          let sample = readerOutput.copyNextSampleBuffer() else {
                        writerInput.markAsFinished()
                        if reader.status == .failed {
                            continuation.resume(throwing: ExportError.readError(
                                reader.error?.localizedDescription ?? "unknown"
                            ))
                        } else {
                            continuation.resume(returning: ())
                        }
                        return
                    }
                    guard let sourceBuffer = CMSampleBufferGetImageBuffer(sample) else {
                        continue
                    }
                    let pts = CMSampleBufferGetPresentationTimeStamp(sample)
                    let cursorTimeMs = pts.seconds * 1000
                    let cursorState = cursorAt(cursorTimeMs)
                    let clickStates = clicksAt(cursorTimeMs)
                    let zoom = zoomAt(cursorTimeMs)

                    guard let pool = adaptor.pixelBufferPool else {
                        continuation.resume(throwing: ExportError.pixelBufferPoolMissing)
                        return
                    }
                    var destBuffer: CVPixelBuffer?
                    let allocStatus = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &destBuffer)
                    guard allocStatus == kCVReturnSuccess, let dest = destBuffer else {
                        continuation.resume(throwing: ExportError.pixelBufferAllocFailed)
                        return
                    }

                    let ok = compositor.render(
                        source: sourceBuffer,
                        cursor: cursorState,
                        clicks: clickStates,
                        zoom: zoom,
                        canvas: canvasStyle,
                        destination: dest
                    )
                    if !ok {
                        continuation.resume(throwing: ExportError.compositeFailed)
                        return
                    }
                    if !adaptor.append(dest, withPresentationTime: pts) {
                        continuation.resume(throwing: ExportError.appendFailed(
                            reader.error?.localizedDescription ?? "video append failed"
                        ))
                        return
                    }

                    let elapsed = (pts.seconds - timeRangeStart.seconds)
                    let fraction = min(1.0, max(0.0, elapsed / trimmedSeconds))
                    onProgress(.running(fraction: fraction))
                }
            }
        }
    }

    private func runAudioLoop(
        writerInput: AVAssetWriterInput,
        readerOutput: AVAssetReaderTrackOutput
    ) async throws {
        let queue = DispatchQueue(label: "com.cinescreen.export.audio", qos: .userInitiated)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            writerInput.requestMediaDataWhenReady(on: queue) {
                while writerInput.isReadyForMoreMediaData {
                    guard let sample = readerOutput.copyNextSampleBuffer() else {
                        writerInput.markAsFinished()
                        continuation.resume(returning: ())
                        return
                    }
                    if !writerInput.append(sample) {
                        continuation.resume(throwing: ExportError.appendFailed("audio append failed"))
                        return
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    /// Apply a track's preferredTransform to its naturalSize so the output
    /// dimensions match what the user expects (e.g. portrait recordings).
    private func applyTransform(_ transform: CGAffineTransform, to size: CGSize) -> CGSize {
        let rect = CGRect(origin: .zero, size: size).applying(transform)
        return CGSize(width: abs(rect.width), height: abs(rect.height))
    }
}

enum ExportError: LocalizedError {
    case noVideoTrack
    case compositorInitFailed
    case readerSetupFailed(String)
    case writerSetupFailed(String)
    case readerStartFailed(String)
    case writerStartFailed(String)
    case pixelBufferPoolMissing
    case pixelBufferAllocFailed
    case compositeFailed
    case appendFailed(String)
    case readError(String)
    case writeFailed(String)

    var errorDescription: String? {
        switch self {
        case .noVideoTrack:                  return "Source has no video track."
        case .compositorInitFailed:          return "Could not initialize the Metal compositor."
        case let .readerSetupFailed(m):      return "Reader setup failed: \(m)"
        case let .writerSetupFailed(m):      return "Writer setup failed: \(m)"
        case let .readerStartFailed(m):      return "Reader start failed: \(m)"
        case let .writerStartFailed(m):      return "Writer start failed: \(m)"
        case .pixelBufferPoolMissing:        return "Writer did not provide a pixel buffer pool."
        case .pixelBufferAllocFailed:        return "Could not allocate an output pixel buffer."
        case .compositeFailed:               return "GPU compositing failed."
        case let .appendFailed(m):           return "Sample append failed: \(m)"
        case let .readError(m):              return "Read failed: \(m)"
        case let .writeFailed(m):            return "Write failed: \(m)"
        }
    }
}
