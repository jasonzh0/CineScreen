import Foundation
import Metal
import MetalKit
import CoreVideo
import simd
import AppKit

/// What the renderer needs to draw a cursor overlay this frame.
struct CursorRenderState {
    /// Cursor centre in **video pixel** coordinates (top-left origin).
    var positionInVideoPixels: SIMD2<Float>
    /// Cursor sprite size in video pixels.
    var size: Float
    /// Opacity multiplier, 0..1.
    var opacity: Float
    var shape: CursorShape
    /// The coordinate space `positionInVideoPixels` is normalised against —
    /// usually `(metadata.video.width, metadata.video.height)`. The renderer
    /// uses this so the cursor can be drawn even before the first video frame
    /// has arrived from the AVPlayer.
    var videoSize: SIMD2<Float>
}

/// One click ring to draw this frame. Position + animated radius + opacity.
struct ClickRingState {
    var centerInVideoPixels: SIMD2<Float>
    var radiusInPixels: Float
    var thicknessInPixels: Float
    var color: SIMD4<Float>  // RGBA in 0..1
}

/// Pan + zoom transform applied to the entire composite (video + cursor +
/// clicks). `centerUV` is in [0,1]² (normalized video coords).
struct ZoomState {
    var centerUV: SIMD2<Float>
    var scale: Float

    static let identity = ZoomState(centerUV: SIMD2(0.5, 0.5), scale: 1.0)
}

/// GPU uniforms for the circular webcam overlay. Shared between
/// `MetalRenderer` (live preview) and `ExportCompositor` (offline) so they
/// always read identical pixels.
struct WebcamUniforms {
    var centerNDC: SIMD2<Float>
    var halfSizeNDC: SIMD2<Float>
    var textureUVScale: SIMD2<Float>
    var textureUVOffset: SIMD2<Float>
    var ringColor: SIMD4<Float>
    var ringWidthNorm: Float
    var _pad0: Float = 0
    var _pad1: Float = 0
    var _pad2: Float = 0
}

/// Canvas styling (background + padding + rounded corners). The renderer
/// draws the gradient background full-screen then composites the video
/// region inset by `padding` on top.
struct CanvasStyle {
    /// 0..0.5 — fraction of the half-axis used as padding. 0.05 = 10% padding overall.
    var padding: Float
    /// 1-to-4-stop linear gradient (or solid via a 1-stop background).
    var background: CanvasBackground
    /// Soft drop shadow underneath the video quad.
    var dropShadow: Bool = true

    static let none = CanvasStyle(
        padding: 0,
        background: .solid("#000000"),
        dropShadow: false
    )
}

/// Owns the GPU resources and the per-frame draw routine for the editor's
/// preview canvas. Phase 2.C: passthrough video. Phase 2.D: cursor overlay.
///
/// Not isolated to any actor: MTKView delegate callbacks fire from the
/// display link, and `updateFrame(_:)` must be invoked on the same thread
/// (call it on .main from the editor view).
final class MetalRenderer: NSObject {
    let device: MTLDevice
    let commandQueue: MTLCommandQueue

    private let backgroundPipeline: MTLRenderPipelineState
    private let shadowPipeline: MTLRenderPipelineState
    private let videoPipeline: MTLRenderPipelineState
    private let cursorPipeline: MTLRenderPipelineState
    private let clickPipeline: MTLRenderPipelineState
    private let webcamPipeline: MTLRenderPipelineState
    private let videoVertexBuffer: MTLBuffer
    private let textureCache: CVMetalTextureCache

    // Cached cursor textures, lazily loaded the first time a shape is used.
    private var cursorTextures: [CursorShape: MTLTexture] = [:]
    private let textureLoader: MTKTextureLoader

    /// The most recent video frame.
    private var currentTexture: MTLTexture?
    private var currentTextureSize: CGSize = .zero

    private var drawableSize: CGSize = .zero

    /// Pulled on every `draw(in:)` to ingest the latest video frame.
    var frameProvider: (() -> CVPixelBuffer?)?
    /// Optional — if set, drawn on top of the video each frame.
    var cursorStateProvider: (() -> CursorRenderState?)?
    /// Optional — returns the click rings active at the current playback time.
    var clickStatesProvider: (() -> [ClickRingState])?
    /// Optional — returns the zoom transform for the current playback time.
    var zoomStateProvider: (() -> ZoomState)?
    /// Optional — returns the canvas style (background, padding, corner radius).
    var canvasStyleProvider: (() -> CanvasStyle)?
    /// Optional — pulled on every draw to ingest the latest webcam pixel
    /// buffer. When present, drawn as a circular overlay matching the export
    /// pipeline byte-for-byte.
    var webcamFrameProvider: (() -> CVPixelBuffer?)?
    /// User-editable position + size of the webcam circle. The pass is
    /// skipped entirely when `enabled = false`.
    var webcamLayoutProvider: (() -> WebcamLayout)?

