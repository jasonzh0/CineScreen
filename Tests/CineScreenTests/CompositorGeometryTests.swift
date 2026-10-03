import XCTest
import simd
@testable import CineScreen

final class CompositorGeometryTests: XCTestCase {
    func testAsymmetricCropKeepsIdentityCenteredAndFitsCroppedAspect() {
        let crop = NormalizedCrop(x: 0.1, y: 0.2, width: 0.6, height: 0.5)
        let aspect = CompositorCore.aspectUniforms(
            source: CGSize(width: 2000, height: 1000),
            destination: CGSize(width: 1000, height: 1000), crop: crop
        )
        XCTAssertEqual(aspect.cropOrigin, SIMD2(0.1, 0.2))
        XCTAssertEqual(aspect.cropSize, SIMD2(0.6, 0.5))
        XCTAssertEqual(aspect.scale.x, 1)
        XCTAssertEqual(aspect.scale.y, 500.0 / 1200, accuracy: 0.0001)
        let zoom = CompositorCore.zoomUniforms(zoom: .identity, crop: crop)
        XCTAssertEqual(zoom.centerUV.x, 0.5, accuracy: 0.0001)
        XCTAssertEqual(zoom.centerUV.y, 0.5, accuracy: 0.0001)
        XCTAssertEqual(zoom.scale, 1)
    }

    func testCropZoomUsesSourceTargetAndContinuousNeutralBlend() {
        let crop = NormalizedCrop(x: 0.1, y: 0.2, width: 0.6, height: 0.5)
        let sourceTarget = SIMD2<Float>(0.55, 0.4)
        let neutral = SIMD2<Float>(0.4, 0.45)
        for progress in [Float(0), 0.25, 0.5, 0.75, 1] {
            let state = ZoomState(
                centerUV: SIMD2<Float>(repeating: 0.5) + (sourceTarget - SIMD2<Float>(repeating: 0.5)) * progress,
                scale: 1 + progress, framingProgress: progress
            )
            let zoom = CompositorCore.zoomUniforms(zoom: state, crop: crop)
            let sourceCenter = SIMD2<Float>(0.1, 0.2) + zoom.centerUV * SIMD2<Float>(0.6, 0.5)
            let expected = neutral + (sourceTarget - neutral) * progress
            XCTAssertEqual(sourceCenter.x, expected.x, accuracy: 0.0001)
            XCTAssertEqual(sourceCenter.y, expected.y, accuracy: 0.0001)
        }
    }

    func testCornerRadiusIsCircularInCroppedPixelSpace() {
        var style = CanvasStyle.none
        style.padding = 0.1
        style.cornerRadius = 0.1
        let canvas = CompositorCore.canvasUniforms(
            style: style, source: CGSize(width: 2000, height: 1000),
            crop: NormalizedCrop(x: 0.1, y: 0, width: 0.6, height: 0.5)
        )
        XCTAssertEqual(canvas.contentScale, SIMD2(repeating: 0.8))
        XCTAssertEqual(canvas.cornerRadiusUV.x * 1200, 50, accuracy: 0.001)
        XCTAssertEqual(canvas.cornerRadiusUV.y * 500, 50, accuracy: 0.001)
        style.cornerRadius = 0
        XCTAssertEqual(CompositorCore.canvasUniforms(style: style, source: CGSize(width: 2000, height: 1000), crop: .full).cornerRadiusUV, .zero)
    }

    func testZoomOutsideCropStaysWithinVisibleCropBounds() {
        let crop = NormalizedCrop(x: 0.1, y: 0.1, width: 0.2, height: 0.3)
        for scale in [Float(1), 1.25, 2, 4] {
            for target in [SIMD2<Float>(0, 0), SIMD2<Float>(1, 1)] {
                let zoom = CompositorCore.zoomUniforms(
                    zoom: ZoomState(centerUV: target, scale: scale), crop: crop
                )
                let margin: Float = 0.5 / scale
                XCTAssertGreaterThanOrEqual(zoom.centerUV.x, margin)
                XCTAssertGreaterThanOrEqual(zoom.centerUV.y, margin)
                XCTAssertLessThanOrEqual(zoom.centerUV.x, 1 - margin)
                XCTAssertLessThanOrEqual(zoom.centerUV.y, 1 - margin)
                if scale == 1 { XCTAssertEqual(zoom.centerUV, SIMD2(repeating: 0.5)) }
            }
        }
    }

    func testShadowDirectionAndPhysicalMetricsOnWideCanvas() {
        var style = CanvasStyle.none
        style.shadowDistance = 0.1
        style.shadowSoftness = 0.2
        style.shadowAngle = 45
        let shadow = CompositorCore.makeShadowUniforms(
            aspect: SIMD2(1, 1), canvasContentScale: SIMD2(repeating: 0.8),
            zoom: .identity, strength: 0.3, style: style, viewportAspect: 2
        )
        XCTAssertEqual(shadow.centerNDC, .zero)
        XCTAssertGreaterThan(shadow.offsetNDC.x, 0)
        XCTAssertLessThan(shadow.offsetNDC.y, 0)
        // Shader measures x in viewport-width units and y / viewportAspect.
        XCTAssertEqual(shadow.offsetNDC.x, -shadow.offsetNDC.y / 2, accuracy: 0.0001)
        XCTAssertEqual(shadow.blur, 0.16, accuracy: 0.0001)
        XCTAssertEqual(shadow.cornerRadius, 0.02, accuracy: 0.0001)
        XCTAssertEqual(shadow.viewportAspect, 2)
        style.shadowAngle = 90
        let downward = CompositorCore.makeShadowUniforms(
            aspect: SIMD2(1, 1), canvasContentScale: SIMD2(repeating: 0.8),
            zoom: .identity, strength: 0.3, style: style, viewportAspect: 2
        )
        XCTAssertEqual(downward.offsetNDC.x, 0, accuracy: 0.0001)
        XCTAssertLessThan(downward.offsetNDC.y, 0)
    }

    func testGPUUniformStridesMatchShaderABI() {
        XCTAssertEqual(MemoryLayout<AspectUniforms>.stride, 24)
        XCTAssertEqual(MemoryLayout<CanvasUniforms>.stride, 16)
        XCTAssertEqual(MemoryLayout<ZoomUniforms>.stride, 16)
        XCTAssertEqual(MemoryLayout<CursorUniforms>.stride, 64)
        XCTAssertEqual(MemoryLayout<ClickUniforms>.stride, 64)
        XCTAssertEqual(MemoryLayout<ShadowUniforms>.stride, 40)
        XCTAssertEqual(MemoryLayout<BackgroundUniforms>.stride, 112)
        XCTAssertEqual(MemoryLayout<WebcamUniforms>.stride, 64)
    }
}
