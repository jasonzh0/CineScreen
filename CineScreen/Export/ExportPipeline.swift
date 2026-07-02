import Foundation
import AVFoundation
import CoreVideo
import CoreImage
import UniformTypeIdentifiers

/// Shared stop flags for one export run. The video/audio loops (each on its
/// own DispatchQueue) consult it at every ready-callback; `cancel()` and the
/// first recorded failure set it. Lock-protected — touched from arbitrary
/// queues plus the main actor.
private final class ExportSessionState: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    private var failure: Error?

    func cancel() {
        lock.lock(); defer { lock.unlock() }
        cancelled = true
    }

    /// Records the first failure; later ones are dropped (the first is the
    /// root cause — everything after it is teardown noise).
    func fail(_ error: Error) {
        lock.lock(); defer { lock.unlock() }
        if failure == nil { failure = error }
    }

    var shouldStop: Bool {
        lock.lock(); defer { lock.unlock() }
        return cancelled || failure != nil
    }

    var isCancelled: Bool {
        lock.lock(); defer { lock.unlock() }
        return cancelled
    }
}

/// One-shot export job. Reads the source video + audio, runs each frame
/// through `ExportCompositor`, and writes a new H.264 .mp4.
///
/// Failure/cancel safety: the writer targets a hidden temp file next to the
/// destination and is promoted with an atomic replace only on success — a
/// failed or cancelled export never destroys an existing file at the
/// destination and never leaves a half-written .mp4 behind.
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
        /// Camera warm-up offset (screenT = webcamT + offsetMs) — shifts the
        /// webcam read window so the overlay is time-aligned with the screen.
        var webcamOffsetMs: Double = 0
        /// Output size as a fraction of the source (1.0 = native). Overlays
        /// are positioned in normalized space, so they scale with the frame.
        var outputScale: Double = 1.0
        /// H.264 bits-per-pixel budget (bitrate = w*h*fps*bpp). MP4 only.
        var bitsPerPixel: Double = 0.10
        /// Container. GIF renders the same composited frames but caps at
        /// 15fps / 960px longest side (GIF sizes grow brutally), drops
        /// audio, and ignores the scale/quality knobs.
        var format: Format = .mp4
    }

    enum Format: String {
        case mp4, gif
    }

    enum Progress {
        case running(fraction: Double)
        case finished(URL)
    }

    private let session = ExportSessionState()

    /// Stops the export at the next frame boundary. The run tears down its
    /// reader/writer, deletes the temp file, and `export` throws
    /// `ExportError.cancelled`.
    func cancel() { session.cancel() }

    func export(_ input: Input, onProgress: @Sendable @escaping (Progress) -> Void) async throws -> URL {
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

        // GIF branches off here: same decode + compositor, its own encoder.
        if input.format == .gif {
            return try await exportGIF(
                input: input,
                reader: reader,
                readerOutput: videoReaderOutput,
                compositor: compositor,
                sourceSize: outputSize,
                timeRange: timeRange,
                nominalFPS: Double(fps),
                trimmedSeconds: trimmedSeconds,
                onProgress: onProgress
            )
        }

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

        // Writer — targets a hidden sibling temp file, promoted on success.
        // Writing straight to `outputURL` destroyed any existing file the
        // moment the export started and left broken partials on failure.
        let tempURL = input.outputURL
            .deletingLastPathComponent()
            .appendingPathComponent(".cinescreen-export-\(UUID().uuidString).mp4")
        let writer = try AVAssetWriter(outputURL: tempURL, fileType: .mp4)

        // Scaled output dimensions (even, for the encoder). The compositor
        // renders into the destination buffer, so downscaling happens on the
        // GPU as part of the normal video-quad sampling.
        let scale = min(1.0, max(0.1, input.outputScale))
        let scaledW = max(2, (Int(outputSize.width * scale) / 2) * 2)
        let scaledH = max(2, (Int(outputSize.height * scale) / 2) * 2)

        let videoBitrate = Int(Double(scaledW * scaledH) * Double(fps) * input.bitsPerPixel)
        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: scaledW,
            AVVideoHeightKey: scaledH,
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
            kCVPixelBufferWidthKey as String: scaledW,
            kCVPixelBufferHeightKey as String: scaledH,
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

        // From here on a file exists at `tempURL` — every failure path below
        // must run `tearDown()` so no partial file or live writer survives.
        func tearDown() {
            if reader.status == .reading { reader.cancelReading() }
            if writer.status == .writing { writer.cancelWriting() }
            try? FileManager.default.removeItem(at: tempURL)
        }

        guard reader.startReading() else {
            let error = ExportError.readerStartFailed(reader.error?.localizedDescription ?? "unknown")
            tearDown()
            throw error
        }

        onProgress(.running(fraction: 0))

        // Optional webcam source — uses the same trim range so the overlay
        // stays in sync after trimming the head off the screen recording.
        let webcamSource: WebcamFrameSource?
        do {
            webcamSource = try await WebcamFrameSource.open(
                url: input.webcamURL,
                timeRange: timeRange,
                offsetMs: input.webcamOffsetMs
            )
        } catch {
            tearDown()
            throw error
        }

        let session = self.session
        do {
            // Run video AND audio loops concurrently. AVAssetWriter does
            // cross-input synchronization: when you add multiple writer inputs,
            // it expects you to append interleaved samples. If we ran video
            // alone first, the writer would back off video input (isReady=false
            // forever) waiting for audio that doesn't arrive until later —
            // exactly the symptom we saw: writer stays in .writing state, video
            // closure never re-invoked.
            //
            // Loop failure protocol: a failing loop records its error in
            // `session` and marks its own input finished — that unblocks the
            // writer's interleaving wait so the *other* loops' callbacks fire,
            // see `shouldStop`, and exit cleanly instead of hanging forever.
            try await withTaskCancellationHandler {
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
                            try await runAudioLoop(reader: reader, writerInput: audioInput, readerOutput: out)
                        }
                    }
                    try await group.waitForAll()
                }
            } onCancel: {
                session.cancel()
            }

            if session.isCancelled { throw ExportError.cancelled }

            await writer.finishWriting()
            guard writer.status == .completed else {
                throw ExportError.writeFailed(writer.error?.localizedDescription ?? "status=\(writer.status.rawValue)")
            }

            let output = try promote(tempURL, to: input.outputURL)
            onProgress(.finished(output))
            return output
        } catch {
            tearDown()
            throw error
        }
    }

    // MARK: - GIF

    /// Renders the trimmed, composited frames into an animated GIF via
    /// CGImageDestination. Runs the pull-decode-render-encode loop off the
    /// main actor; supports cancel; writes to a hidden temp file promoted on
    /// success like the MP4 path.
    private func exportGIF(
        input: Input,
        reader: AVAssetReader,
        readerOutput: AVAssetReaderTrackOutput,
        compositor: ExportCompositor,
        sourceSize: CGSize,
        timeRange: CMTimeRange,
        nominalFPS: Double,
        trimmedSeconds: Double,
        onProgress: @Sendable @escaping (Progress) -> Void
    ) async throws -> URL {
        let session = self.session
        let gifFPS = min(15.0, max(1.0, nominalFPS))
        let longest = Double(max(sourceSize.width, sourceSize.height))
        let scale = min(1.0, 960.0 / max(1.0, longest))
        let width = max(2, (Int(sourceSize.width * scale) / 2) * 2)
        let height = max(2, (Int(sourceSize.height * scale) / 2) * 2)
        let frameCount = max(1, Int(trimmedSeconds * gifFPS))
        let frameDelay = 1.0 / gifFPS

        let tempURL = input.outputURL
            .deletingLastPathComponent()
            .appendingPathComponent(".cinescreen-export-\(UUID().uuidString).gif")
        guard let destination = CGImageDestinationCreateWithURL(
            tempURL as CFURL, UTType.gif.identifier as CFString, frameCount, nil
        ) else {
            throw ExportError.writerSetupFailed("GIF destination")
        }
        CGImageDestinationSetProperties(destination, [
            kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]
        ] as CFDictionary)

        var poolOut: CVPixelBufferPool?
        let poolAttrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferMetalCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, poolAttrs as CFDictionary, &poolOut)
        guard let pool = poolOut else { throw ExportError.pixelBufferPoolMissing }

        guard reader.startReading() else {
            throw ExportError.readerStartFailed(reader.error?.localizedDescription ?? "unknown")
        }
        onProgress(.running(fraction: 0))

        let webcamSource = try await WebcamFrameSource.open(
            url: input.webcamURL,
            timeRange: timeRange,
            offsetMs: input.webcamOffsetMs
        )

        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                func tearDown() {
                    if reader.status == .reading { reader.cancelReading() }
                    try? FileManager.default.removeItem(at: tempURL)
                }
                do {
                    let ciContext = CIContext()
                    var nextOutputPTS = timeRange.start
                    let outputDelta = CMTime(seconds: frameDelay, preferredTimescale: 600)
                    var currentSourceBuffer: CVPixelBuffer?
                    var peekedSourceBuffer: CVPixelBuffer?
                    var peekedSourcePTS: CMTime = .negativeInfinity
                    var sourceExhausted = false
                    var written = 0

                    while CMTimeCompare(nextOutputPTS, timeRange.end) < 0, written < frameCount {
                        if session.shouldStop { throw ExportError.cancelled }

                        // Same peek-and-promote stepping as the MP4 loop.
                        while !sourceExhausted {
                            if let peek = peekedSourceBuffer,
                               CMTimeCompare(peekedSourcePTS, nextOutputPTS) <= 0 {
                                currentSourceBuffer = peek
                                peekedSourceBuffer = nil
                            }
                            if peekedSourceBuffer != nil { break }
                            guard reader.status == .reading,
                                  let sample = readerOutput.copyNextSampleBuffer(),
                                  let buf = CMSampleBufferGetImageBuffer(sample) else {
                                if reader.status == .failed {
                                    throw ExportError.readError(
                                        reader.error?.localizedDescription ?? "video decode failed mid-export"
                                    )
                                }
                                sourceExhausted = true
                                break
                            }
                            let pts = CMSampleBufferGetPresentationTimeStamp(sample)
                            if CMTimeCompare(pts, nextOutputPTS) <= 0 {
                                currentSourceBuffer = buf
                            } else {
                                peekedSourceBuffer = buf
                                peekedSourcePTS = pts
                                if currentSourceBuffer == nil { currentSourceBuffer = buf }
                            }
                        }
                        guard let sourceBuffer = currentSourceBuffer else { break }

                        var destBuffer: CVPixelBuffer?
                        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &destBuffer) == kCVReturnSuccess,
                              let dest = destBuffer else {
                            throw ExportError.pixelBufferAllocFailed
                        }

                        let outputTimeMs = nextOutputPTS.seconds * 1000
                        let webcamFrame = input.webcamLayout.enabled ? webcamSource?.frame(at: nextOutputPTS) : nil
                        guard compositor.render(
                            source: sourceBuffer,
                            cursor: input.cursorAt(outputTimeMs),
                            clicks: input.clicksAt(outputTimeMs),
                            zoom: input.zoomAt(outputTimeMs),
                            canvas: input.canvas,
                            webcam: webcamFrame,
                            webcamLayout: input.webcamLayout,
                            destination: dest
                        ) else {
                            throw ExportError.compositeFailed
                        }

                        guard let cg = ciContext.createCGImage(
                            CIImage(cvPixelBuffer: dest),
                            from: CGRect(x: 0, y: 0, width: width, height: height)
                        ) else {
                            throw ExportError.compositeFailed
                        }
                        CGImageDestinationAddImage(destination, cg, [
                            kCGImagePropertyGIFDictionary: [
                                kCGImagePropertyGIFDelayTime: frameDelay,
                                kCGImagePropertyGIFUnclampedDelayTime: frameDelay,
                            ]
                        ] as CFDictionary)

                        written += 1
                        let elapsed = nextOutputPTS.seconds - timeRange.start.seconds
                        onProgress(.running(fraction: min(1.0, max(0.0, elapsed / trimmedSeconds))))
                        nextOutputPTS = CMTimeAdd(nextOutputPTS, outputDelta)
                    }

                    if session.shouldStop { throw ExportError.cancelled }
                    guard CGImageDestinationFinalize(destination) else {
                        throw ExportError.writeFailed("GIF finalize failed")
                    }
                    if reader.status == .reading { reader.cancelReading() }

                    let fm = FileManager.default
                    if fm.fileExists(atPath: input.outputURL.path) {
                        _ = try fm.replaceItemAt(input.outputURL, withItemAt: tempURL)
                    } else {
                        try fm.moveItem(at: tempURL, to: input.outputURL)
                    }
                    onProgress(.finished(input.outputURL))
                    continuation.resume(returning: input.outputURL)
                } catch {
                    tearDown()
                    continuation.resume(throwing: error)
                }
            }
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
        let session = self.session

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
        var peekedSourceBuffer: CVPixelBuffer? = nil
        var peekedSourcePTS: CMTime = .negativeInfinity
        var sourceExhausted = false

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            // AVFoundation re-invokes the ready-callback after failures (a
            // failed writer forces isReadyForMoreMediaData true so clients can
            // discover the error) — resuming the continuation twice traps.
            // `finish` is resume-once (the serial queue makes the plain flag
            // race-free), marks the input finished so the writer stops
            // requesting media, and records failures in `session` so the
            // sibling audio loops exit instead of hanging on the writer's
            // interleaving wait.
            var finished = false
            func finish(_ result: Result<Void, Error>) {
                guard !finished else { return }
                finished = true
                writerInput.markAsFinished()
                if case let .failure(error) = result { session.fail(error) }
                continuation.resume(with: result)
            }

            writerInput.requestMediaDataWhenReady(on: processingQueue) {
                guard !finished else { return }
                while writerInput.isReadyForMoreMediaData {
                    // Another loop failed, or the user cancelled — exit
                    // quietly; export() decides what to throw.
                    if session.shouldStop {
                        finish(.success(()))
                        return
                    }

                    // Stop once we've emitted every output frame in the
                    // trim range.
                    if CMTimeCompare(nextOutputPTS, timeRangeEnd) >= 0 {
                        Log.app.info("Export: video loop finished at frame \(frameCounter.count), reached end of trim range")
                        finish(.success(()))
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
                            peekedSourceBuffer = nil
                        }
                        if peekedSourceBuffer != nil { break }
                        guard reader.status == .reading,
                              let sample = readerOutput.copyNextSampleBuffer(),
                              let buf = CMSampleBufferGetImageBuffer(sample) else {
                            // Distinguish end-of-media from a decoder failure.
                            // Treating .failed as EOF used to freeze-frame the
                            // remaining frames and report success.
                            if reader.status == .failed {
                                finish(.failure(ExportError.readError(
                                    reader.error?.localizedDescription ?? "video decode failed mid-export"
                                )))
                                return
                            }
                            sourceExhausted = true
                            break
                        }
                        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
                        if CMTimeCompare(pts, nextOutputPTS) <= 0 {
                            currentSourceBuffer = buf
                        } else {
                            peekedSourceBuffer = buf
                            peekedSourcePTS = pts
                            if currentSourceBuffer == nil {
                                currentSourceBuffer = buf
                            }
                        }
                    }

                    guard let sourceBuffer = currentSourceBuffer else {
                        // Source exhausted before producing any frame —
                        // unusual; finalize cleanly.
                        Log.app.warning("Export: source had no frames before output range; finishing")
                        finish(.success(()))
                        return
                    }

                    let outputTimeMs = nextOutputPTS.seconds * 1000
                    let cursorState = cursorAt(outputTimeMs)
                    let clickStates = clicksAt(outputTimeMs)
                    let zoom = zoomAt(outputTimeMs)

                    guard let pool = adaptor.pixelBufferPool else {
                        finish(.failure(ExportError.pixelBufferPoolMissing))
                        return
                    }
                    var destBuffer: CVPixelBuffer?
                    let allocStatus = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &destBuffer)
                    guard allocStatus == kCVReturnSuccess, let dest = destBuffer else {
                        finish(.failure(ExportError.pixelBufferAllocFailed))
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
                        finish(.failure(ExportError.compositeFailed))
                        return
                    }
                    if !adaptor.append(dest, withPresentationTime: nextOutputPTS) {
                        Log.app.error("Export: adaptor.append failed at frame \(frameCounter.count), pts=\(nextOutputPTS.seconds)s, writer.status=\(writer.status.rawValue), writer.error=\(writer.error?.localizedDescription ?? "nil")")
                        finish(.failure(ExportError.appendFailed(
                            writer.error?.localizedDescription ?? "video append failed"
                        )))
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
        reader: AVAssetReader,
        writerInput: AVAssetWriterInput,
        readerOutput: AVAssetReaderTrackOutput
    ) async throws {
        let queue = DispatchQueue(label: "com.cinescreen.export.audio", qos: .userInitiated)
        let session = self.session
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            // Same resume-once + shared-stop protocol as the video loop.
            var finished = false
            func finish(_ result: Result<Void, Error>) {
                guard !finished else { return }
                finished = true
                writerInput.markAsFinished()
                if case let .failure(error) = result { session.fail(error) }
                continuation.resume(with: result)
            }

            writerInput.requestMediaDataWhenReady(on: queue) {
                guard !finished else { return }
                while writerInput.isReadyForMoreMediaData {
                    if session.shouldStop {
                        finish(.success(()))
                        return
                    }
                    guard let sample = readerOutput.copyNextSampleBuffer() else {
                        // Distinguish end-of-media from a decoder failure so a
                        // mid-stream failure doesn't silently truncate audio.
                        if reader.status == .failed {
                            finish(.failure(ExportError.readError(
                                reader.error?.localizedDescription ?? "audio decode failed mid-export"
                            )))
                        } else {
                            finish(.success(()))
                        }
                        return
                    }
                    if !writerInput.append(sample) {
                        finish(.failure(ExportError.appendFailed("audio append failed")))
                        return
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    /// Move the finished temp file into place. Uses an atomic replace when the
    /// destination already exists (the user consented to overwriting it via
    /// the save panel).
    private func promote(_ tempURL: URL, to destination: URL) throws -> URL {
        let fm = FileManager.default
        if fm.fileExists(atPath: destination.path) {
            _ = try fm.replaceItemAt(destination, withItemAt: tempURL)
        } else {
            try fm.moveItem(at: tempURL, to: destination)
        }
        return destination
    }

    /// Apply a track's preferredTransform to its naturalSize so the output
    /// dimensions match what the user expects (e.g. portrait recordings).
    private func applyTransform(_ transform: CGAffineTransform, to size: CGSize) -> CGSize {
        let rect = CGRect(origin: .zero, size: size).applying(transform)
        return CGSize(width: abs(rect.width), height: abs(rect.height))
    }
}

/// Frame counter for diagnostic logging. Only ever touched on the export's
/// serial video queue, so a plain Int needs no synchronization.
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
    case cancelled

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
        case .cancelled:                     return "Export cancelled."
        }
    }
}
