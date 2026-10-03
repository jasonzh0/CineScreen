import XCTest
@testable import CineScreen

final class MetadataHistoryTests: XCTestCase {
    func testHistoryEvictsOldestEntriesAndRedoReturnsInOrder() throws {
        var history = EditorHistory(limit: 3)
        var current = Fixtures.metadata()
        for index in 1...5 {
            var next = current
            next.version = String(index)
            history.recordChange(from: current, to: next)
            current = next
        }
        for expected in ["4", "3", "2"] {
            current = try XCTUnwrap(history.undo(current: current))
            XCTAssertEqual(current.version, expected)
        }
        XCTAssertFalse(history.canUndo(current: current))
        for expected in ["3", "4", "5"] {
            current = try XCTUnwrap(history.redo(current: current))
            XCTAssertEqual(current.version, expected)
        }
        XCTAssertFalse(history.canRedo)
    }

    func testNoOpGesturePreservesRedoAndRepeatedBeginKeepsOriginalState() throws {
        var history = EditorHistory()
        let initial = Fixtures.metadata()
        var edited = initial
        edited.version = "edited"
        history.recordChange(from: initial, to: edited)
        XCTAssertEqual(history.undo(current: edited), initial)
        history.beginEditing(current: initial)
        history.endEditing(current: initial)
        XCTAssertTrue(history.canRedo)
        history.beginEditing(current: initial)
        history.recordChange(from: initial, to: edited)
        history.beginEditing(current: edited)
        XCTAssertTrue(history.canUndo(current: edited))
        // Undo during a gesture completes it and restores its original state.
        XCTAssertEqual(history.undo(current: edited), initial)
        XCTAssertFalse(history.canUndo(current: initial))
        XCTAssertEqual(history.redo(current: initial), edited)
    }

    func testEditAfterUndoClearsRedoAndMissingMetadataDoesNotConsumeHistory() {
        var history = EditorHistory()
        let initial = Fixtures.metadata()
        var edited = initial
        edited.version = "edited"
        history.recordChange(from: initial, to: edited)
        XCTAssertNil(history.undo(current: nil))
        XCTAssertTrue(history.canUndo(current: edited))
        XCTAssertEqual(history.undo(current: edited), initial)
        var replacement = initial
        replacement.version = "replacement"
        history.recordChange(from: initial, to: replacement)
        XCTAssertFalse(history.canRedo)
        XCTAssertEqual(history.undo(current: replacement), initial)
    }
}
