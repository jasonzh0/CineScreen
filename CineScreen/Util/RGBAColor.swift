import simd

/// Shared color decoding for backgrounds, effect sampling and UI controls.
enum RGBAColor {
    static func parseHex(_ hex: String) -> SIMD4<Float> {
        var s = hex
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else {
            return SIMD4(1, 1, 1, 1)
        }
        let r = Float((v >> 16) & 0xff) / 255
        let g = Float((v >> 8) & 0xff) / 255
        let b = Float(v & 0xff) / 255
        return SIMD4(r, g, b, 1)
    }

}
