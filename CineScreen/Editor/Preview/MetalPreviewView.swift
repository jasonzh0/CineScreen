import SwiftUI
import MetalKit
import AVFoundation
import CoreVideo

/// Metal-backed preview: in each MTKView draw tick, asks the AVPlayer's
/// video output for the current frame and hands it to MetalRenderer.
struct MetalPreviewView: NSViewRepresentable {
    let player: AVPlayer
    var cursorStateProvider: (() -> CursorRenderState?)?
    var clickStatesProvider: (() -> [ClickRingState])?
    var zoomStateProvider: (() -> ZoomState)?
    var canvasStyleProvider: (() -> CanvasStyle)?

    func makeCoordinator() -> Coordinator {
        Coordinator(player: player)
    }

    func makeNSView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero)
        guard let renderer = MetalRenderer(view: view) else {
            return view
        }
        context.coordinator.renderer = renderer
        context.coordinator.attachVideoOutput(to: player)

        renderer.frameProvider = { [weak coordinator = context.coordinator] in
            coordinator?.copyCurrentFrame() ?? nil
        }
        renderer.cursorStateProvider = cursorStateProvider
        renderer.clickStatesProvider = clickStatesProvider
        renderer.zoomStateProvider = zoomStateProvider
        renderer.canvasStyleProvider = canvasStyleProvider
        view.delegate = renderer
        return view
    }

    func updateNSView(_ nsView: MTKView, context: Context) {
        if context.coordinator.player !== player {
            context.coordinator.attachVideoOutput(to: player)
            context.coordinator.player = player
        }
        context.coordinator.renderer?.cursorStateProvider = cursorStateProvider
        context.coordinator.renderer?.clickStatesProvider = clickStatesProvider
        context.coordinator.renderer?.zoomStateProvider = zoomStateProvider
        context.coordinator.renderer?.canvasStyleProvider = canvasStyleProvider
    }

    @MainActor
    final class Coordinator {
        var renderer: MetalRenderer?
        weak var player: AVPlayer?
        private var videoOutput: AVPlayerItemVideoOutput?
        private var observedItem: AVPlayerItem?

        init(player: AVPlayer) {
            self.player = player
        }

        // MARK: - AVPlayerItemVideoOutput attachment

        func attachVideoOutput(to player: AVPlayer) {
            self.player = player
            guard let item = player.currentItem else {
                // The item may attach right after this. Retry once on the next tick.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                    guard let self = self, let item = player.currentItem else { return }
                    self.attach(item: item)
                }
                return
            }
            attach(item: item)
        }

        private func attach(item: AVPlayerItem) {
            guard observedItem !== item else { return }
            // Custom Metal rendering: AVPlayer has no AVPlayerLayer attached,
            // so its internal Video Render Pipeline has nowhere to draw —
            // setting suppressesPlayerRendering=true tells it to skip its own
            // render path entirely and just hand pixel buffers to our output.
            // Without this we see VRP err=-12852 + FigFilePlayer err=-12860
            // on every editor open. (Note: this property is settable only
            // BEFORE the output is added to the item.)
            let attributes: [String: Any] = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            ]
            let output = AVPlayerItemVideoOutput(pixelBufferAttributes: attributes)
            output.suppressesPlayerRendering = true
            item.add(output)
            videoOutput = output
            observedItem = item
        }

        /// Called from MetalRenderer.draw on the MTKView's draw queue. Returns
        /// a fresh pixel buffer if the player has advanced, otherwise nil.
        nonisolated func copyCurrentFrame() -> CVPixelBuffer? {
            // We allow this nonisolated read because videoOutput / player are
            // only mutated on main and we accept a stale read of a reference.
            // Worst case: we copy the previous output once; renderer reuses
            // its existing texture.
            guard let output = MainActor.assumeIsolated({ videoOutput }) else { return nil }
            let host = CACurrentMediaTime()
            let itemTime = output.itemTime(forHostTime: host)
            guard output.hasNewPixelBuffer(forItemTime: itemTime) else { return nil }
            return output.copyPixelBuffer(forItemTime: itemTime, itemTimeForDisplay: nil)
        }
    }
}
