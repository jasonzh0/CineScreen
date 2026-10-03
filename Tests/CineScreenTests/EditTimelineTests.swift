import XCTest
@testable import CineScreen

final class EditTimelineTests: XCTestCase {
    func testCutsAndSpeedShareContinuousOutputClock() throws {
        let timeline = EditTimeline(segments: [
            EditSegment(startMs: 1_000, endMs: 3_000, speed: 2),
            EditSegment(startMs: 5_000, endMs: 7_000, speed: 0.5),
        ], durationMs: 10_000)
        XCTAssertEqual(timeline.durationMs, 5_000)
        XCTAssertEqual(timeline.sourceTime(atOutputMs: 500), 2_000)
        XCTAssertEqual(timeline.sourceTime(atOutputMs: 1_000), 5_000)
        XCTAssertEqual(timeline.sourceTime(atOutputMs: 3_000), 6_000)
        XCTAssertEqual(timeline.sourceTime(atOutputMs: 5_000), 7_000)
        XCTAssertNil(timeline.outputTime(atSourceMs: 4_000))
        XCTAssertEqual(timeline.outputTime(atSourceMs: 6_000), 3_000)
        for output in stride(from: 0.0, to: timeline.durationMs, by: 11) {
            let source = try XCTUnwrap(timeline.sourceTime(atOutputMs: output))
            XCTAssertEqual(try XCTUnwrap(timeline.outputTime(atSourceMs: source)), output, accuracy: 0.0001)
        }
    }

    func testLegacyTrimAndExplicitEmptyEditHaveDifferentMeaning() {
        let legacy = EditTimeline(segments: nil, durationMs: 10_000, trim: TrimRange(startMs: 500, endMs: 4_000))
        XCTAssertEqual(legacy.durationMs, 3_500)
        XCTAssertEqual(legacy.sourceTime(atOutputMs: 0), 500)
        let empty = EditTimeline(segments: [], durationMs: 10_000)
        XCTAssertEqual(empty.durationMs, 0)
        XCTAssertNil(empty.sourceTime(atOutputMs: 0))
    }

    func testTrimIntersectsEditsAndMalformedOverlapsCannotDuplicateSource() {
        let timeline = EditTimeline(segments: [
            EditSegment(startMs: 4_000, endMs: 9_000, speed: 0),
            EditSegment(startMs: 0, endMs: 5_000),
            EditSegment(startMs: .nan, endMs: 3_000),
        ], durationMs: 10_000, trim: TrimRange(startMs: 1_000, endMs: 8_000))
        XCTAssertEqual(timeline.segments.map(\.startMs), [1_000, 5_000])
        XCTAssertEqual(timeline.segments.map(\.endMs), [5_000, 8_000])
        XCTAssertEqual(timeline.segments.last?.speed, 0.25)
    }

    func testSplitAndDeletePreserveSpeedAndOriginalIdentity() {
        let segment = EditSegment(startMs: 0, endMs: 10_000, speed: 2)
        let split = EditTimeline.split(segments: [segment], atSourceMs: 4_000)
        XCTAssertEqual(split.count, 2)
        XCTAssertEqual(split[0].id, segment.id)
        XCTAssertNotEqual(split[1].id, segment.id)
        XCTAssertEqual(split.map(\.speed), [2, 2])
        let retained = EditTimeline.removing(segments: split, id: segment.id)
        XCTAssertEqual(retained.map(\.startMs), [4_000])
        XCTAssertEqual(EditTimeline(segments: retained, durationMs: 10_000).durationMs, 3_000)
    }

    func testOutputPresetsUseEvenDimensionsAndCropBounds() {
        var settings = OutputSettings.default
        settings.aspectRatio = .vertical
        let vertical = OutputGeometry(sourceWidth: 1_920, sourceHeight: 1_080, settings: settings)
        XCTAssertEqual(vertical.width, 1_080)
        XCTAssertEqual(vertical.height, 1_920)
        settings.aspectRatio = .original
        settings.crop = NormalizedCrop(x: 0.9, y: -1, width: 0.5, height: 0.5)
        XCTAssertEqual(settings.crop.clamped(), NormalizedCrop(x: 0.5, y: 0, width: 0.5, height: 0.5))
        let crop = OutputGeometry(sourceWidth: 1_920, sourceHeight: 1_080, settings: settings, scale: 0.5)
        XCTAssertEqual(crop.width, 480)
        XCTAssertEqual(crop.height, 270)
    }

    func testEditAndOutputPreferencesRoundTripWithoutRewritingMotion() throws {
        var metadata = Fixtures.metadata()
        metadata.editSegments = [EditSegment(startMs: 100, endMs: 500, speed: 1.5)]
        metadata.output = OutputSettings(aspectRatio: .square, crop: .full, frameRate: 30, audioGain: 0.75, audioMuted: false)
        XCTAssertEqual(try RecordingMetadata.decode(from: metadata.encode()), metadata)
    }
}
