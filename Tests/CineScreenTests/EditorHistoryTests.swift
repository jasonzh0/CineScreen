import XCTest
import AVFoundation
@testable import CineScreen

final class EditorHistoryTests: XCTestCase {
    @MainActor
    private func model(_ metadata: RecordingMetadata = Fixtures.metadata()) throws -> EditorViewModel {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let sidecar = folder.appendingPathComponent("recording.json")
        try metadata.write(to: sidecar)
        addTeardownBlock { try? FileManager.default.removeItem(at: folder) }
        let vm = EditorViewModel(videoURL: folder.appendingPathComponent("recording.mp4"), metadataURL: sidecar)
        vm.durationMs = metadata.video.duration
        return vm
    }

    @MainActor
    func testSliderUndoCoalescesAndRestoresMirroredState() throws {
        let vm = try model()
        let original = vm.metadata
        vm.beginEditing()
        for index in 0..<100 { vm.canvasPadding = Double(index) / 1000 }
        vm.endEditing()
        let edited = vm.metadata
        XCTAssertTrue(vm.canUndo)
        vm.undo()
        XCTAssertEqual(vm.metadata, original)
        XCTAssertEqual(vm.canvasPadding, 0.065)
        XCTAssertFalse(vm.canUndo)
        XCTAssertTrue(vm.canRedo)
        vm.redo()
        XCTAssertEqual(vm.metadata, edited)
        XCTAssertEqual(vm.canvasPadding, 0.099, accuracy: 0.000001)
    }

    @MainActor
    func testSuggestZoomsIsOneReversibleEdit() throws {
        let vm = try model(Fixtures.metadata(clicks: [Fixtures.click(2000)], sections: [Fixtures.section(6000, 9000)]))
        let original = vm.metadata
        vm.suggestZoomSections()
        XCTAssertNotEqual(vm.metadata, original)
        vm.undo()
        XCTAssertEqual(vm.metadata, original)
        XCTAssertFalse(vm.canUndo)
    }

    @MainActor
    func testSplitDeleteSpeedAndUndoPreserveSourceCoordinates() throws {
        let vm = try model()
        vm.trimEndMs = 10_000
        vm.seek(toMilliseconds: 3000)
        vm.splitAtPlayhead()
        XCTAssertEqual(vm.retainedSegments.count, 2)
        vm.seek(toMilliseconds: 7000)
        vm.splitAtPlayhead()
        let middle = try XCTUnwrap(vm.retainedSegments.first(where: { $0.startMs == 3000 }))
        vm.selectSegment(middle.id)
        vm.removeSelectedSegment()
        XCTAssertEqual(vm.editedDurationMs, 6000)
        XCTAssertEqual(vm.editTimeline.sourceTime(atOutputMs: 3000), 7000)
        vm.undo()
        XCTAssertEqual(vm.retainedSegments.count, 3)
        vm.selectSegment(middle.id)
        vm.setSelectedSegmentSpeed(2)
        XCTAssertEqual(vm.editedDurationMs, 8000)
        vm.undo()
        XCTAssertEqual(vm.editedDurationMs, 10_000)
    }

    @MainActor
    func testAppearanceChangesReuseMotionStorage() throws {
        let vm = try model(Fixtures.metadata(keyframes: [Fixtures.keyframe(0, 0, 0), Fixtures.keyframe(10000, 1000, 500)], sections: [Fixtures.section(1000, 8000)]))
        let before = try XCTUnwrap(vm.makeRenderSnapshot())
        vm.canvasShadowStrength = 0.7
        vm.clickRingColorHex = "#ff0000"
        let after = try XCTUnwrap(vm.makeRenderSnapshot())
        XCTAssertEqual(before.cursorSamples, after.cursorSamples)
        XCTAssertEqual(before.panSamples, after.panSamples)
        before.cursorSamples.withUnsafeBufferPointer { first in
            after.cursorSamples.withUnsafeBufferPointer { second in XCTAssertEqual(first.baseAddress, second.baseAddress) }
        }
        XCTAssertEqual(after.metadata.effects?.clickCircles.color, "#ff0000")
    }

