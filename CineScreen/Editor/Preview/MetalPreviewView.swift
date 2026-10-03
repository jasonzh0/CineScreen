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
    var isPlaying: Bool = false
    var renderRevision: Int = 0
    var requestedTimeMs: Double = 0
    var webcamOffsetMs: Double = 0
    var sourceTimeForPlayback: ((Double) -> Double)? = nil

    var stateAtTime: (Double) -> CompositionState

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero)
        guard let renderer = MetalRenderer(view: view) else { return view }
        let coordinator = context.coordinator
        coordinator.renderer = renderer
        coordinator.attachVideoOutput(to: player)
        coordinator.attachWebcamVideoOutput(to: webcamPlayer)
        renderer.frameProvider = { [weak coordinator] in coordinator?.copyCurrentFrame() }
        renderer.webcamFrameProvider = { [weak coordinator] in coordinator?.copyCurrentWebcamFrame() }
        view.delegate = renderer
        configure(view, coordinator: coordinator)
        return view
    }

    func updateNSView(_ view: MTKView, context: Context) {
        let coordinator = context.coordinator
        coordinator.attachVideoOutput(to: player)
        coordinator.attachWebcamVideoOutput(to: webcamPlayer)
        configure(view, coordinator: coordinator)
    }

    private func configure(_ view: MTKView, coordinator: Coordinator) {
        coordinator.playing = isPlaying
        coordinator.requestedTimeMs = requestedTimeMs
        coordinator.webcamOffsetMs = webcamOffsetMs
        coordinator.sourceTimeForPlayback = sourceTimeForPlayback
        // The frame provider establishes one timestamp for all passes in this draw.
        coordinator.renderer?.stateProvider = { [weak coordinator] in
            stateAtTime(coordinator?.drawTimeMs ?? requestedTimeMs)
        }
        view.enableSetNeedsDisplay = !isPlaying
        view.isPaused = !isPlaying
        let changed = coordinator.lastRevision != renderRevision || coordinator.lastRequestedTime != requestedTimeMs || coordinator.lastPlaying != isPlaying
        coordinator.lastRevision = renderRevision
        coordinator.lastRequestedTime = requestedTimeMs
        coordinator.lastPlaying = isPlaying
        if changed { coordinator.refresh(view: view) }
    }

    static func dismantleNSView(_ view: MTKView, coordinator: Coordinator) {
        coordinator.refreshTask?.cancel()
        coordinator.screenOutput.detach()
        coordinator.webcamOutput.detach()
        view.isPaused = true
        view.delegate = nil
        coordinator.renderer = nil
    }

    @MainActor
    final class Coordinator {
        var renderer: MetalRenderer?
        let screenOutput = PlayerVideoOutput()
        let webcamOutput = PlayerVideoOutput()

        var playing = false
        var requestedTimeMs: Double = 0
        var drawTimeMs: Double = 0
        var webcamOffsetMs: Double = 0
        var sourceTimeForPlayback: ((Double) -> Double)?
        var lastRevision: Int?
        var lastRequestedTime: Double?
        var lastPlaying: Bool?
        var refreshTask: Task<Void, Never>?
        private var lastWebcamFrame: CVPixelBuffer?

        func refresh(view: MTKView) {
            refreshTask?.cancel()
            view.needsDisplay = true
            guard !playing else { return }
            // Seeks decode asynchronously. Poll briefly, then stop rendering while idle.
            refreshTask = Task { @MainActor [weak self, weak view] in
                for _ in 0..<30 {
                    guard !Task.isCancelled, let self, let view, !self.playing else { return }
                    view.draw()
                    try? await Task.sleep(nanoseconds: 16_666_667)
                }
            }
        }

        func attachVideoOutput(to player: AVPlayer) {
            if screenOutput.attach(to: player) { renderer?.resetFrame() }
        }

        func attachWebcamVideoOutput(to player: AVPlayer?) {
            if webcamOutput.attach(to: player) { lastWebcamFrame = nil }
        }

        /// Playing overlays use the continuous media clock; a paused seek holds
        /// overlays with the displayed image until its new decoded frame arrives.
        func copyCurrentFrame() -> CVPixelBuffer? {
            guard let output = screenOutput.output else { return nil }
            let time = playing ? output.itemTime(forHostTime: CACurrentMediaTime())
                : CMTime(seconds: max(0, requestedTimeMs) / 1000, preferredTimescale: 60_000)
            if playing, time.seconds.isFinite {
                let itemMs = time.seconds * 1000
                drawTimeMs = sourceTimeForPlayback?(itemMs) ?? itemMs
            }
            guard output.hasNewPixelBuffer(forItemTime: time) else { return nil }
            var displayTime = CMTime.invalid
            let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: &displayTime)
            if buffer != nil, !playing {
                let itemMs = displayTime.seconds.isFinite ? displayTime.seconds * 1000 : requestedTimeMs
                drawTimeMs = sourceTimeForPlayback?(itemMs) ?? itemMs
            }
            return buffer
        }

        func copyCurrentWebcamFrame() -> CVPixelBuffer? {
            guard let output = webcamOutput.output, drawTimeMs >= webcamOffsetMs else { return nil }
            let time = CMTime(seconds: (drawTimeMs - webcamOffsetMs) / 1000, preferredTimescale: 60_000)
            if output.hasNewPixelBuffer(forItemTime: time),
               let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil) {
                lastWebcamFrame = buffer
            }
            return lastWebcamFrame
        }

    }
}
