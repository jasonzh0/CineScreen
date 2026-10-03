import Foundation

/// A retained range on the original recording. Times stay in source space so
/// cursor, zoom and camera metadata never need destructive rewriting.
struct EditSegment: Codable, Equatable, Identifiable {
    var id: UUID = UUID()
    var startMs: Double
    var endMs: Double
    var speed: Double = 1

    var durationMs: Double { max(0, endMs - startMs) / max(0.25, speed) }
}

/// One mapping shared by playback and every exported media track. An absent
/// edit list means the original clip; an empty list means nothing is retained.
struct EditTimeline: Equatable {
    let segments: [EditSegment]
    let durationMs: Double

    init(segments: [EditSegment]?, durationMs: Double, trim: TrimRange? = nil) {
        let duration = durationMs.isFinite ? max(0, durationMs) : 0
        let trimStart = trim?.startMs ?? 0
        let trimEnd = trim?.endMs ?? duration
        let start = min(duration, max(0, trimStart.isFinite ? trimStart : 0))
        let end = min(duration, max(start, trimEnd.isFinite ? trimEnd : duration))
        let whole = EditSegment(id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, startMs: start, endMs: end)
        var retained: [EditSegment] = []
        var previousEnd = start
        let valid = (segments ?? [whole]).filter { $0.startMs.isFinite && $0.endMs.isFinite && $0.speed.isFinite }
        for var segment in valid.sorted(by: { $0.startMs < $1.startMs }) {
            segment.startMs = max(previousEnd, max(start, segment.startMs))
            segment.endMs = min(end, segment.endMs)
            segment.speed = min(4, max(0.25, segment.speed))
            guard segment.endMs > segment.startMs else { continue }
            retained.append(segment)
            previousEnd = segment.endMs
        }
        self.segments = retained
        self.durationMs = retained.reduce(0) { $0 + $1.durationMs }
    }

    func sourceTime(atOutputMs time: Double) -> Double? {
        guard time.isFinite, time >= 0, time <= durationMs, !segments.isEmpty else { return nil }
        var outputStart = 0.0
        for segment in segments {
            let outputEnd = outputStart + segment.durationMs
            if time < outputEnd {
                return segment.startMs + (time - outputStart) * segment.speed
            }
            outputStart = outputEnd
        }
        return segments.last?.endMs
    }

    func outputTime(atSourceMs time: Double) -> Double? {
        guard time.isFinite else { return nil }
        var outputStart = 0.0
        for segment in segments {
            if time >= segment.startMs, time < segment.endMs {
                return outputStart + (time - segment.startMs) / segment.speed
            }
            outputStart += segment.durationMs
        }
        return time == segments.last?.endMs ? durationMs : nil
    }

    static func split(segments: [EditSegment], atSourceMs time: Double) -> [EditSegment] {
        segments.flatMap { segment in
            guard time > segment.startMs, time < segment.endMs else { return [segment] }
            var left = segment
            left.endMs = time
            return [left, EditSegment(startMs: time, endMs: segment.endMs, speed: segment.speed)]
        }
    }

    static func removing(segments: [EditSegment], id: UUID) -> [EditSegment] {
        segments.filter { $0.id != id }
    }
}