    @MainActor
    func testNewEditClearsRedoAndSaveFailureStaysVisible() throws {
        let vm = try model()
        vm.canvasPadding = 0.1
        vm.undo()
        vm.canvasDropShadow = false
        XCTAssertFalse(vm.canRedo)
        try FileManager.default.removeItem(at: vm.metadataURL!.deletingLastPathComponent())
        XCTAssertFalse(vm.saveNow())
        XCTAssertNotNil(vm.lastSaveError)
        XCTAssertTrue(vm.hasUnsavedChanges)
    }
    @MainActor
    func testCompositionPlaybackUsesTheSameCutAndSpeedMapAsExport() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let video = try await ExportFixtures.make(in: folder)
        var metadata = Fixtures.metadata(width: 320, height: 180, duration: 4000)
        metadata.editSegments = [EditSegment(startMs: 0, endMs: 1000), EditSegment(startMs: 2000, endMs: 4000, speed: 2)]
        let sidecar = folder.appendingPathComponent("recording.json")
        try metadata.write(to: sidecar)
        let vm = EditorViewModel(videoURL: video, metadataURL: sidecar)
        for _ in 0..<250 {
            if vm.playbackTimeline != nil, !vm.isPreparingPlayback { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertNotNil(vm.playbackTimeline)
        XCTAssertTrue(vm.player.currentItem?.asset is AVComposition)
        XCTAssertEqual(vm.editedDurationMs, 2000, accuracy: 1)
        vm.seek(toMilliseconds: 3000)
        XCTAssertEqual(vm.playbackTimeMs, 1500, accuracy: 1)
        XCTAssertEqual(vm.sourceTimeForPlayback(1500), 3000, accuracy: 1)
        XCTAssertEqual(vm.sourceTimeForPlayback(2100), 4000, accuracy: 1, "Clock overrun holds the last retained source frame")
        XCTAssertEqual(vm.sourceTimeForPlayback(-1), 0)
        vm.play()
        XCTAssertEqual(vm.player.rate, 1, "Composition already contains the segment speed")
        vm.pause()
        vm.seek(toMilliseconds: 1500)
        XCTAssertEqual(vm.currentTimeMs, 2000, "Removed source time snaps to the next retained frame")
        XCTAssertEqual(vm.playbackTimeMs, 1000, accuracy: 1)
        vm.stepFrame(-1)
        XCTAssertLessThan(vm.currentTimeMs, 1000)
        XCTAssertGreaterThan(vm.currentTimeMs, 950)
    }

    @MainActor
    func testLegacyCanvasDefaultsMatchPreviewAndUndoRestoration() throws {
        var metadata = Fixtures.metadata()
        metadata.canvas = try JSONDecoder().decode(CanvasStyleConfig.self, from: Data(
            #"{"background":{"stops":[{"r":0,"g":0,"b":0,"a":1,"position":0}],"angleDegrees":0},"padding":0.1,"dropShadow":true}"#.utf8))
        let vm = try model(metadata)
        XCTAssertEqual(vm.canvasShadowStrength, CanvasStyleConfig.default.resolvedShadowStrength)
        XCTAssertEqual(vm.canvasShadowSoftness, CanvasStyleConfig.default.resolvedShadowSoftness)
        XCTAssertEqual(vm.canvasStyle.cornerRadius, Float(CanvasStyleConfig.default.resolvedCornerRadius))
        XCTAssertFalse(vm.canUndo, "Loading a legacy canvas is not an edit")
        vm.canvasShadowDistance = 0.2
        vm.undo()
        XCTAssertEqual(vm.metadata, metadata)
        XCTAssertEqual(vm.canvasShadowDistance, CanvasStyleConfig.default.resolvedShadowDistance)
    }

    @MainActor
    func testPresetRestoresAllCanvasBindingsAsOneEditInsideGesture() throws {
        let vm = try model()
        let original = try XCTUnwrap(vm.metadata)
        let canvas = CanvasStyleConfig(background: .solid("#314159"), padding: 0.123456789,
                                      dropShadow: false, shadowStrength: 0.7, shadowSoftness: 0.3,
                                      shadowDistance: 0.1, shadowAngle: 25, cornerRadius: 0.07)
        let preset = LookPreset(name: "Fixture", canvas: canvas, cursor: original.cursor.config,
                                zoom: original.zoom.config, effects: nil, webcam: .default, output: .default)
        vm.beginEditing()
        vm.applyLookPreset(preset)
        vm.canvasShadowStrength = 0.8
        vm.endEditing()
        XCTAssertEqual(vm.canvasPadding, canvas.padding)
        XCTAssertEqual(vm.canvasStyle.background, canvas.background)
        XCTAssertEqual(vm.canvasStyle.shadowAngle, 25)
        vm.undo()
        XCTAssertEqual(vm.metadata, original)
        XCTAssertFalse(vm.canUndo)
        vm.redo()
        XCTAssertEqual(vm.canvasPadding, canvas.padding)
        XCTAssertEqual(vm.canvasShadowStrength, 0.8)
        XCTAssertEqual(vm.canvasCornerRadius, 0.07)
    }

}
