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
    private let textureLoader: MTKTextureLoader
    private var cursorTextures: [CursorShape: MTLTexture] = [:]

    init?() {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let library = device.makeDefaultLibrary() else { return nil }

        guard let bgVertex = library.makeFunction(name: "background_vertex"),
              let bgFragment = library.makeFunction(name: "background_fragment"),
              let shadowVertex = library.makeFunction(name: "shadow_vertex"),
              let shadowFragment = library.makeFunction(name: "shadow_fragment"),
              let videoVertex = library.makeFunction(name: "video_vertex"),
              let videoFragment = library.makeFunction(name: "video_fragment"),
              let cursorVertex = library.makeFunction(name: "cursor_vertex"),
              let cursorFragment = library.makeFunction(name: "cursor_fragment"),
              let clickVertex = library.makeFunction(name: "click_vertex"),
              let clickFragment = library.makeFunction(name: "click_fragment") else { return nil }

        // Pipelines render into BGRA to match the writer's pixel buffer format.
        let bgDesc = MTLRenderPipelineDescriptor()
        bgDesc.vertexFunction = bgVertex
        bgDesc.fragmentFunction = bgFragment
        bgDesc.colorAttachments[0].pixelFormat = .bgra8Unorm
        bgDesc.label = "export.background"
        guard let backgroundPipeline = try? device.makeRenderPipelineState(descriptor: bgDesc) else { return nil }

        let shadowDesc = MTLRenderPipelineDescriptor()
        shadowDesc.vertexFunction = shadowVertex
        shadowDesc.fragmentFunction = shadowFragment
        shadowDesc.colorAttachments[0].pixelFormat = .bgra8Unorm
        shadowDesc.colorAttachments[0].isBlendingEnabled = true
        shadowDesc.colorAttachments[0].rgbBlendOperation = .add
        shadowDesc.colorAttachments[0].alphaBlendOperation = .add
        shadowDesc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        shadowDesc.colorAttachments[0].sourceAlphaBlendFactor = .one
        shadowDesc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        shadowDesc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        shadowDesc.label = "export.shadow"
        guard let shadowPipeline = try? device.makeRenderPipelineState(descriptor: shadowDesc) else { return nil }

        let videoDesc = MTLRenderPipelineDescriptor()
        videoDesc.vertexFunction = videoVertex
        videoDesc.fragmentFunction = videoFragment
        videoDesc.colorAttachments[0].pixelFormat = .bgra8Unorm
        videoDesc.colorAttachments[0].isBlendingEnabled = true
        videoDesc.colorAttachments[0].rgbBlendOperation = .add
        videoDesc.colorAttachments[0].alphaBlendOperation = .add
        videoDesc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        videoDesc.colorAttachments[0].sourceAlphaBlendFactor = .one
        videoDesc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        videoDesc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        videoDesc.label = "export.video"
        guard let videoPipeline = try? device.makeRenderPipelineState(descriptor: videoDesc) else { return nil }

        let cursorDesc = MTLRenderPipelineDescriptor()
        cursorDesc.vertexFunction = cursorVertex
        cursorDesc.fragmentFunction = cursorFragment
        cursorDesc.colorAttachments[0].pixelFormat = .bgra8Unorm
        cursorDesc.colorAttachments[0].isBlendingEnabled = true
        cursorDesc.colorAttachments[0].rgbBlendOperation = .add
        cursorDesc.colorAttachments[0].alphaBlendOperation = .add
        cursorDesc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        cursorDesc.colorAttachments[0].sourceAlphaBlendFactor = .one
        cursorDesc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        cursorDesc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        cursorDesc.label = "export.cursor"
        guard let cursorPipeline = try? device.makeRenderPipelineState(descriptor: cursorDesc) else { return nil }

        let clickDesc = MTLRenderPipelineDescriptor()
        clickDesc.vertexFunction = clickVertex
        clickDesc.fragmentFunction = clickFragment
        clickDesc.colorAttachments[0].pixelFormat = .bgra8Unorm
        clickDesc.colorAttachments[0].isBlendingEnabled = true
        clickDesc.colorAttachments[0].rgbBlendOperation = .add
        clickDesc.colorAttachments[0].alphaBlendOperation = .add
        clickDesc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        clickDesc.colorAttachments[0].sourceAlphaBlendFactor = .one
        clickDesc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        clickDesc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        clickDesc.label = "export.click"
        guard let clickPipeline = try? device.makeRenderPipelineState(descriptor: clickDesc) else { return nil }

        guard let webcamVertex = library.makeFunction(name: "webcam_vertex"),
              let webcamFragment = library.makeFunction(name: "webcam_fragment") else { return nil }
        let webcamDesc = MTLRenderPipelineDescriptor()
        webcamDesc.vertexFunction = webcamVertex
        webcamDesc.fragmentFunction = webcamFragment
        webcamDesc.colorAttachments[0].pixelFormat = .bgra8Unorm
        webcamDesc.colorAttachments[0].isBlendingEnabled = true
        webcamDesc.colorAttachments[0].rgbBlendOperation = .add
        webcamDesc.colorAttachments[0].alphaBlendOperation = .add
        webcamDesc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        webcamDesc.colorAttachments[0].sourceAlphaBlendFactor = .one
        webcamDesc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        webcamDesc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        webcamDesc.label = "export.webcam"
        guard let webcamPipeline = try? device.makeRenderPipelineState(descriptor: webcamDesc) else { return nil }

        let quad: [SIMD4<Float>] = [
            SIMD4(-1, -1, 0, 1),
            SIMD4( 1, -1, 1, 1),
            SIMD4(-1,  1, 0, 0),
            SIMD4( 1,  1, 1, 0),
        ]
        let len = MemoryLayout<SIMD4<Float>>.stride * quad.count
        guard let buffer = device.makeBuffer(bytes: quad, length: len, options: .storageModeShared) else { return nil }

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
        self.backgroundPipeline = backgroundPipeline
        self.shadowPipeline = shadowPipeline
        self.videoPipeline = videoPipeline
        self.cursorPipeline = cursorPipeline
        self.clickPipeline = clickPipeline
        self.webcamPipeline = webcamPipeline
        self.vertexBuffer = buffer
        self.textureCache = cache
        self.textureLoader = MTKTextureLoader(device: device)
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

        // 0.5 Drop shadow
        if canvas.dropShadow && canvas.padding > 0.005 {
            let halfSize = aspect.scale * canvasUniforms.contentScale
            var shadowUniforms = ShadowUniforms(
                halfSize: halfSize,
                blur: 0.18,
                yOffset: -0.03,
                opacity: 0.42
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
        if let cursor = cursor, let texture = cursorTexture(for: cursor.shape) {
            var uniforms = CursorUniforms(
                cursorPos: cursor.positionInVideoPixels,
                size: cursor.size,
                videoSize: videoSize,
                aspectScale: aspect.scale,
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

    private func cursorTexture(for shape: CursorShape) -> MTLTexture? {
        if let cached = cursorTextures[shape] { return cached }
        let candidates = [shape.rawValue, "arrow"]
        for name in candidates {
            if let tex = loadCursorTexture(named: name) {
                cursorTextures[shape] = tex
                return tex
            }
        }
        return nil
    }

    /// Mirrors MetalRenderer's normalised-RGBA loader — always re-renders
    /// the asset through a fresh sRGB CGContext with explicit RGBA byte
    /// order, then loads via MTKTextureLoader with `.origin: .bottomLeft`.
    /// Without this the export had the same yellow / black-square cursor bug
    /// that the editor preview used to.
    private func loadCursorTexture(named name: String) -> MTLTexture? {
        guard let image = NSImage(named: name) else { return nil }
        let w = max(1, Int(image.size.width))
        let h = max(1, Int(image.size.height))
        guard let cs = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(
                data: nil, width: w, height: h, bitsPerComponent: 8,
                bytesPerRow: 0, space: cs,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                    | CGBitmapInfo.byteOrder32Big.rawValue
              ) else {
            return nil
        }
        let nsCtx = NSGraphicsContext(cgContext: ctx, flipped: false)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = nsCtx
        image.draw(in: NSRect(x: 0, y: 0, width: w, height: h),
                   from: .zero, operation: .copy, fraction: 1.0)
        NSGraphicsContext.restoreGraphicsState()
        guard let cg = ctx.makeImage() else { return nil }

        let opts: [MTKTextureLoader.Option: Any] = [
            .SRGB: false,
            .origin: MTKTextureLoader.Origin.bottomLeft,
            .generateMipmaps: false
        ]
        return try? textureLoader.newTexture(cgImage: cg, options: opts)
    }

    // MARK: - Uniforms (must match the layouts in MetalRenderer.swift)

    private struct AspectUniforms { var scale: SIMD2<Float> }
    private struct CursorUniforms {
        var cursorPos: SIMD2<Float>
        var size: Float
        var _pad0: Float = 0
        var videoSize: SIMD2<Float>
        var aspectScale: SIMD2<Float>
        var opacity: Float
        var _pad1: SIMD3<Float> = .zero
    }
    private struct ClickUniforms {
        var centerInVideoPixels: SIMD2<Float>
        var radiusInPixels: Float
        var thicknessInPixels: Float
        var videoSize: SIMD2<Float>
        var aspectScale: SIMD2<Float>
        var color: SIMD4<Float>
    }
    private struct ZoomUniforms {
        var centerUV: SIMD2<Float>
        var scale: Float
        var _pad: Float = 0
    }
    private struct CanvasUniforms {
        var contentScale: SIMD2<Float>
    }
}
