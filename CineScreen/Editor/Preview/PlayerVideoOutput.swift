import AVFoundation
import CoreVideo

/// Owns one player's custom video-output subscription, including a cancellable
/// retry when its item has not attached yet. Preview uses separate instances
/// for the screen and webcam; neither can leave an output on a replaced item.
@MainActor
final class PlayerVideoOutput {
    private weak var player: AVPlayer?
    private(set) var output: AVPlayerItemVideoOutput?
    private var item: AVPlayerItem?
    private var attachmentTask: Task<Void, Never>?

    /// Returns true when the subscription changes and cached frames need reset.
    @discardableResult
    func attach(to player: AVPlayer?) -> Bool {
        guard self.player !== player || item !== player?.currentItem || (player != nil && output == nil) else { return false }
        detach()
        self.player = player
        guard let player else { return true }
        if let item = player.currentItem {
            install(on: item)
        } else {
            attachmentTask = Task { [weak self, weak player] in
                try? await Task.sleep(for: .milliseconds(50))
                guard !Task.isCancelled, let self, let player, self.player === player,
                      let item = player.currentItem else { return }
                self.install(on: item)
                self.attachmentTask = nil
            }
        }
        return true
    }

    func detach() {
        attachmentTask?.cancel()
        attachmentTask = nil
        if let output, let item { item.remove(output) }
        output = nil
        item = nil
        player = nil
    }

    private func install(on item: AVPlayerItem) {
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ])
        // Must be set before installation: Metal owns rendering, with no layer.
        output.suppressesPlayerRendering = true
        item.add(output)
        self.output = output
        self.item = item
    }
}