    init?(view: MTKView) {
        guard let device = MTLCreateSystemDefaultDevice() else { return nil }
        guard let queue = device.makeCommandQueue() else { return nil }
        guard let library = device.makeDefaultLibrary() else { return nil }

        // Background pipeline (full-screen gradient, no blending)
        guard let bgVertex = library.makeFunction(name: "background_vertex"),
              let bgFragment = library.makeFunction(name: "background_fragment") else { return nil }
        let bgDesc = MTLRenderPipelineDescriptor()
        bgDesc.vertexFunction = bgVertex
        bgDesc.fragmentFunction = bgFragment
        bgDesc.colorAttachments[0].pixelFormat = view.colorPixelFormat
        bgDesc.label = "canvas.background"
        guard let backgroundPipeline = try? device.makeRenderPipelineState(descriptor: bgDesc) else {
            return nil
        }

        // Drop-shadow pipeline (full-screen with alpha blending over background)
        guard let shadowVertex = library.makeFunction(name: "shadow_vertex"),
              let shadowFragment = library.makeFunction(name: "shadow_fragment") else { return nil }
        let shadowDesc = MTLRenderPipelineDescriptor()
        shadowDesc.vertexFunction = shadowVertex
        shadowDesc.fragmentFunction = shadowFragment
        shadowDesc.colorAttachments[0].pixelFormat = view.colorPixelFormat
        shadowDesc.colorAttachments[0].isBlendingEnabled = true
        shadowDesc.colorAttachments[0].rgbBlendOperation = .add
        shadowDesc.colorAttachments[0].alphaBlendOperation = .add
        shadowDesc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        shadowDesc.colorAttachments[0].sourceAlphaBlendFactor = .one
        shadowDesc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        shadowDesc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        shadowDesc.label = "canvas.shadow"
        guard let shadowPipeline = try? device.makeRenderPipelineState(descriptor: shadowDesc) else {
            return nil
        }

        // Video pipeline — alpha blended so the rounded-corner mask in the
        // fragment shader actually clips against the background pass.
        guard let videoVertex = library.makeFunction(name: "video_vertex"),
              let videoFragment = library.makeFunction(name: "video_fragment") else { return nil }
        let videoDesc = MTLRenderPipelineDescriptor()
        videoDesc.vertexFunction = videoVertex
        videoDesc.fragmentFunction = videoFragment
        videoDesc.colorAttachments[0].pixelFormat = view.colorPixelFormat
        videoDesc.colorAttachments[0].isBlendingEnabled = true
        videoDesc.colorAttachments[0].rgbBlendOperation = .add
        videoDesc.colorAttachments[0].alphaBlendOperation = .add
        videoDesc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        videoDesc.colorAttachments[0].sourceAlphaBlendFactor = .one
        videoDesc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        videoDesc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        videoDesc.label = "video.passthrough"
        guard let videoPipeline = try? device.makeRenderPipelineState(descriptor: videoDesc) else {
            return nil
        }

        // Cursor pipeline (alpha blending)
        guard let cursorVertex = library.makeFunction(name: "cursor_vertex"),
              let cursorFragment = library.makeFunction(name: "cursor_fragment") else { return nil }
        let cursorDesc = MTLRenderPipelineDescriptor()
        cursorDesc.vertexFunction = cursorVertex
        cursorDesc.fragmentFunction = cursorFragment
        cursorDesc.colorAttachments[0].pixelFormat = view.colorPixelFormat
        cursorDesc.colorAttachments[0].isBlendingEnabled = true
        cursorDesc.colorAttachments[0].rgbBlendOperation = .add
        cursorDesc.colorAttachments[0].alphaBlendOperation = .add
        cursorDesc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        cursorDesc.colorAttachments[0].sourceAlphaBlendFactor = .one
        cursorDesc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        cursorDesc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        cursorDesc.label = "cursor.sprite"
        guard let cursorPipeline = try? device.makeRenderPipelineState(descriptor: cursorDesc) else {
            return nil
        }

        // Click pipeline shares the same blending setup; procedural ring.
        guard let clickVertex = library.makeFunction(name: "click_vertex"),
              let clickFragment = library.makeFunction(name: "click_fragment") else { return nil }
        let clickDesc = MTLRenderPipelineDescriptor()
        clickDesc.vertexFunction = clickVertex
        clickDesc.fragmentFunction = clickFragment
        clickDesc.colorAttachments[0].pixelFormat = view.colorPixelFormat
        clickDesc.colorAttachments[0].isBlendingEnabled = true
        clickDesc.colorAttachments[0].rgbBlendOperation = .add
        clickDesc.colorAttachments[0].alphaBlendOperation = .add
        clickDesc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        clickDesc.colorAttachments[0].sourceAlphaBlendFactor = .one
        clickDesc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        clickDesc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        clickDesc.label = "click.ring"
        guard let clickPipeline = try? device.makeRenderPipelineState(descriptor: clickDesc) else { return nil }

        // Webcam pipeline — same blend setup as the others. Identical shader
        // pair as ExportCompositor so the editor preview matches the export
        // pixel-for-pixel.
        guard let webcamVertex = library.makeFunction(name: "webcam_vertex"),
              let webcamFragment = library.makeFunction(name: "webcam_fragment") else { return nil }
        let webcamDesc = MTLRenderPipelineDescriptor()
        webcamDesc.vertexFunction = webcamVertex
        webcamDesc.fragmentFunction = webcamFragment
        webcamDesc.colorAttachments[0].pixelFormat = view.colorPixelFormat
        webcamDesc.colorAttachments[0].isBlendingEnabled = true
        webcamDesc.colorAttachments[0].rgbBlendOperation = .add
        webcamDesc.colorAttachments[0].alphaBlendOperation = .add
        webcamDesc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        webcamDesc.colorAttachments[0].sourceAlphaBlendFactor = .one
        webcamDesc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        webcamDesc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        webcamDesc.label = "webcam.circle"
        guard let webcamPipeline = try? device.makeRenderPipelineState(descriptor: webcamDesc) else {
            return nil
        }

        // Video vertex buffer: triangle strip covering [-1,1]² with UVs.
        let quad: [SIMD4<Float>] = [
            SIMD4(-1.0, -1.0, 0.0, 1.0),
            SIMD4( 1.0, -1.0, 1.0, 1.0),
            SIMD4(-1.0,  1.0, 0.0, 0.0),
            SIMD4( 1.0,  1.0, 1.0, 0.0),
        ]
        let bufLen = MemoryLayout<SIMD4<Float>>.stride * quad.count
        guard let buffer = device.makeBuffer(bytes: quad, length: bufLen, options: .storageModeShared) else {
            return nil
        }

        // Auto-expire texture bindings after 0.5s — same fix as in
        // ExportCompositor. Long editor sessions otherwise accumulate
        // bindings until the player's frame pool stalls.
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
        self.videoVertexBuffer = buffer
        self.textureCache = cache
        self.textureLoader = MTKTextureLoader(device: device)
        super.init()

        view.device = device
        view.delegate = self
        view.colorPixelFormat = .bgra8Unorm
        view.framebufferOnly = true
        view.enableSetNeedsDisplay = false
        view.isPaused = false
        view.preferredFramesPerSecond = 60
        view.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
    }

