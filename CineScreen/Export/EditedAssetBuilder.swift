import Foundation
import AVFoundation

/// Builds a zero-based, non-destructive edit. Each screen/audio track uses
/// exactly the same insert and scale ranges, including silence where an audio
/// track starts late or ends early. Reader audio mixing renders time scaling.
enum EditedAssetBuilder {
    struct Result {
        let asset: AVMutableComposition
        let videoTrack: AVMutableCompositionTrack
        let audioTracks: [AVMutableCompositionTrack]
    }

    static func build(source: AVAsset, timeline: EditTimeline) async throws -> Result {
        guard let sourceVideo = try await source.loadTracks(withMediaType: .video).first else {
            throw ExportError.noVideoTrack
        }
        guard !timeline.segments.isEmpty else { throw ExportError.emptyTimeline }
        let composition = AVMutableComposition()
        guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw ExportError.readerSetupFailed("edited video track")
        }
        video.preferredTransform = try await sourceVideo.load(.preferredTransform)
        let sources = try await source.loadTracks(withMediaType: .audio)
        var audioPairs: [(source: AVAssetTrack, target: AVMutableCompositionTrack, range: CMTimeRange)] = []
        for sourceAudio in sources {
            guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
                throw ExportError.readerSetupFailed("edited audio track")
            }
            audioPairs.append((sourceAudio, track, try await sourceAudio.load(.timeRange)))
        }
        var outputStart = CMTime.zero
        for segment in timeline.segments {
            let sourceRange = CMTimeRange(start: time(segment.startMs), end: time(segment.endMs))
            let outputDuration = time(segment.durationMs)
            try video.insertTimeRange(sourceRange, of: sourceVideo, at: outputStart)
            video.scaleTimeRange(CMTimeRange(start: outputStart, duration: sourceRange.duration), toDuration: outputDuration)
            for pair in audioPairs {
                let intersection = CMTimeRangeGetIntersection(sourceRange, otherRange: pair.range)
                if intersection.isValid, CMTimeCompare(intersection.duration, .zero) > 0 {
                    let lead = CMTimeSubtract(intersection.start, sourceRange.start)
                    if CMTimeCompare(lead, .zero) > 0 {
                        pair.target.insertEmptyTimeRange(CMTimeRange(start: outputStart, duration: lead))
                    }
                    try pair.target.insertTimeRange(intersection, of: pair.source, at: CMTimeAdd(outputStart, lead))
                    let tailStart = CMTimeAdd(outputStart, CMTimeAdd(lead, intersection.duration))
                    let tail = CMTimeSubtract(sourceRange.duration, CMTimeAdd(lead, intersection.duration))
                    if CMTimeCompare(tail, .zero) > 0 {
                        pair.target.insertEmptyTimeRange(CMTimeRange(start: tailStart, duration: tail))
                    }
                } else {
                    pair.target.insertEmptyTimeRange(CMTimeRange(start: outputStart, duration: sourceRange.duration))
                }
                pair.target.scaleTimeRange(CMTimeRange(start: outputStart, duration: sourceRange.duration), toDuration: outputDuration)
            }
            outputStart = CMTimeAdd(outputStart, outputDuration)
        }
        return Result(asset: composition, videoTrack: video, audioTracks: audioPairs.map(\.target))
    }

    private static func time(_ milliseconds: Double) -> CMTime {
        CMTime(seconds: milliseconds / 1000, preferredTimescale: 60_000)
    }
}
