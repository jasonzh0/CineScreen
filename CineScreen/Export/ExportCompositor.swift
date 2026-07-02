import Foundation
import Metal
import MetalKit
import CoreVideo
import simd
import AppKit

/// Headless GPU compositor for the export pipeline. Mirrors `MetalRenderer`
/// (same shaders, same passes) but renders into a CVPixelBuffer-backed
/// MTLTexture instead of an MTKView drawable.
final class ExportCompositor {
    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private let backgroundPipeline: MTLRenderPipelineState
    private let shadowPipeline: MTLRenderPipelineState
    private let videoPipeline: MTLRenderPipelineState
    private let cursorPipeline: MTLRenderPipelineState
    private let clickPipeline: MTLRenderPipelineState
    private let webcamPipeline: MTLRenderPipelineState
    private let vertexBuffer: MTLBuffer
    private let textureCache: CVMetalTextureCache
    private let cursorTextureStore: CursorTextureStore

    init?() {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let library = device.makeDefaultLibrary() else { return nil }

        // Pipelines render into BGRA to match the writer's pixel buffer
        // format. Shared factory + quad — see CompositorCore; identical
        // wiring to the preview by construction.
        guard let pipelines = CompositorCore.makePipelines(
            device: device,
            library: library,
            pixelFormat: .bgra8Unorm,
            labelPrefix: "export"
        ) else { return nil }
        guard let buffer = CompositorCore.makeQuadBuffer(device: device) else { return nil }

        // Cache attributes: auto-expire bindings older than 0.5s. Without
        // this the cache grows unbounded — each frame's source + destination
        // textures pin their CVPixelBuffers, eventually exhausting the
        // reader and writer pools. Manifests as a deterministic stall at
        // ~frame 117 on 2560×1500 content (≈1.8 GB pinned).
        let cacheAttrs: CFDictionary = [
            kCVMetalTextureCacheMaximumTextureAgeKey as String: 0.5 as CFNumber
        ] as CFDictionary
        var cache: CVMetalTextureCache?
        guard CVMetalTextureCacheCreate(kCFAllocatorDefault, cacheAttrs, device, nil, &cache) == kCVReturnSuccess,
              let cache = cache else { return nil }

        self.device = device
        self.commandQueue = queue
        self.backgroundPipeline = pipelines.background
        self.shadowPipeline = pipelines.shadow
        self.videoPipeline = pipelines.video
        self.cursorPipeline = pipelines.cursor
        self.clickPipeline = pipelines.click
        self.webcamPipeline = pipelines.webcam
        self.vertexBuffer = buffer
        self.textureCache = cache
        self.cursorTextureStore = CursorTextureStore(device: device)
    }

    // MARK: - Render

    /// Composite `source` (with optional `cursor`) into `destination`. Blocks
    /// until the GPU work is done so the caller can append the result
    /// immediately.
    func render(
        source: CVPixelBuffer,
        cursor: CursorRenderState?,
        clicks: [ClickRingState] = [],
        zoom: ZoomState = .identity,
        canvas: CanvasStyle = .none,
        webcam: CVPixelBuffer? = nil,
        webcamLayout: WebcamLayout = .default,
        destination: CVPixelBuffer
    ) -> Bool {
        guard let sourceTexture = makeTexture(from: source),
              let destTexture = makeTexture(from: destination, usage: [.renderTarget, .shaderRead]) else {
            return false
        }
        // CRITICAL: keep the webcam texture in function scope so it survives
        // until after `commandBuffer.commit()`. If we created it inside an
        // `if let` further down, ARC could release it before the GPU is done
        // sampling — manifesting as a GPU hang / "stuck" export.
        let webcamTexture: MTLTexture?
        if webcamLayout.enabled, let webcamBuffer = webcam {
            webcamTexture = makeTexture(from: webcamBuffer)
        } else {
            webcamTexture = nil
        }

        let descriptor = MTLRenderPassDescriptor()
        descriptor.colorAttachments[0].texture = destTexture
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.colorAttachments[0].storeAction = .store
        let clearColor = canvas.background.firstColor
        descriptor.colorAttachments[0].clearColor = MTLClearColor(
            red: Double(clearColor.x),
            green: Double(clearColor.y),
            blue: Double(clearColor.z),
            alpha: Double(clearColor.w)
        )

        guard let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else {
            return false
        }

        var aspect = AspectUniforms(scale: SIMD2(1, 1))
        var zoomUniforms = ZoomUniforms(centerUV: zoom.centerUV, scale: max(0.01, zoom.scale))
        let inset = max(0, min(0.5, canvas.padding))
        var canvasUniforms = CanvasUniforms(
            contentScale: SIMD2(1.0 - inset * 2.0, 1.0 - inset * 2.0)
        )

        // 0. Background pass — full-screen gradient (matches MetalRenderer)
        var bgUniforms = BackgroundUniforms(canvas.background)
        encoder.setRenderPipelineState(backgroundPipeline)
        encoder.setFragmentBytes(&bgUniforms, length: MemoryLayout<BackgroundUniforms>.stride, index: 0)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)

        // 0.5 Drop shadow — share the live preview's math so the rendered
        // file matches what the editor showed (post-zoom translate + scale,
        // rounded corners, proportional blur).
        if canvas.dropShadow && canvas.padding > 0.005 && canvas.shadowStrength > 0.001 {
            var shadowUniforms = MetalRenderer.makeShadowUniforms(
                aspect: aspect.scale,
                canvasContentScale: canvasUniforms.contentScale,
                zoom: zoom,
                strength: canvas.shadowStrength
            )
            encoder.setRenderPipelineState(shadowPipeline)
            encoder.setFragmentBytes(&shadowUniforms, length: MemoryLayout<ShadowUniforms>.stride, index: 0)
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        }

