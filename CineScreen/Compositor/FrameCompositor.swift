import Foundation
import Metal

/// Encodes the complete frame for both preview and export. Adapters own frame
/// acquisition and GPU submission; this owns pass order and shader bindings.
/// Confine each instance to its adapter's rendering queue.
final class FrameCompositor {
    private let pipelines: CompositorCore.Pipelines
    private let vertexBuffer: MTLBuffer
    private let cursorTextureStore: CursorTextureStore

    init?(device: MTLDevice, pixelFormat: MTLPixelFormat, label: String) {
        guard let library = device.makeDefaultLibrary(),
              let pipelines = CompositorCore.makePipelines(device: device, library: library,
                                                          pixelFormat: pixelFormat, labelPrefix: label),
              let vertexBuffer = CompositorCore.makeQuadBuffer(device: device) else { return nil }
        self.pipelines = pipelines
        self.vertexBuffer = vertexBuffer
        self.cursorTextureStore = CursorTextureStore(device: device)
    }

    func encode(source: MTLTexture?, webcam: MTLTexture?, destinationSize: CGSize,
                state: CompositionState, into encoder: MTLRenderCommandEncoder) {
        let sourceSize = source.map { CGSize(width: $0.width, height: $0.height) }
            ?? CGSize(width: 1920, height: 1080)
        let canvas = state.canvas
        let zoom = state.zoom
        let output = state.output
        let cursor = state.cursor
        let clicks = state.clicks
        let webcamLayout = state.webcamLayout
        var aspect = CompositorCore.aspectUniforms(source: sourceSize, destination: destinationSize, crop: output.crop)
        var zoomUniforms = CompositorCore.zoomUniforms(zoom: zoom, crop: output.crop)
        var canvasUniforms = CompositorCore.canvasUniforms(style: canvas, source: sourceSize, crop: output.crop)

        // Background fills the entire destination.
        var bgUniforms = BackgroundUniforms(canvas.background)
        encoder.setRenderPipelineState(pipelines.background)
        encoder.setFragmentBytes(&bgUniforms, length: MemoryLayout<BackgroundUniforms>.stride, index: 0)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)

        // Shadow tracks the recording after cropping, panning and zooming.
        if canvas.dropShadow && canvas.padding > 0.005 && canvas.shadowStrength > 0.001 {
            var shadowUniforms = CompositorCore.makeShadowUniforms(
                aspect: aspect.scale,
                canvasContentScale: canvasUniforms.contentScale,
                zoom: ZoomState(centerUV: zoomUniforms.centerUV, scale: zoomUniforms.scale),
                strength: canvas.shadowStrength,
                style: canvas,
                viewportAspect: Float(max(1, destinationSize.width) / max(1, destinationSize.height))
            )
            encoder.setRenderPipelineState(pipelines.shadow)
            encoder.setFragmentBytes(&shadowUniforms, length: MemoryLayout<ShadowUniforms>.stride, index: 0)
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        }

        guard let source else { return }

        // 1. Video pass
        encoder.setRenderPipelineState(pipelines.video)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        encoder.setVertexBytes(&aspect, length: MemoryLayout<AspectUniforms>.stride, index: 1)
        encoder.setVertexBytes(&zoomUniforms, length: MemoryLayout<ZoomUniforms>.stride, index: 2)
        encoder.setVertexBytes(&canvasUniforms, length: MemoryLayout<CanvasUniforms>.stride, index: 3)
        encoder.setFragmentBytes(&canvasUniforms, length: MemoryLayout<CanvasUniforms>.stride, index: 0)
        encoder.setFragmentTexture(source, index: 1)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)

        let videoSize = SIMD2(Float(source.width), Float(source.height))

        // 2. Click rings
        if !clicks.isEmpty {
            encoder.setRenderPipelineState(pipelines.click)
            for click in clicks {
                var u = ClickUniforms(
                    centerInVideoPixels: click.centerInVideoPixels,
                    radiusInPixels: click.radiusInPixels,
                    thicknessInPixels: click.thicknessInPixels,
                    videoSize: videoSize,
                    aspectScale: aspect.scale,
                    cropOrigin: aspect.cropOrigin,
                    cropSize: aspect.cropSize,
                    color: click.color
                )
                encoder.setVertexBytes(&u, length: MemoryLayout<ClickUniforms>.stride, index: 0)
                encoder.setVertexBytes(&zoomUniforms, length: MemoryLayout<ZoomUniforms>.stride, index: 1)
                encoder.setVertexBytes(&canvasUniforms, length: MemoryLayout<CanvasUniforms>.stride, index: 2)
                encoder.setFragmentBytes(&u, length: MemoryLayout<ClickUniforms>.stride, index: 0)
                encoder.setFragmentBytes(&canvasUniforms, length: MemoryLayout<CanvasUniforms>.stride, index: 1)
                encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
            }
        }

        // 3. Cursor pass
        if let cursor = cursor, let texture = cursorTextureStore.texture(for: cursor.shape) {
            var uniforms = CursorUniforms(
                cursorPos: cursor.positionInVideoPixels,
                videoSize: videoSize,
                aspectScale: aspect.scale,
                cropOrigin: aspect.cropOrigin,
                cropSize: aspect.cropSize,
                hotspot: cursor.hotspotUV,
                motionBlur: cursor.motionBlurUV,
                size: cursor.size,
                opacity: cursor.opacity
            )
            encoder.setRenderPipelineState(pipelines.cursor)
            encoder.setVertexBytes(&uniforms, length: MemoryLayout<CursorUniforms>.stride, index: 0)
            encoder.setVertexBytes(&zoomUniforms, length: MemoryLayout<ZoomUniforms>.stride, index: 1)
            encoder.setVertexBytes(&canvasUniforms, length: MemoryLayout<CanvasUniforms>.stride, index: 2)
            encoder.setFragmentBytes(&uniforms, length: MemoryLayout<CursorUniforms>.stride, index: 0)
            encoder.setFragmentBytes(&canvasUniforms, length: MemoryLayout<CanvasUniforms>.stride, index: 1)
            encoder.setFragmentTexture(texture, index: 0)
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        }

        // Webcam is last, above the screen and pointer overlays.
        if webcamLayout.enabled, let webcam {
            var uniforms = CompositorCore.webcamUniforms(
                for: webcamLayout,
                contentScale: canvasUniforms.contentScale,
                viewAspect: Float(max(1, destinationSize.width) / max(1, destinationSize.height)),
                texture: webcam
            )
            encoder.setRenderPipelineState(pipelines.webcam)
            encoder.setVertexBytes(&uniforms, length: MemoryLayout<WebcamUniforms>.stride, index: 0)
            encoder.setFragmentBytes(&uniforms, length: MemoryLayout<WebcamUniforms>.stride, index: 0)
            encoder.setFragmentTexture(webcam, index: 0)
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        }
    }
}
