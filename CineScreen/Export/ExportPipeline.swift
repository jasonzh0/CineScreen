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
        /// Optional sibling webcam track. When present, frames from this file
        /// are composited as a circular overlay in the bottom-right corner.
        var webcamURL: URL? = nil
        /// Position/size/visibility of the webcam circle. Ignored when
        /// `webcamURL` is nil.
        var webcamLayout: WebcamLayout = .default
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
        // Must copy: we bind the source CVPixelBuffer into a CVMetalTexture
        // via the texture cache, which can keep a reference alive past the
        // function scope. With `false`, those bindings pin the decoder's
        // internal pool buffers — over ~100 frames the pool exhausts and
        // copyNextSampleBuffer blocks waiting for a free slot, presenting
        // as a "stuck" export at ~2s.
        videoReaderOutput.alwaysCopiesSampleData = true
        guard reader.canAdd(videoReaderOutput) else {
            throw ExportError.readerSetupFailed("video output")
        }
        reader.add(videoReaderOutput)

        var audioReaderOutputs: [AVAssetReaderTrackOutput] = []
        for track in audioTracks {
            // Decode the audio to uncompressed 16-bit interleaved PCM. The
            // writer below re-encodes to AAC. We tried passthrough
            // (outputSettings: nil on both sides) — it avoids the
            // decode/encode round trip but produces audio-less MP4 files
            // because the writer can't reliably establish the format
            // without a sourceFormatHint.
            let pcmSettings: [String: Any] = [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsNonInterleaved: false,
                AVSampleRateKey: 48000,
                AVNumberOfChannelsKey: 2,
            ]
            let out = AVAssetReaderTrackOutput(track: track, outputSettings: pcmSettings)
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
            // Re-encode the PCM coming out of the reader to AAC for the
            // output container. Matches the recorder's own AAC settings.
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

        // Optional webcam source — uses the same trim range so the overlay
        // stays in sync after trimming the head off the screen recording.
        let webcamSource = try await WebcamFrameSource.open(
            url: input.webcamURL,
            timeRange: timeRange
        )

        // Run video AND audio loops concurrently. AVAssetWriter does
        // cross-input synchronization: when you add multiple writer inputs,
        // it expects you to append interleaved samples. If we ran video
        // alone first, the writer would back off video input (isReady=false
        // forever) waiting for audio that doesn't arrive until later —
        // exactly the symptom we saw: writer stays in .writing state, video
        // closure never re-invoked.
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { [self] in
                try await runVideoLoop(
                    reader: reader,
                    readerOutput: videoReaderOutput,
                    writer: writer,
                    writerInput: videoWriterInput,
                    adaptor: adaptor,
                    compositor: compositor,
                    cursorAt: input.cursorAt,
                    clicksAt: input.clicksAt,
                    zoomAt: input.zoomAt,
                    canvasStyle: input.canvas,
                    webcamSource: webcamSource,
                    webcamLayout: input.webcamLayout,
                    timeRangeStart: startTime,
                    timeRangeEnd: endTime,
                    outputFPS: Int(fps),
                    trimmedSeconds: trimmedSeconds,
                    onProgress: onProgress
                )
            }
            for (out, audioInput) in zip(audioReaderOutputs, audioWriterInputs) {
                group.addTask { [self] in
                    try await runAudioLoop(writerInput: audioInput, readerOutput: out)
                }
            }
            try await group.waitForAll()
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
        writer: AVAssetWriter,
        writerInput: AVAssetWriterInput,
        adaptor: AVAssetWriterInputPixelBufferAdaptor,
        compositor: ExportCompositor,
        cursorAt: @escaping @Sendable (Double) -> CursorRenderState?,
        clicksAt: @escaping @Sendable (Double) -> [ClickRingState],
        zoomAt: @escaping @Sendable (Double) -> ZoomState,
        canvasStyle: CanvasStyle,
        webcamSource: WebcamFrameSource?,
        webcamLayout: WebcamLayout,
        timeRangeStart: CMTime,
        timeRangeEnd: CMTime,
        outputFPS: Int,
        trimmedSeconds: Double,
        onProgress: @Sendable @escaping (Progress) -> Void
    ) async throws {
        let processingQueue = DispatchQueue(label: "com.cinescreen.export.video", qos: .userInitiated)

        let frameCounter = FrameCounter()
        // Output emits at a uniform cadence — the source recording's actual
        // PTS values are irregular (captured at 60fps target but achieved
        // ~50fps with variable gaps). Inheriting those gaps caused choppy
        // playback AND made cursor/zoom animations look jagged because
        // they were sampled at irregular intervals. Re-time both video and
        // overlay states to a uniform `outputFPS` cadence.
        let outputDelta = CMTime(value: 1, timescale: CMTimeScale(outputFPS))
        // Per-source-frame cache: we advance the source reader to keep the
        // "latest source frame with PTS ≤ nextOutputPTS" in `currentSource`.
        // Where source is sparser than output, we reuse the cached frame.
        var nextOutputPTS = timeRangeStart
        var currentSourceBuffer: CVPixelBuffer? = nil
        var currentSourcePTS: CMTime = .negativeInfinity
        var peekedSourceBuffer: CVPixelBuffer? = nil
        var peekedSourcePTS: CMTime = .negativeInfinity
        var sourceExhausted = false

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            writerInput.requestMediaDataWhenReady(on: processingQueue) {
                while writerInput.isReadyForMoreMediaData {
                    // Stop once we've emitted every output frame in the
                    // trim range.
                    if CMTimeCompare(nextOutputPTS, timeRangeEnd) >= 0 {
                        writerInput.markAsFinished()
                        Log.app.info("Export: video loop finished at frame \(frameCounter.count), reached end of trim range")
                        continuation.resume(returning: ())
                        return
                    }

                    // Advance the source reader until the cached frame is
                    // the latest one whose PTS ≤ nextOutputPTS. Uses the
                    // same peek-and-promote pattern as WebcamFrameSource:
                    // a frame whose PTS overshoots the target is stashed
                    // in `peeked*` so it gets promoted on a later iteration
                    // instead of being discarded.
                    while !sourceExhausted {
                        if let peek = peekedSourceBuffer,
                           CMTimeCompare(peekedSourcePTS, nextOutputPTS) <= 0 {
                            currentSourceBuffer = peek
                            currentSourcePTS = peekedSourcePTS
                            peekedSourceBuffer = nil
                        }
                        if peekedSourceBuffer != nil { break }
                        guard reader.status == .reading,
                              let sample = readerOutput.copyNextSampleBuffer(),
                              let buf = CMSampleBufferGetImageBuffer(sample) else {
                            sourceExhausted = true
                            break
                        }
                        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
                        if CMTimeCompare(pts, nextOutputPTS) <= 0 {
                            currentSourceBuffer = buf
                            currentSourcePTS = pts
                        } else {
                            peekedSourceBuffer = buf
                            peekedSourcePTS = pts
                            if currentSourceBuffer == nil {
                                currentSourceBuffer = buf
                                currentSourcePTS = pts
                            }
                        }
                    }

                    guard let sourceBuffer = currentSourceBuffer else {
                        // Source exhausted before producing any frame —
                        // unusual; finalize cleanly.
                        writerInput.markAsFinished()
                        Log.app.warning("Export: source had no frames before output range; finishing")
                        continuation.resume(returning: ())
                        return
                    }

                    let outputTimeMs = nextOutputPTS.seconds * 1000
                    let cursorState = cursorAt(outputTimeMs)
                    let clickStates = clicksAt(outputTimeMs)
                    let zoom = zoomAt(outputTimeMs)

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

                    let webcamFrame = webcamLayout.enabled ? webcamSource?.frame(at: nextOutputPTS) : nil
                    let ok = compositor.render(
                        source: sourceBuffer,
                        cursor: cursorState,
                        clicks: clickStates,
                        zoom: zoom,
                        canvas: canvasStyle,
                        webcam: webcamFrame,
                        webcamLayout: webcamLayout,
                        destination: dest
                    )
                    if !ok {
                        Log.app.error("Export: compositor.render returned false at frame \(frameCounter.count), output pts=\(nextOutputPTS.seconds)s")
                        continuation.resume(throwing: ExportError.compositeFailed)
                        return
                    }
                    if !adaptor.append(dest, withPresentationTime: nextOutputPTS) {
                        Log.app.error("Export: adaptor.append failed at frame \(frameCounter.count), pts=\(nextOutputPTS.seconds)s, writer.status=\(writer.status.rawValue), writer.error=\(writer.error?.localizedDescription ?? "nil")")
                        continuation.resume(throwing: ExportError.appendFailed(
                            reader.error?.localizedDescription ?? "video append failed"
                        ))
                        return
                    }

                    let n = frameCounter.increment()
                    if n % 60 == 0 {
                        Log.app.info("Export: frame \(n) at \(nextOutputPTS.seconds, format: .fixed(precision: 2))s")
                    }
                    let elapsed = (nextOutputPTS.seconds - timeRangeStart.seconds)
                    let fraction = min(1.0, max(0.0, elapsed / trimmedSeconds))
                    onProgress(.running(fraction: fraction))

                    nextOutputPTS = CMTimeAdd(nextOutputPTS, outputDelta)
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

/// Simple atomic counter for diagnostic logging across the export's
/// processing queue. Not thread-safe — the export's video loop is
/// single-threaded so a plain Int is fine here.
private final class FrameCounter: @unchecked Sendable {
    private(set) var count: Int = 0
    func increment() -> Int {
        count += 1
        return count
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
