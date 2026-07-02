import Foundation
import AVFoundation
import CoreMedia

/// Pulls webcam frames in lockstep with the export loop. The screen pipeline
/// drives the cadence — for each requested PTS, we advance through the
/// webcam track until the most-recently-decoded frame is the latest one with
/// `pts ≤ requestedPTS`, then return it.
///
/// Webcam recordings are typically 30fps while the screen recording is 60fps,
/// so a given webcam frame gets reused for two consecutive screen frames.
final class WebcamFrameSource: @unchecked Sendable {
    private let reader: AVAssetReader
    private let output: AVAssetReaderTrackOutput
    /// The most recent frame whose PTS is ≤ the last `targetPTS` we were
    /// asked about. `nil` until the first qualifying frame arrives.
    private var currentFrame: CVPixelBuffer?
    private var currentPTS: CMTime = .negativeInfinity
    /// One-frame lookahead. When a sample arrives whose PTS is past the
    /// target, we cache it here so the next call (with a later target) can
    /// promote it instead of having to re-read from the reader. Without
    /// this lookahead we'd discard the future frame, then read the *next*
    /// one (also future), discard it, etc — the bug that made the exported
    /// webcam freeze on its first frame.
    private var peekedFrame: CVPixelBuffer?
    private var peekedPTS: CMTime = .negativeInfinity
    /// Set true once the reader is drained — further calls just return the
    /// last decoded frame (which keeps the overlay on screen during the
    /// trailing tail of a trim, etc.).
    private var exhausted = false

    /// Returns nil if `url` is nil or the file can't be opened. In either
    /// case the export proceeds without an overlay, which is the safer
    /// behaviour than failing the whole render.
    ///
    /// `offsetMs` is the camera warm-up offset (screenT = webcamT + offset):
    /// the read window is shifted into webcam time, and `frame(at:)` applies
    /// the same mapping per query, so the overlay is time-aligned with the
    /// screen instead of running early by the warm-up delay.
    static func open(url: URL?, timeRange: CMTimeRange, offsetMs: Double = 0) async throws -> WebcamFrameSource? {
        guard let url = url else { return nil }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }

        let asset = AVURLAsset(url: url)
        guard let track = try await asset.loadTracks(withMediaType: .video).first else {
            return nil
        }
        let reader: AVAssetReader
        do {
            reader = try AVAssetReader(asset: asset)
        } catch {
            return nil
        }
        let offset = CMTime(seconds: offsetMs / 1000, preferredTimescale: 600)
        let start = CMTimeMaximum(.zero, CMTimeSubtract(timeRange.start, offset))
        let end = CMTimeMaximum(start, CMTimeSubtract(timeRange.end, offset))
        reader.timeRange = CMTimeRange(start: start, end: end)

        let output = AVAssetReaderTrackOutput(
            track: track,
            outputSettings: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferMetalCompatibilityKey as String: true,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:],
            ]
        )
        // CRITICAL: must copy. We cache a webcam buffer across multiple
        // screen frames (webcam is ~30fps, screen is 60fps), so a buffer is
        // typically held for 2+ ticks. With `false` we'd pin the decoder's
        // internal pool buffers — once they all sit cached, the decoder
        // stalls and `copyNextSampleBuffer` blocks indefinitely. That's the
        // export-freeze-at-~1s symptom.
        output.alwaysCopiesSampleData = true
        guard reader.canAdd(output) else { return nil }
        reader.add(output)
        guard reader.startReading() else { return nil }
        return WebcamFrameSource(reader: reader, output: output, offset: offset)
    }

    private let offset: CMTime

    private init(reader: AVAssetReader, output: AVAssetReaderTrackOutput, offset: CMTime) {
        self.reader = reader
        self.output = output
        self.offset = offset
    }

    /// Returns the latest webcam frame for screen-timeline `targetPTS` —
    /// i.e. the newest frame whose webcam PTS is ≤ targetPTS − offset.
    /// Caches a one-frame lookahead so we can correctly advance when the
    /// target crosses a webcam frame boundary, instead of perpetually
    /// discarding future frames we've already read.
    func frame(at screenPTS: CMTime) -> CVPixelBuffer? {
        let targetPTS = CMTimeSubtract(screenPTS, offset)
        while true {
            // If our cached lookahead frame is now at or before the target,
            // promote it — it becomes the active frame.
            if let peeked = peekedFrame, CMTimeCompare(peekedPTS, targetPTS) <= 0 {
                currentFrame = peeked
                currentPTS = peekedPTS
                peekedFrame = nil
            }

            // We're done advancing once we have a lookahead frame past the
            // target (or the reader's exhausted).
            if peekedFrame != nil { break }
            if exhausted { break }

            // Try to pull another sample from the reader.
            guard reader.status == .reading, let sample = output.copyNextSampleBuffer() else {
                exhausted = true
                break
            }
            guard let buffer = CMSampleBufferGetImageBuffer(sample) else { continue }
            let nextPTS = CMSampleBufferGetPresentationTimeStamp(sample)
            if CMTimeCompare(nextPTS, targetPTS) <= 0 {
                // Still ≤ target — make this the new current.
                currentFrame = buffer
                currentPTS = nextPTS
            } else {
                // Past target — stash as the lookahead for future calls.
                // Also use it as the current if we don't yet have one
                // (rare: target is before the first webcam frame).
                peekedFrame = buffer
                peekedPTS = nextPTS
                if currentFrame == nil {
                    currentFrame = buffer
                    currentPTS = nextPTS
                }
            }
        }
        return currentFrame
    }
}
