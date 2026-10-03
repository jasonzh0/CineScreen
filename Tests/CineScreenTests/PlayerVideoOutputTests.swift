import XCTest
import AVFoundation
@testable import CineScreen

final class PlayerVideoOutputTests: XCTestCase {
    @MainActor
    func testReplacementAndDetachRemoveSubscriptionsFromPreviousItems() throws {
        let first = AVPlayerItem(asset: AVMutableComposition())
        let second = AVPlayerItem(asset: AVMutableComposition())
        let player = AVPlayer(playerItem: first)
        let source = PlayerVideoOutput()
        XCTAssertTrue(source.attach(to: player))
        let output = try XCTUnwrap(source.output)
        XCTAssertTrue(output.suppressesPlayerRendering)
        XCTAssertTrue(first.outputs.contains { $0 === output })
        XCTAssertFalse(source.attach(to: player))
        XCTAssertEqual(first.outputs.count, 1)
        player.replaceCurrentItem(with: second)
        XCTAssertTrue(source.attach(to: player))
        XCTAssertTrue(first.outputs.isEmpty)
        XCTAssertEqual(second.outputs.count, 1)
        source.detach()
        XCTAssertTrue(second.outputs.isEmpty)
        XCTAssertNil(source.output)
    }

    @MainActor
    func testDetachCancelsDeferredAttachment() async throws {
        let player = AVPlayer()
        let source = PlayerVideoOutput()
        source.attach(to: player)
        let lateItem = AVPlayerItem(asset: AVMutableComposition())
        player.replaceCurrentItem(with: lateItem)
        source.detach()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertNil(source.output)
        XCTAssertTrue(lateItem.outputs.isEmpty)
    }

    @MainActor
    func testReplacementCancelsDeferredAttachmentToOldPlayer() async throws {
        let previousPlayer = AVPlayer()
        let source = PlayerVideoOutput()
        source.attach(to: previousPlayer)
        let replacementItem = AVPlayerItem(asset: AVMutableComposition())
        let replacementPlayer = AVPlayer(playerItem: replacementItem)
        source.attach(to: replacementPlayer)
        let lateItem = AVPlayerItem(asset: AVMutableComposition())
        previousPlayer.replaceCurrentItem(with: lateItem)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertTrue(lateItem.outputs.isEmpty)
        XCTAssertEqual(replacementItem.outputs.count, 1)
        source.detach()
    }
}
