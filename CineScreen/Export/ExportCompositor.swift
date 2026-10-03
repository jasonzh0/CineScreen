import Metal
import CoreVideo
import Foundation

/// Offline adapter for the same FrameCompositor used by the live preview.
/// Confine one instance to the export queue; render waits for GPU completion
/// before handing the destination pixel buffer back to the writer.
final class ExportCompositor {
    private let commandQueue: MTLCommandQueue
    private let compositor: FrameCompositor
    private let textures: PixelBufferTextures

    init?() {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let compositor = FrameCompositor(device: device, pixelFormat: .bgra8Unorm, label: "export"),
              let textures = PixelBufferTextures(device: device) else { return nil }
        self.commandQueue = queue
        self.compositor = compositor
        self.textures = textures
    }

    func render(
        source: CVPixelBuffer,
        cursor: CursorRenderState?,
        clicks: [ClickRingState] = [],
        zoom: ZoomState = .identity,
        canvas: CanvasStyle = .none,
        output: OutputSettings = .default,
        webcam: CVPixelBuffer? = nil,
        webcamLayout: WebcamLayout = .default,
        destination: CVPixelBuffer
    ) -> Bool {
        guard let source = textures.bind(source), let destination = textures.bind(destination) else { return false }
        let webcam = webcamLayout.enabled ? webcam.flatMap { textures.bind($0) } : nil
        let state = CompositionState(cursor: cursor, clicks: clicks, zoom: zoom, canvas: canvas,
                                     output: output, webcamLayout: webcamLayout)
        let descriptor = MTLRenderPassDescriptor()
        descriptor.colorAttachments[0].texture = destination.texture
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.colorAttachments[0].storeAction = .store
        let color = canvas.background.firstColor
        descriptor.colorAttachments[0].clearColor = MTLClearColor(
            red: Double(color.x), green: Double(color.y), blue: Double(color.z), alpha: Double(color.w))
        guard let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else { return false }
        compositor.encode(source: source.texture, webcam: webcam?.texture,
                          destinationSize: CGSize(width: destination.texture.width, height: destination.texture.height),
                          state: state, into: encoder)
        encoder.endEncoding()
        return withExtendedLifetime((source, destination, webcam)) {
            commandBuffer.commit()
            commandBuffer.waitUntilCompleted()
            return commandBuffer.status == .completed
        }
    }
}
