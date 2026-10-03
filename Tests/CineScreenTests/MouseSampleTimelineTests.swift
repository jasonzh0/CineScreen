import XCTest
@testable import CineScreen

final class MouseSampleTimelineTests: XCTestCase {
    private func sample(relative: Double, host: Double?, x: Double = 100, kind: MouseSample.Kind = .move) -> MouseSample {
        MouseSample(timestamp: relative, x: x, y: 200, kind: kind, cursorShape: .arrow, hostTimeSeconds: host)
    }

    func testVideoEpochIncludesCaptureStartupAndIgnoresActorQueueDelay() {
        // Mouse tracking began 300ms after the first screen frame. Relative
        // timestamp 50ms would have put the click 300ms early in the video.
        let rebased = MouseSampleTimeline.rebased([
            sample(relative: 0, host: 100.3),
            sample(relative: 50, host: 100.35, kind: .down(.left)),
        ], firstFrameHostPTSSeconds: 100, durationMs: 1000)
        XCTAssertEqual(rebased.count, 2)
        XCTAssertEqual(rebased[0].timestamp, 300, accuracy: 0.0001)
        XCTAssertEqual(rebased[1].timestamp, 350, accuracy: 0.0001)
        // Processing this collection later has no effect on its timestamps.
        let again = MouseSampleTimeline.rebased(rebased, firstFrameHostPTSSeconds: 100, durationMs: 1000)
        XCTAssertEqual(again.map(\.timestamp), rebased.map(\.timestamp))
    }

    func testBeforeFirstFrameKeepsLastPositionWithoutInventingClick() {
        let rebased = MouseSampleTimeline.rebased([
            sample(relative: 0, host: 99.7, x: 10),
            sample(relative: 100, host: 99.8, x: 20, kind: .down(.left)),
            sample(relative: 400, host: 100.1, x: 30, kind: .up(.left)),
        ], firstFrameHostPTSSeconds: 100, durationMs: 1000)
        XCTAssertEqual(rebased.count, 2)
        XCTAssertEqual(rebased[0].timestamp, 0)
        XCTAssertEqual(rebased[0].x, 20)
        if case .move = rebased[0].kind {} else { XCTFail("A seed must never introduce a click") }
        XCTAssertEqual(rebased[1].timestamp, 100, accuracy: 0.0001)
    }

    func testLastVideoFrameBoundsTelemetryAndLegacyTimestampsRemainValid() {
        let rebased = MouseSampleTimeline.rebased([
            sample(relative: 200, host: nil),
            sample(relative: 500, host: 100.5, kind: .down(.left)),
            sample(relative: 1100, host: 101.1, kind: .up(.left)),
            sample(relative: .nan, host: nil),
        ], firstFrameHostPTSSeconds: 100, durationMs: 1000)
        XCTAssertEqual(rebased.map(\.timestamp), [200, 500])
        let legacy = MouseSampleTimeline.rebased([sample(relative: 300, host: nil)], firstFrameHostPTSSeconds: nil, durationMs: 1000)
        XCTAssertEqual(legacy[0].timestamp, 300)
    }
}
