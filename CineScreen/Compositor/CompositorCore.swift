import Metal
import MetalKit
import AppKit

// MARK: - Shared GPU uniforms
//
// One definition for both compositor front-ends. Field order + sizes must
// match the structs in Shaders.metal; previously each front-end carried its
// own private mirror with "must match" comments as the only enforcement —
// three copies that could silently drift.

struct AspectUniforms {
    var scale: SIMD2<Float>
    var cropOrigin: SIMD2<Float> = .zero
    var cropSize: SIMD2<Float> = SIMD2(1, 1)
}

struct ZoomUniforms {
    var centerUV: SIMD2<Float>
    var scale: Float
    var _pad: Float = 0
}

struct CanvasUniforms {
    var contentScale: SIMD2<Float>
    var cornerRadiusUV: SIMD2<Float> = SIMD2(0.025, 0.025)
}

/// All SIMD2<Float> are 8-byte aligned, so the two trailing floats pack into
/// a single 8-byte slot — no explicit padding needed.
struct CursorUniforms {
    var cursorPos: SIMD2<Float>
    var videoSize: SIMD2<Float>
    var aspectScale: SIMD2<Float>
    var cropOrigin: SIMD2<Float> = .zero
    var cropSize: SIMD2<Float> = SIMD2(1, 1)
    var hotspot: SIMD2<Float>
    var motionBlur: SIMD2<Float>
    var size: Float
    var opacity: Float
}

struct ClickUniforms {
    var centerInVideoPixels: SIMD2<Float>
    var radiusInPixels: Float
    var thicknessInPixels: Float
    var videoSize: SIMD2<Float>
    var aspectScale: SIMD2<Float>
    var cropOrigin: SIMD2<Float> = .zero
    var cropSize: SIMD2<Float> = SIMD2(1, 1)
    var color: SIMD4<Float>
}

/// Circular webcam overlay uniforms. Field layout must match Shaders.metal.
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

// MARK: - Shared pipeline/quad factory

/// GPU layouts, geometry and pipeline creation used by FrameCompositor.
/// Keep uniform field order aligned with Shaders.metal.
enum CompositorCore {
    static func aspectUniforms(source: CGSize, destination: CGSize, crop: NormalizedCrop) -> AspectUniforms {
        let crop = crop.clamped()
        let width = max(1, source.width * crop.width)
        let height = max(1, source.height * crop.height)
        let sourceAspect = width / height
        let destinationAspect = max(1, destination.width) / max(1, destination.height)
        let fit: SIMD2<Float> = sourceAspect > destinationAspect
            ? SIMD2(1, Float(destinationAspect / sourceAspect))
            : SIMD2(Float(sourceAspect / destinationAspect), 1)
        return AspectUniforms(scale: fit,
                              cropOrigin: SIMD2(Float(crop.x), Float(crop.y)),
                              cropSize: SIMD2(Float(crop.width), Float(crop.height)))
    }

    static func canvasUniforms(style: CanvasStyle, source: CGSize, crop: NormalizedCrop) -> CanvasUniforms {
        let crop = crop.clamped()
        let width = max(1, source.width * crop.width), height = max(1, source.height * crop.height)
        let radiusPixels = min(width, height) * Double(min(0.15, max(0, style.cornerRadius)))
        let inset = min(0.45, max(0, style.padding))
        return CanvasUniforms(contentScale: SIMD2(repeating: 1 - 2 * inset),
                              cornerRadiusUV: SIMD2(Float(radiusPixels / width), Float(radiusPixels / height)))
    }

