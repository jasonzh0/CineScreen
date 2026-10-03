import MetalKit
import CoreVideo

/// Live preview adapter. Frame acquisition runs before state sampling so every
/// overlay uses the timestamp established by the displayed video frame.
/// Access this renderer and its providers on the MTKView's main-thread draw path.
@MainActor
final class MetalRenderer: NSObject, @preconcurrency MTKViewDelegate {
    private let commandQueue: MTLCommandQueue
    private let compositor: FrameCompositor
    private let textures: PixelBufferTextures
    private var currentFrame: PixelBufferTexture?

    var frameProvider: (() -> CVPixelBuffer?)?
    var webcamFrameProvider: (() -> CVPixelBuffer?)?
    var stateProvider: (() -> CompositionState)?

    init?(view: MTKView) {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let compositor = FrameCompositor(device: device, pixelFormat: .bgra8Unorm, label: "preview"),
              let textures = PixelBufferTextures(device: device) else { return nil }
        self.commandQueue = queue
        self.compositor = compositor
        self.textures = textures
        super.init()
        view.device = device
        view.delegate = self
        view.colorPixelFormat = .bgra8Unorm
        view.framebufferOnly = true
        view.enableSetNeedsDisplay = false
        view.isPaused = false
        view.preferredFramesPerSecond = 60
    }

    func resetFrame() { currentFrame = nil }

    func draw(in view: MTKView) {
        if let buffer = frameProvider?(), let frame = textures.bind(buffer) { currentFrame = frame }
        let state = stateProvider?() ?? CompositionState()
        let color = state.canvas.background.firstColor
        view.clearColor = MTLClearColor(red: Double(color.x), green: Double(color.y),
                                       blue: Double(color.z), alpha: Double(color.w))
        guard let drawable = view.currentDrawable,
              let descriptor = view.currentRenderPassDescriptor,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else { return }
        let source = currentFrame
        let webcam = source != nil && state.webcamLayout.enabled
            ? webcamFrameProvider?().flatMap { textures.bind($0) } : nil
        compositor.encode(source: source?.texture, webcam: webcam?.texture,
                          destinationSize: view.drawableSize, state: state, into: encoder)
        encoder.endEncoding()
        // MTKView submits asynchronously. Keep CV bindings through completion,
        // even when a subsequent draw replaces currentFrame.
        commandBuffer.addCompletedHandler { [source, webcam] _ in
            withExtendedLifetime((source, webcam)) {}
        }
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}
}
