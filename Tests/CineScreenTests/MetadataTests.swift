import XCTest
@testable import CineScreen

final class MetadataTests: XCTestCase {
    func testRoundTripPreservesEverything() throws {
        let original = Fixtures.metadata(
            keyframes: [Fixtures.keyframe(0, 1, 2), Fixtures.keyframe(100, 3, 4)],
            clicks: [Fixtures.click(50)],
            sections: [Fixtures.section(10, 500, scale: 3)],
            webcamOffsetMs: 456.7
        )
        let decoded = try RecordingMetadata.decode(from: original.encode())
        XCTAssertEqual(decoded, original)
    }

    /// Files written before the newer optional fields existed must still
    /// decode, with those fields nil.
    func testDecodingOldFileWithoutNewFieldsYieldsNil() throws {
        let original = Fixtures.metadata(webcamOffsetMs: 456.7)
        var json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: original.encode()) as? [String: Any]
        )
        json.removeValue(forKey: "webcamOffsetMs")
        json.removeValue(forKey: "webcam")
        json.removeValue(forKey: "canvas")
        json.removeValue(forKey: "trim")
        let data = try JSONSerialization.data(withJSONObject: json)
        let decoded = try RecordingMetadata.decode(from: data)
        XCTAssertNil(decoded.webcamOffsetMs)
        XCTAssertNil(decoded.webcam)
        XCTAssertNil(decoded.canvas)
        XCTAssertNil(decoded.trim)
    }
}
