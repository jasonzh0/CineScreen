import Foundation
import simd

/// What the renderer needs to draw a cursor overlay this frame.
struct CursorRenderState {
    /// The pointer's hot-spot location in **video pixel** coordinates
    /// (top-left origin) — i.e. where the real cursor actually pointed.
    var positionInVideoPixels: SIMD2<Float>
    /// Cursor sprite size in video pixels.
    var size: Float
    /// Opacity multiplier, 0..1.
    var opacity: Float
    var shape: CursorShape
    /// The sprite's hot spot as a normalized fraction of its artwork
    /// (top-left origin, `[0,1]²`). The sprite is positioned so this point
    /// lands on `positionInVideoPixels`, instead of the sprite centre.
    var hotspotUV: SIMD2<Float> = SIMD2(0.5, 0.5)
    /// Directional motion-blur vector in sprite-UV units (the fragment shader
    /// smears the sprite along it). Zero = no blur. Magnitude ≈ how far the
    /// cursor travels per frame, scaled by the user's motion-blur strength.
    var motionBlurUV: SIMD2<Float> = .zero
    /// Coordinate space of the recorded pointer telemetry.
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
    /// Blend from the neutral source-crop center during zoom transitions.
    var framingProgress: Float = 1

    static let identity = ZoomState(centerUV: SIMD2(0.5, 0.5), scale: 1.0, framingProgress: 0)
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
    /// Strength of the drop shadow, 0..1. 0 = off, 1 = very dark halo.
    var shadowStrength: Float = Float(CanvasStyleConfig.default.resolvedShadowStrength)
    var shadowSoftness: Float = Float(CanvasStyleConfig.default.resolvedShadowSoftness)
    var shadowDistance: Float = Float(CanvasStyleConfig.default.resolvedShadowDistance)
    var shadowAngle: Float = Float(CanvasStyleConfig.default.resolvedShadowAngle)
    var cornerRadius: Float = Float(CanvasStyleConfig.default.resolvedCornerRadius)

    static let none = CanvasStyle(
        padding: 0,
        background: .solid("#000000"),
        dropShadow: false,
        shadowStrength: 0
    )
}

/// All visual inputs for one frame, sampled at one source timestamp.
/// GPU adapters supply textures and destinations separately.
struct CompositionState {
    var cursor: CursorRenderState? = nil
    var clicks: [ClickRingState] = []
    var zoom: ZoomState = .identity
    var canvas: CanvasStyle = .none
    var output: OutputSettings = .default
    var webcamLayout: WebcamLayout = .default
}

extension CanvasStyleConfig {
    var renderStyle: CanvasStyle {
        CanvasStyle(padding: Float(padding), background: background, dropShadow: dropShadow,
                    shadowStrength: Float(resolvedShadowStrength), shadowSoftness: Float(resolvedShadowSoftness),
                    shadowDistance: Float(resolvedShadowDistance), shadowAngle: Float(resolvedShadowAngle),
                    cornerRadius: Float(resolvedCornerRadius))
    }
}