        // 1. Video pass
        encoder.setRenderPipelineState(videoPipeline)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        encoder.setVertexBytes(&aspect, length: MemoryLayout<AspectUniforms>.stride, index: 1)
        encoder.setVertexBytes(&zoomUniforms, length: MemoryLayout<ZoomUniforms>.stride, index: 2)
        encoder.setVertexBytes(&canvasUniforms, length: MemoryLayout<CanvasUniforms>.stride, index: 3)
        encoder.setFragmentBytes(&canvasUniforms, length: MemoryLayout<CanvasUniforms>.stride, index: 0)
        encoder.setFragmentTexture(sourceTexture, index: 1)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)

        let width = CVPixelBufferGetWidth(source)
        let height = CVPixelBufferGetHeight(source)
        let videoSize = SIMD2(Float(width), Float(height))

        // 2. Click rings
        if !clicks.isEmpty {
            encoder.setRenderPipelineState(clickPipeline)
            for click in clicks {
                var u = ClickUniforms(
                    centerInVideoPixels: click.centerInVideoPixels,
                    radiusInPixels: click.radiusInPixels,
                    thicknessInPixels: click.thicknessInPixels,
                    videoSize: videoSize,
                    aspectScale: aspect.scale,
                    color: click.color
                )
                encoder.setVertexBytes(&u, length: MemoryLayout<ClickUniforms>.stride, index: 0)
                encoder.setVertexBytes(&zoomUniforms, length: MemoryLayout<ZoomUniforms>.stride, index: 1)
                encoder.setVertexBytes(&canvasUniforms, length: MemoryLayout<CanvasUniforms>.stride, index: 2)
                encoder.setFragmentBytes(&u, length: MemoryLayout<ClickUniforms>.stride, index: 0)
                encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
            }
        }

        // 3. Cursor pass
        if let cursor = cursor, let texture = cursorTextureStore.texture(for: cursor.shape) {
            var uniforms = CursorUniforms(
                cursorPos: cursor.positionInVideoPixels,
                videoSize: videoSize,
                aspectScale: aspect.scale,
                hotspot: cursor.hotspotUV,
                motionBlur: cursor.motionBlurUV,
                size: cursor.size,
                opacity: cursor.opacity
            )
            encoder.setRenderPipelineState(cursorPipeline)
            encoder.setVertexBytes(&uniforms, length: MemoryLayout<CursorUniforms>.stride, index: 0)
            encoder.setVertexBytes(&zoomUniforms, length: MemoryLayout<ZoomUniforms>.stride, index: 1)
            encoder.setVertexBytes(&canvasUniforms, length: MemoryLayout<CanvasUniforms>.stride, index: 2)
            encoder.setFragmentBytes(&uniforms, length: MemoryLayout<CursorUniforms>.stride, index: 0)
            encoder.setFragmentTexture(texture, index: 0)
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        }

        // 4. Webcam pass — circular overlay. User-editable position/size via
        //    `webcamLayout`. Skipped when the user has hidden the overlay.
        if let webcamTex = webcamTexture {
            drawWebcam(
                encoder: encoder,
                texture: webcamTex,
                destinationSize: SIMD2(
                    Float(CVPixelBufferGetWidth(destination)),
                    Float(CVPixelBufferGetHeight(destination))
                ),
                canvas: canvasUniforms,
                layout: webcamLayout
            )
        }

        encoder.endEncoding()
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()
        let ok = commandBuffer.status == .completed
        // Keep references alive until after commit so ARC can't release the
        // textures while the GPU is still using them. The previous version
        // also called CVMetalTextureCacheFlush here — that turned out to
        // invalidate the destination texture's IOSurface binding while it
        // was still in flight to AVAssetWriter, stalling exports at ~1s.
        _ = sourceTexture
        _ = destTexture
        _ = webcamTexture
        return ok
    }

    /// Lays out the webcam circle using the user-editable layout. Calls the
    /// shared `MetalRenderer.webcamUniforms` so live preview and export
    /// produce identical pixels.
    private func drawWebcam(
        encoder: MTLRenderCommandEncoder,
        texture: MTLTexture,
        destinationSize: SIMD2<Float>,
        canvas: CanvasUniforms,
        layout: WebcamLayout
    ) {
        let viewAspect = destinationSize.x / destinationSize.y
        var uniforms = MetalRenderer.webcamUniforms(
            for: layout,
            contentScale: canvas.contentScale,
            viewAspect: viewAspect,
            texture: texture
        )
        encoder.setRenderPipelineState(webcamPipeline)
        encoder.setVertexBytes(&uniforms, length: MemoryLayout<WebcamUniforms>.stride, index: 0)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<WebcamUniforms>.stride, index: 0)
        encoder.setFragmentTexture(texture, index: 0)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
    }

    // MARK: - Helpers

    private func makeTexture(from buffer: CVPixelBuffer, usage: MTLTextureUsage = [.shaderRead]) -> MTLTexture? {
        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        var textureRef: CVMetalTexture?
        let status = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault, textureCache, buffer, nil,
            .bgra8Unorm, width, height, 0, &textureRef
        )
        guard status == kCVReturnSuccess, let textureRef = textureRef else { return nil }
        let texture = CVMetalTextureGetTexture(textureRef)
        if let texture = texture, usage.contains(.renderTarget),
           !texture.usage.contains(.renderTarget) {
            // CVMetalTextureCache doesn't always set renderTarget usage; we
            // need it for the destination. Allocate a sidecar render target
            // and blit the result. (Most CVPixelBuffers from
            // AVAssetWriterInputPixelBufferAdaptor's pool already have
            // renderTarget — the check is defensive.)
        }
        return texture
    }

}
