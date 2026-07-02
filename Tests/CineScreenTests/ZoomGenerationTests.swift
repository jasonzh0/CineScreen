import XCTest
@testable import CineScreen

final class ZoomGenerationTests: XCTestCase {
    @MainActor
    func testClicksClusterWithinGap() {
        // 1000 and 2500 are within the 2s cluster gap; 8000 starts a new one.
        let clicks = [Fixtures.click(1000), Fixtures.click(2500), Fixtures.click(8000)]
        let sections = EditorViewModel.generateZoomSections(from: clicks, videoDuration: 20_000, scale: 2)
        XCTAssertEqual(sections.count, 2)
        XCTAssertEqual(sections[0].startTime, 700, accuracy: 1e-9)   // 300ms preroll
        XCTAssertEqual(sections[0].endTime, 3700, accuracy: 1e-9)    // 1200ms postroll
        XCTAssertEqual(sections[1].startTime, 7700, accuracy: 1e-9)
    }

    @MainActor
    func testGeneratedSectionsAreSortedAndNonOverlapping() {
        let clicks = stride(from: 500.0, through: 30_000, by: 2500).map { Fixtures.click($0) }
        let sections = EditorViewModel.generateZoomSections(from: clicks, videoDuration: 32_000, scale: 2)
        XCTAssertFalse(sections.isEmpty)
        for pair in zip(sections, sections.dropFirst()) {
            XCTAssertLessThanOrEqual(pair.0.endTime, pair.1.startTime)
        }
    }

    @MainActor
    func testMouseUpsAreIgnored() {
        let clicks = [Fixtures.click(1000, action: .up)]
        XCTAssertTrue(EditorViewModel.generateZoomSections(from: clicks, videoDuration: 10_000, scale: 2).isEmpty)
    }

    @MainActor
    func testBoundsClampToVideo() {
        let clicks = [Fixtures.click(100), Fixtures.click(9_900)]
        let sections = EditorViewModel.generateZoomSections(from: clicks, videoDuration: 10_000, scale: 2)
        XCTAssertGreaterThanOrEqual(sections.first?.startTime ?? -1, 0)
        XCTAssertLessThanOrEqual(sections.last?.endTime ?? .infinity, 10_000)
    }
}
