import Foundation
import simd

/// A color stop on a canvas gradient. `position` is 0..1 along the gradient axis.
struct GradientStop: Hashable, Sendable, Codable {
    var color: SIMD4<Float>
    var position: Float

    // SIMD4<Float> isn't Codable out of the box — encode/decode as four floats.
    enum CodingKeys: String, CodingKey { case r, g, b, a, position }

    init(color: SIMD4<Float>, position: Float) {
        self.color = color
        self.position = position
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let r = try c.decode(Float.self, forKey: .r)
        let g = try c.decode(Float.self, forKey: .g)
        let b = try c.decode(Float.self, forKey: .b)
        let a = try c.decode(Float.self, forKey: .a)
        self.color = SIMD4(r, g, b, a)
        self.position = try c.decode(Float.self, forKey: .position)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(color.x, forKey: .r)
        try c.encode(color.y, forKey: .g)
        try c.encode(color.z, forKey: .b)
        try c.encode(color.w, forKey: .a)
        try c.encode(position, forKey: .position)
    }
}

/// Canvas background — supports 1-stop (solid) through 4-stop linear gradients.
/// `angleDegrees` is the gradient direction: 0 = left→right, 90 = top→bottom,
/// 135 = top-left → bottom-right.
struct CanvasBackground: Hashable, Sendable, Codable {
    var stops: [GradientStop]
    var angleDegrees: Float

    static func solid(_ hex: String) -> CanvasBackground {
        .init(
            stops: [GradientStop(color: RenderSnapshot.parseHexColor(hex), position: 0)],
            angleDegrees: 0
        )
    }

    static func linear(_ hexes: [String], angle: Float = 135) -> CanvasBackground {
        let count = hexes.count
        let stops: [GradientStop] = hexes.enumerated().map { i, hex in
            GradientStop(
                color: RenderSnapshot.parseHexColor(hex),
                position: count == 1 ? 0 : Float(i) / Float(count - 1)
            )
        }
        return .init(stops: stops, angleDegrees: angle)
    }

    /// First stop colour — used as the clear colour so the screen-edge gutter
    /// matches the visible top-left of the gradient.
    var firstColor: SIMD4<Float> {
        stops.first?.color ?? SIMD4(0, 0, 0, 1)
    }
}

extension CanvasBackground {
    /// Screen-Studio-style preset palette. The first two are intentionally
    /// neutral solids so users can stay subtle.
    static let presets: [(name: String, bg: CanvasBackground)] = [
        ("Dark",     .solid("#1a1a1a")),
        ("Light",    .solid("#f4f4f4")),
        ("Sunset",   .linear(["#ff6b9d", "#ff8c5a", "#c870ff"], angle: 135)),
        ("Aurora",   .linear(["#5ec5e9", "#7c6ddb", "#c25fd1"], angle: 135)),
        ("Peach",    .linear(["#ffecd2", "#fcb69f"], angle: 135)),
        ("Lavender", .linear(["#a18cd1", "#fbc2eb"], angle: 135)),
        ("Sky",      .linear(["#6dd5ed", "#2193b0"], angle: 180)),
        ("Mint",     .linear(["#a8edea", "#4ad6c4"], angle: 135)),
        ("Forest",   .linear(["#0ba360", "#3cba92"], angle: 135)),
        ("Crimson",  .linear(["#cb2d3e", "#ef473a"], angle: 135)),
        ("Cosmic",   .linear(["#7028e4", "#e5b2ca"], angle: 135)),
        ("Mono",     .linear(["#434343", "#000000"], angle: 180)),
    ]
}

/// Flat Swift layout matching the Metal `ShadowUniforms` struct.
struct ShadowUniforms {
    var centerNDC: SIMD2<Float>
    var halfSize: SIMD2<Float>
    var blur: Float
    var yOffset: Float
    var cornerRadius: Float
    var opacity: Float
}

/// Flat Swift layout matching the Metal `BackgroundUniforms` struct.
struct BackgroundUniforms {
    var stop0: SIMD4<Float>
    var stop1: SIMD4<Float>
    var stop2: SIMD4<Float>
    var stop3: SIMD4<Float>
    var stopPositions: SIMD4<Float>
    var angleRadians: Float
    var stopCount: Int32
    var pad0: Float = 0
    var pad1: Float = 0
}

extension BackgroundUniforms {
    init(_ bg: CanvasBackground) {
        let n = min(4, max(1, bg.stops.count))
        var colors = [SIMD4<Float>](repeating: bg.firstColor, count: 4)
        var positions = SIMD4<Float>(0, 0, 0, 0)
        for i in 0..<n {
            colors[i] = bg.stops[i].color
            positions[i] = bg.stops[i].position
        }
        self.init(
            stop0: colors[0],
            stop1: colors[1],
            stop2: colors[2],
            stop3: colors[3],
            stopPositions: positions,
            angleRadians: bg.angleDegrees * .pi / 180,
            stopCount: Int32(n)
        )
    }
}