    static func zoomUniforms(zoom: ZoomState, crop: NormalizedCrop) -> ZoomUniforms {
        let crop = crop.clamped()
        let origin = SIMD2(Float(crop.x), Float(crop.y))
        let size = SIMD2(Float(crop.width), Float(crop.height))
        let neutral = origin + size * 0.5
        let progress = min(1, max(0, zoom.framingProgress))
        let sourceCenter = zoom.centerUV + (neutral - SIMD2<Float>(repeating: 0.5)) * (1 - progress)
        let scale = max(1, zoom.scale)
        let margin: Float = 0.5 / scale
        let center = (sourceCenter - origin) / size
        let bounded = SIMD2<Float>(min(1 - margin, max(margin, center.x)), min(1 - margin, max(margin, center.y)))
        return ZoomUniforms(centerUV: bounded, scale: scale)
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

    /// Computes ShadowUniforms tracking the recording's post-zoom geometry.
    /// Both the live preview and the export call this so they produce the
    /// same shadow shape, size, and position.
    static func makeShadowUniforms(
        aspect: SIMD2<Float>,
        canvasContentScale: SIMD2<Float>,
        zoom: ZoomState,
        strength: Float,
        style: CanvasStyle? = nil,
        viewportAspect: Float = 1
    ) -> ShadowUniforms {
        let safeScale = max(0.01, zoom.scale)
        let halfSize = aspect * canvasContentScale * safeScale
        let centerInQuad = SIMD2<Float>(zoom.centerUV.x * 2 - 1, 1 - zoom.centerUV.y * 2)
        let centerNDC = -centerInQuad * safeScale * aspect * canvasContentScale
        let viewAspect = max(0.01, viewportAspect)
        // Measure blur and rounding in physical pixels, not stretched NDC.
        let shortSide = min(halfSize.x, halfSize.y / viewAspect)
        let radius = min(0.15, max(0, style?.cornerRadius ?? Float(CanvasStyleConfig.default.resolvedCornerRadius))) * 2 * shortSide
        let softness = min(0.5, max(0.005, style?.shadowSoftness ?? Float(CanvasStyleConfig.default.resolvedShadowSoftness)))
        let distance = min(0.3, max(0, style?.shadowDistance ?? Float(CanvasStyleConfig.default.resolvedShadowDistance))) * 2 * shortSide
        let radians = (style?.shadowAngle ?? Float(CanvasStyleConfig.default.resolvedShadowAngle)) * .pi / 180
        return ShadowUniforms(
            centerNDC: centerNDC,
            halfSize: halfSize,
            offsetNDC: SIMD2(cos(radians) * distance, -sin(radians) * distance * viewAspect),
            blur: max(0.002, 2 * shortSide * softness),
            cornerRadius: radius,
            opacity: min(1, max(0, strength)),
            viewportAspect: viewAspect
        )
    }

    struct Pipelines {
        let background: MTLRenderPipelineState
        let shadow: MTLRenderPipelineState
        let video: MTLRenderPipelineState
        let cursor: MTLRenderPipelineState
        let click: MTLRenderPipelineState
        let webcam: MTLRenderPipelineState
    }

    /// Builds the six render pipelines against `pixelFormat`. Background is
    /// opaque (it overdraws the clear); everything else uses the shared
    /// source-alpha-over blend so masks and sprites composite identically in
    /// both paths.
    static func makePipelines(
        device: MTLDevice,
        library: MTLLibrary,
        pixelFormat: MTLPixelFormat,
        labelPrefix: String
    ) -> Pipelines? {
        func make(
            _ vertex: String, _ fragment: String,
            blended: Bool, label: String
        ) -> MTLRenderPipelineState? {
            guard let vertexFn = library.makeFunction(name: vertex),
                  let fragmentFn = library.makeFunction(name: fragment) else { return nil }
            let desc = MTLRenderPipelineDescriptor()
            desc.vertexFunction = vertexFn
            desc.fragmentFunction = fragmentFn
            desc.colorAttachments[0].pixelFormat = pixelFormat
            if blended {
                desc.colorAttachments[0].isBlendingEnabled = true
                desc.colorAttachments[0].rgbBlendOperation = .add
                desc.colorAttachments[0].alphaBlendOperation = .add
                desc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
                desc.colorAttachments[0].sourceAlphaBlendFactor = .one
                desc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
                desc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
            }
            desc.label = "\(labelPrefix).\(label)"
            return try? device.makeRenderPipelineState(descriptor: desc)
        }

        guard
            let background = make("background_vertex", "background_fragment", blended: false, label: "background"),
            let shadow = make("shadow_vertex", "shadow_fragment", blended: true, label: "shadow"),
            let video = make("video_vertex", "video_fragment", blended: true, label: "video"),
            let cursor = make("cursor_vertex", "cursor_fragment", blended: true, label: "cursor"),
            let click = make("click_vertex", "click_fragment", blended: true, label: "click"),
            let webcam = make("webcam_vertex", "webcam_fragment", blended: true, label: "webcam")
        else { return nil }

        return Pipelines(
            background: background, shadow: shadow, video: video,
            cursor: cursor, click: click, webcam: webcam
        )
    }

    /// Triangle-strip quad covering [-1,1]² with top-left-origin UVs.
    static func makeQuadBuffer(device: MTLDevice) -> MTLBuffer? {
        let quad: [SIMD4<Float>] = [
            SIMD4(-1, -1, 0, 1),
            SIMD4( 1, -1, 1, 1),
            SIMD4(-1,  1, 0, 0),
            SIMD4( 1,  1, 1, 0),
        ]
        return device.makeBuffer(
            bytes: quad,
            length: MemoryLayout<SIMD4<Float>>.stride * quad.count,
            options: .storageModeShared
        )
    }
}

// MARK: - Cursor sprite textures

/// Loads and caches cursor sprite textures with the normalised-RGBA pipeline
/// both compositors require: ALWAYS re-render the asset through a fresh sRGB
/// CGContext with explicit premultiplied-LAST alpha (RGBA byte order). The
/// TIFF-derived CGImage otherwise comes back premultipliedFirst (ARGB), which
/// MTKTextureLoader reads at face value — the cursor rendered yellow because
/// what the shader thought was R/G/B/A was actually A/R/G/B.
final class CursorTextureStore {
    private let textureLoader: MTKTextureLoader
    private var cache: [CursorShape: MTLTexture] = [:]

    init(device: MTLDevice) {
        self.textureLoader = MTKTextureLoader(device: device)
    }

    /// Named asset → arrow fallback → procedural fallback. Never returns nil
    /// unless even the procedural bitmap fails.
    func texture(for shape: CursorShape) -> MTLTexture? {
        if let cached = cache[shape] { return cached }
        let candidates = [shape.rawValue, "arrow"]
        for name in candidates {
            if let texture = loadAssetTexture(named: name) {
                cache[shape] = texture
                return texture
            }
        }
        if let texture = makeProceduralCursorTexture() {
            Log.editor.warning("Using procedural cursor — no asset texture loaded")
            cache[shape] = texture
            return texture
        }
        return nil
    }

    private func loadAssetTexture(named name: String) -> MTLTexture? {
        guard let image = NSImage(named: name) else {
            Log.editor.warning("NSImage(named:) returned nil for '\(name)' — asset catalog miss")
            return nil
        }
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
        // CGContext's pixel storage is bottom-up; with flipped:false the
        // NSImage draws in CG's native coords, and `.origin: .bottomLeft`
        // tells the loader to flip on load so the cursor lands right-side-up.
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

    /// Chunky magenta arrow drawn into a CG bitmap so there is ALWAYS a
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
        ctx.setFillColor(red: 1, green: 0, blue: 1, alpha: 1)
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
}
