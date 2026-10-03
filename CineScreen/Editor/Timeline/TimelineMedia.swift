import AVFoundation
import AppKit

/// Small, bounded source-media cache. Generate once per opened recording;
/// timeline magnification reuses these images and audio peaks.
struct TimelineMedia: @unchecked Sendable {
    var thumbnails: [CGImage] = []
    var waveform: [Float] = []

    static func load(url: URL, durationMs: Double) async -> TimelineMedia {
        let asset = AVURLAsset(url: url)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 240, height: 135)
        generator.requestedTimeToleranceBefore = CMTime(seconds: 0.2, preferredTimescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 0.2, preferredTimescale: 600)
        var images: [CGImage] = []
        for index in 0..<16 {
            if Task.isCancelled { return TimelineMedia() }
            let time = CMTime(seconds: durationMs * Double(index) / 16 / 1000, preferredTimescale: 600)
            if let image = try? await generator.image(at: time).image { images.append(image) }
        }
        let peaks = await Task.detached(priority: .utility) { await audioPeaks(asset: asset, durationMs: durationMs) }.value
        return TimelineMedia(thumbnails: images, waveform: peaks)
    }

    private static func audioPeaks(asset: AVURLAsset, durationMs: Double) async -> [Float] {
        guard durationMs > 0,
              let tracks = try? await asset.loadTracks(withMediaType: .audio),
              let track = tracks.first,
              let reader = try? AVAssetReader(asset: asset) else { return [] }
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false
        ])
        guard reader.canAdd(output) else { return [] }
        reader.add(output)
        guard reader.startReading() else { return [] }
        var peaks = [Float](repeating: 0, count: 240)
        while let sample = output.copyNextSampleBuffer() {
            if Task.isCancelled { reader.cancelReading(); return [] }
            guard let buffer = CMSampleBufferGetDataBuffer(sample) else { continue }
            let timestamp = CMSampleBufferGetPresentationTimeStamp(sample).seconds * 1000
            let index = min(peaks.count - 1, max(0, Int(timestamp / durationMs * Double(peaks.count))))
            let length = CMBlockBufferGetDataLength(buffer)
            guard length > 0, length % MemoryLayout<Float>.size == 0 else { continue }
            var values = [Float](repeating: 0, count: length / MemoryLayout<Float>.size)
            let status = values.withUnsafeMutableBytes {
                CMBlockBufferCopyDataBytes(buffer, atOffset: 0, dataLength: length, destination: $0.baseAddress!)
            }
            guard status == kCMBlockBufferNoErr else { continue }
            peaks[index] = max(peaks[index], values.reduce(0) { max($0, abs($1)) })
        }
        return reader.status == .completed ? peaks : []
    }
}