    // MARK: - Frame ingestion

    func updateFrame(_ pixelBuffer: CVPixelBuffer) {
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)

        var textureRef: CVMetalTexture?
        let status = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault, textureCache, pixelBuffer, nil,
            .bgra8Unorm, width, height, 0, &textureRef
        )
        guard status == kCVReturnSuccess, let textureRef = textureRef,
              let texture = CVMetalTextureGetTexture(textureRef) else {
            return
        }
        currentTexture = texture
        currentTextureSize = CGSize(width: width, height: height)
    }

    // MARK: - Draw

    private func draw(view: MTKView) {
        if let buffer = frameProvider?() {
            updateFrame(buffer)
        }

        let style = canvasStyleProvider?() ?? .none
        // Clear to the first gradient stop so the screen-edge gutter blends
        // smoothly with the top-left of the gradient.
        let clearColor = style.background.firstColor
        view.clearColor = MTLClearColor(
            red: Double(clearColor.x),
            green: Double(clearColor.y),
            blue: Double(clearColor.z),
            alpha: Double(clearColor.w)
        )

        guard let drawable = view.currentDrawable,
              let descriptor = view.currentRenderPassDescriptor,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else {
            return
        }

        let aspect = aspectFitScale()
        let zoom = zoomStateProvider?() ?? .identity
        var zoomUniforms = ZoomUniforms(centerUV: zoom.centerUV, scale: max(0.01, zoom.scale))
        let inset = max(0, min(0.5, style.padding))
        var canvasUniforms = CanvasUniforms(
            contentScale: SIMD2(1.0 - inset * 2.0, 1.0 - inset * 2.0)
        )

        // 0. Background pass — full-screen gradient
        var bgUniforms = BackgroundUniforms(style.background)
        encoder.setRenderPipelineState(backgroundPipeline)
        encoder.setFragmentBytes(&bgUniforms, length: MemoryLayout<BackgroundUniforms>.stride, index: 0)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)

        // 0.5 Drop shadow — only meaningful when padding > 0 (the video has
        // canvas around it for the shadow to bleed into).
        if style.dropShadow && style.padding > 0.005 {
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
        if let texture = currentTexture {
            encoder.setRenderPipelineState(videoPipeline)
            encoder.setVertexBuffer(videoVertexBuffer, offset: 0, index: 0)
            var aspectUniforms = aspect
            encoder.setVertexBytes(&aspectUniforms, length: MemoryLayout<AspectUniforms>.stride, index: 1)
            encoder.setVertexBytes(&zoomUniforms, length: MemoryLayout<ZoomUniforms>.stride, index: 2)
            encoder.setVertexBytes(&canvasUniforms, length: MemoryLayout<CanvasUniforms>.stride, index: 3)
            encoder.setFragmentBytes(&canvasUniforms, length: MemoryLayout<CanvasUniforms>.stride, index: 0)
            encoder.setFragmentTexture(texture, index: 1)
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        }

        // 2. Click rings (drawn behind cursor)
        if currentTextureSize.width > 0, let clicks = clickStatesProvider?(), !clicks.isEmpty {
            let videoSize = SIMD2(Float(currentTextureSize.width), Float(currentTextureSize.height))
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

        // 3. Cursor pass — render even when no video frame has arrived yet,
        // using the cursor state's own videoSize as the coordinate space.
        if let cursor = cursorStateProvider?() {
            let videoSize: SIMD2<Float>
            if currentTextureSize.width > 0 {
                videoSize = SIMD2(Float(currentTextureSize.width), Float(currentTextureSize.height))
            } else if cursor.videoSize.x > 0 && cursor.videoSize.y > 0 {
                videoSize = cursor.videoSize
            } else {
                videoSize = SIMD2(1920, 1080)
            }
            if let texture = cursorTexture(for: cursor.shape) {
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
            } else {
                Log.editor.warning("Cursor texture missing for shape \(cursor.shape.rawValue)")
            }
        }

        // 4. Webcam pass — drawn after cursor so it sits on top of every
        //    other overlay (matches export).
        let webcamLayout = webcamLayoutProvider?() ?? .default
        if webcamLayout.enabled,
           let webcamBuffer = webcamFrameProvider?(),
           let webcamTexture = makeTexture(from: webcamBuffer) {
            drawWebcam(
                encoder: encoder,
                texture: webcamTexture,
                drawableSize: drawableSize,
                canvas: canvasUniforms,
                layout: webcamLayout
            )
        }

        encoder.endEncoding()
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }

    /// Mirrors `ExportCompositor.drawWebcam` so the editor preview is a
    /// pixel-for-pixel preview of what the export will write — circle
    /// position, ring colour, ring width, and crop logic are identical.
    private func drawWebcam(
        encoder: MTLRenderCommandEncoder,
        texture: MTLTexture,
        drawableSize: CGSize,
        canvas: CanvasUniforms,
        layout: WebcamLayout
    ) {
        let aspectRatio: Float
        if drawableSize.width > 0, drawableSize.height > 0 {
            aspectRatio = Float(drawableSize.width / drawableSize.height)
        } else {
            aspectRatio = 1
        }
        var uniforms = Self.webcamUniforms(
            for: layout,
            contentScale: canvas.contentScale,
            viewAspect: aspectRatio,
            texture: texture
        )
        encoder.setRenderPipelineState(webcamPipeline)
        encoder.setVertexBytes(&uniforms, length: MemoryLayout<WebcamUniforms>.stride, index: 0)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<WebcamUniforms>.stride, index: 0)
        encoder.setFragmentTexture(texture, index: 0)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
    }

    /// Shared layout math — also used by `ExportCompositor` so the same
    /// formula produces identical pixels in both paths.
    static func webcamUniforms(
        for layout: WebcamLayout,
        contentScale: SIMD2<Float>,
        viewAspect: Float,
        texture: MTLTexture
    ) -> WebcamUniforms {
        let clamped = layout.clamped()
        let shortSide = min(contentScale.x, contentScale.y)
        let halfX = clamped.diameterNorm * shortSide
        // viewAspect = view width / view height. halfY is scaled so the
        // overlay renders visually circular regardless of canvas aspect.
        let halfY = halfX * viewAspect

        // Content rect in NDC is [-contentScale.x, contentScale.x] ×
        // [-contentScale.y, contentScale.y]. Map normalised [0,1] coords
        // into that — y inverted so 0 = top, 1 = bottom.
        let centerX = contentScale.x * (2 * clamped.centerXNorm - 1)
        let centerY = contentScale.y * (1 - 2 * clamped.centerYNorm)

        let srcAspect = Float(texture.width) / Float(texture.height)
        let uvScale: SIMD2<Float>
        if srcAspect > 1 {
            uvScale = SIMD2(1.0 / srcAspect, 1.0)
        } else {
            uvScale = SIMD2(1.0, srcAspect)
        }

        return WebcamUniforms(
            centerNDC: SIMD2(centerX, centerY),
            halfSizeNDC: SIMD2(halfX, halfY),
            textureUVScale: uvScale,
            textureUVOffset: SIMD2(0.5, 0.5),
            ringColor: SIMD4(1.0, 1.0, 1.0, 0.55),
            ringWidthNorm: 0.022
        )
    }

    /// Shared helper for one-off textures (e.g. webcam frames) — distinct
    /// from `updateFrame` which is the long-lived main video texture path.
    private func makeTexture(from buffer: CVPixelBuffer) -> MTLTexture? {
        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        var textureRef: CVMetalTexture?
        let status = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault, textureCache, buffer, nil,
            .bgra8Unorm, width, height, 0, &textureRef
        )
        guard status == kCVReturnSuccess, let textureRef = textureRef else { return nil }
        return CVMetalTextureGetTexture(textureRef)
    }

    // MARK: - Cursor textures

    private func cursorTexture(for shape: CursorShape) -> MTLTexture? {
        if let cached = cursorTextures[shape] { return cached }
        // Try named asset → tiff fallback → procedural fallback.
        let candidates = [shape.rawValue, "arrow"]
        for name in candidates {
            if let texture = loadAssetTexture(named: name) {
                cursorTextures[shape] = texture
                return texture
            }
        }
        // Procedural cursor as last resort — proves the pipeline works even
        // when the asset catalog is unreachable.
        if let texture = makeProceduralCursorTexture() {
            Log.editor.warning("Using procedural cursor — no asset texture loaded")
            cursorTextures[shape] = texture
            return texture
        }
        return nil
    }

    private func loadAssetTexture(named name: String) -> MTLTexture? {
        guard let image = NSImage(named: name) else {
            Log.editor.warning("NSImage(named:) returned nil for '\(name)' — asset catalog miss")
            return nil
        }
        let imageSize = image.size
        Log.editor.info("NSImage('\(name)') loaded, size=\(imageSize.width)x\(imageSize.height)")

        // ALWAYS normalise through a fresh sRGB CGContext with explicit
        // premultiplied-LAST alpha (RGBA byte order). Without this, the
        // TIFF-derived CGImage came back with alphaInfo=.premultipliedFirst
        // (ARGB) which MTKTextureLoader read at face value — the cursor came
        // out yellow because what the shader thought was R/G/B/A was
        // actually A/R/G/B.
        let w = max(1, Int(imageSize.width))
        let h = max(1, Int(imageSize.height))
        guard let cs = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(
                data: nil, width: w, height: h, bitsPerComponent: 8,
                bytesPerRow: 0, space: cs,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                    | CGBitmapInfo.byteOrder32Big.rawValue
              ) else {
            Log.editor.warning("Could not create CGContext for '\(name)'")
            return nil
        }
        // CGContext's underlying pixel storage is always bottom-up (row 0 =
        // bottom of bitmap). With flipped:false the NSImage draws in CG's
        // native coord system, so the image's top of the cursor ends up at
        // the top of memory but in bottom-up row order. We then tell the
        // texture loader the source is `.bottomLeft` so it flips Y on load
        // and the cursor ends up right-side-up in the Metal texture.
        let nsCtx = NSGraphicsContext(cgContext: ctx, flipped: false)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = nsCtx
        image.draw(in: NSRect(x: 0, y: 0, width: w, height: h),
                   from: .zero, operation: .copy, fraction: 1.0)
        NSGraphicsContext.restoreGraphicsState()
        guard let cg = ctx.makeImage() else {
            Log.editor.warning("ctx.makeImage failed for '\(name)'")
            return nil
        }

        let opts: [MTKTextureLoader.Option: Any] = [
            .SRGB: false,
            .origin: MTKTextureLoader.Origin.bottomLeft,
            .generateMipmaps: false
        ]
        if let tex = try? textureLoader.newTexture(cgImage: cg, options: opts) {
            Log.editor.info("Cursor '\(name)' loaded (normalised RGBA)")
            return tex
        }
        Log.editor.warning("All asset texture loads failed for '\(name)'")
        return nil
    }

    /// Draws a chunky magenta arrow into a CG bitmap so we ALWAYS have a
    /// cursor texture, even if every asset-catalog path fails.
    private func makeProceduralCursorTexture() -> MTLTexture? {
        let size = 128
        guard let cs = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(
                data: nil, width: size, height: size, bitsPerComponent: 8,
                bytesPerRow: 0, space: cs,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
              ) else {
            return nil
        }
        ctx.clear(CGRect(x: 0, y: 0, width: size, height: size))

        // Arrow path (top-left origin pre-flip; CGContext is bottom-left,
        // we flip to match a typical screen cursor).
        ctx.translateBy(x: 0, y: CGFloat(size))
        ctx.scaleBy(x: 1, y: -1)
        let path = CGMutablePath()
        path.move(to: CGPoint(x: 20, y: 14))
        path.addLine(to: CGPoint(x: 20, y: 102))
        path.addLine(to: CGPoint(x: 50, y: 76))
        path.addLine(to: CGPoint(x: 66, y: 110))
        path.addLine(to: CGPoint(x: 80, y: 102))
        path.addLine(to: CGPoint(x: 64, y: 70))
        path.addLine(to: CGPoint(x: 96, y: 70))
        path.closeSubpath()

        ctx.setFillColor(red: 1, green: 0, blue: 1, alpha: 1) // magenta
        ctx.addPath(path)
        ctx.fillPath()

        ctx.setLineWidth(4)
        ctx.setStrokeColor(red: 1, green: 1, blue: 1, alpha: 1)
        ctx.addPath(path)
        ctx.strokePath()

        guard let cg = ctx.makeImage() else { return nil }
        let opts: [MTKTextureLoader.Option: Any] = [
            .SRGB: false,
            .origin: MTKTextureLoader.Origin.topLeft,
            .generateMipmaps: false
        ]
        return try? textureLoader.newTexture(cgImage: cg, options: opts)
    }

    // MARK: - Aspect fit + uniforms

    private struct AspectUniforms { var scale: SIMD2<Float> }
    private struct ZoomUniforms {
        var centerUV: SIMD2<Float>
        var scale: Float
        var _pad: Float = 0
    }
    private struct CanvasUniforms {
        var contentScale: SIMD2<Float>
    }
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

    private func aspectFitScale() -> AspectUniforms {
        guard drawableSize.width > 0, drawableSize.height > 0,
              currentTextureSize.width > 0, currentTextureSize.height > 0 else {
            return AspectUniforms(scale: SIMD2(1, 1))
        }
        let drawableAspect = drawableSize.width / drawableSize.height
        let textureAspect = currentTextureSize.width / currentTextureSize.height
        if textureAspect > drawableAspect {
            let ratio = Float(drawableAspect / textureAspect)
            return AspectUniforms(scale: SIMD2(1, ratio))
        } else {
            let ratio = Float(textureAspect / drawableAspect)
            return AspectUniforms(scale: SIMD2(ratio, 1))
        }
    }
}

// MARK: - MTKViewDelegate

extension MetalRenderer: MTKViewDelegate {
    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
        drawableSize = size
    }

    func draw(in view: MTKView) {
        draw(view: view)
    }
}
