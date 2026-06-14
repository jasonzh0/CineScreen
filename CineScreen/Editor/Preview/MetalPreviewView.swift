import SwiftUI
import MetalKit
import AVFoundation
import CoreVideo

/// Metal-backed preview: in each MTKView draw tick, asks the AVPlayer's
/// video output for the current frame and hands it to MetalRenderer.
struct MetalPreviewView: NSViewRepresentable {
    let player: AVPlayer
    /// Optional sibling webcam player. Frames are pulled per draw and
    /// composited via the same Metal pipeline as the export.
    var webcamPlayer: AVPlayer? = nil
    var cursorStateProvider: (() -> CursorRenderState?)?
    var clickStatesProvider: (() -> [ClickRingState])?
    var zoomStateProvider: (() -> ZoomState)?
    var canvasStyleProvider: (() -> CanvasStyle)?
    var webcamLayoutProvider: (() -> WebcamLayout)?

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
        context.coordinator.attachWebcamVideoOutput(to: webcamPlayer)

        renderer.frameProvider = { [weak coordinator = context.coordinator] in
            coordinator?.copyCurrentFrame() ?? nil
        }
        renderer.webcamFrameProvider = { [weak coordinator = context.coordinator] in
            coordinator?.copyCurrentWebcamFrame() ?? nil
        }
        renderer.cursorStateProvider = cursorStateProvider
        renderer.clickStatesProvider = clickStatesProvider
        renderer.zoomStateProvider = zoomStateProvider
        renderer.canvasStyleProvider = canvasStyleProvider
        renderer.webcamLayoutProvider = webcamLayoutProvider
        view.delegate = renderer
        return view
    }

    func updateNSView(_ nsView: MTKView, context: Context) {
        if context.coordinator.player !== player {
            context.coordinator.attachVideoOutput(to: player)
            context.coordinator.player = player
        }
        if context.coordinator.webcamPlayer !== webcamPlayer {
            context.coordinator.attachWebcamVideoOutput(to: webcamPlayer)
        }
        context.coordinator.renderer?.cursorStateProvider = cursorStateProvider
        context.coordinator.renderer?.clickStatesProvider = clickStatesProvider
        context.coordinator.renderer?.zoomStateProvider = zoomStateProvider
        context.coordinator.renderer?.canvasStyleProvider = canvasStyleProvider
        context.coordinator.renderer?.webcamLayoutProvider = webcamLayoutProvider
    }

    @MainActor
    final class Coordinator {
        var renderer: MetalRenderer?
        weak var player: AVPlayer?
        weak var webcamPlayer: AVPlayer?
        private var videoOutput: AVPlayerItemVideoOutput?
        private var observedItem: AVPlayerItem?
        private var webcamVideoOutput: AVPlayerItemVideoOutput?
        private var observedWebcamItem: AVPlayerItem?

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
            // Detach the previous output from its item so it stops receiving
            // frames; otherwise the old AVPlayerItemVideoOutput leaks and keeps
            // pulling pixel buffers. Guard against removing from the same item
            // we're about to re-add to.
            if let oldOutput = videoOutput, let oldItem = observedItem, oldItem !== item {
                oldItem.remove(oldOutput)
            }
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

        // MARK: - Webcam attachment

        func attachWebcamVideoOutput(to player: AVPlayer?) {
            self.webcamPlayer = player
            // Tear down old subscription if the player changed. Remove the
            // existing output from its item first so it stops receiving frames
            // instead of leaking.
            if let oldOutput = webcamVideoOutput, let oldItem = observedWebcamItem {
                oldItem.remove(oldOutput)
            }
            observedWebcamItem = nil
            webcamVideoOutput = nil
            guard let player = player else { return }
            if let item = player.currentItem {
                attachWebcam(item: item)
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                    guard let self = self, let item = player.currentItem else { return }
                    self.attachWebcam(item: item)
                }
            }
        }

        private func attachWebcam(item: AVPlayerItem) {
            guard observedWebcamItem !== item else { return }
            let attributes: [String: Any] = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            ]
            // Detach the previous webcam output from its item so it stops
            // receiving frames; otherwise it leaks. Guard against removing from
            // the same item we're about to re-add to.
            if let oldOutput = webcamVideoOutput, let oldItem = observedWebcamItem, oldItem !== item {
                oldItem.remove(oldOutput)
            }
            let output = AVPlayerItemVideoOutput(pixelBufferAttributes: attributes)
            // Webcam has no AVPlayerLayer either — same suppression logic as
            // the main player so VRP doesn't try to draw it.
            output.suppressesPlayerRendering = true
            item.add(output)
            webcamVideoOutput = output
            observedWebcamItem = item
        }

        /// Last decoded webcam frame at the current host time. If the player
        /// hasn't advanced since the previous draw we return nil and the
        /// renderer skips the webcam pass — but only when we've never seen
        /// any frame; otherwise we return the cached output so the overlay
        /// keeps drawing across paused/static moments.
        nonisolated func copyCurrentWebcamFrame() -> CVPixelBuffer? {
            guard let output = MainActor.assumeIsolated({ webcamVideoOutput }) else { return nil }
            let host = CACurrentMediaTime()
            let itemTime = output.itemTime(forHostTime: host)
            // Always return the current buffer (even if not new) — the
            // overlay should stay visible while paused.
            return output.copyPixelBuffer(forItemTime: itemTime, itemTimeForDisplay: nil)
        }
    }
}
