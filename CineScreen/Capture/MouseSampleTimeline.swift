import Foundation

/// Converts mouse telemetry into the video's epoch, using monotonic timestamps
/// rather than capture-start wall time or the time an actor handles an event.
enum MouseSampleTimeline {
    static func rebased(_ samples: [MouseSample], firstFrameHostPTSSeconds: Double?, durationMs: Double) -> [MouseSample] {
        let duration = durationMs.isFinite ? max(0, durationMs) : 0
        let epoch = firstFrameHostPTSSeconds.flatMap { $0.isFinite ? $0 : nil }
        let timed = samples.compactMap { sample -> MouseSample? in
            var sample = sample
            if let epoch, let host = sample.hostTimeSeconds {
                sample.timestamp = (host - epoch) * 1000
            }
            return sample.timestamp.isFinite ? sample : nil
        }.sorted { $0.timestamp < $1.timestamp }
        var retained = timed.filter { $0.timestamp >= 0 && $0.timestamp <= duration }
        // The final position before the first frame is the true starting
        // position. Preserve it as a move, never as an invented click at zero.
        if var seed = timed.last(where: { $0.timestamp < 0 }) {
            seed.timestamp = 0
            seed.kind = .move
            retained.insert(seed, at: 0)
        }
        return retained
    }
}
