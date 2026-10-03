import Foundation

struct NormalizedCrop: Codable, Equatable {
    var x: Double = 0
    var y: Double = 0
    var width: Double = 1
    var height: Double = 1
    static let full = NormalizedCrop()

    func clamped() -> NormalizedCrop {
        let w = width.isFinite ? min(1, max(0.05, width)) : 1
        let h = height.isFinite ? min(1, max(0.05, height)) : 1
        return NormalizedCrop(x: x.isFinite ? min(1 - w, max(0, x)) : 0,
                              y: y.isFinite ? min(1 - h, max(0, y)) : 0,
                              width: w, height: h)
    }
}

enum OutputAspectRatio: String, Codable, CaseIterable, Identifiable {
    case original, wide, square, vertical, classic, tall
    var id: String { rawValue }
    var ratio: Double? {
        switch self {
        case .original: return nil
        case .wide: return 16.0 / 9
        case .square: return 1
        case .vertical: return 9.0 / 16
        case .classic: return 4.0 / 3
        case .tall: return 4.0 / 5
        }
    }
    var label: String {
        switch self {
        case .original: return "Original"
        case .wide: return "16:9 · Wide"
        case .square: return "1:1 · Square"
        case .vertical: return "9:16 · Vertical"
        case .classic: return "4:3 · Classic"
        case .tall: return "4:5 · Portrait"
        }
    }
}

struct OutputSettings: Codable, Equatable {
    var aspectRatio: OutputAspectRatio = .original
    var crop: NormalizedCrop = .full
    var frameRate: Int = 60
    var audioGain: Double = 1
    var audioMuted: Bool = false
    static let `default` = OutputSettings()

    func dimensions(sourceWidth: Int, sourceHeight: Int) -> (width: Int, height: Int) {
        let geometry = OutputGeometry(sourceWidth: sourceWidth, sourceHeight: sourceHeight, settings: self)
        return (geometry.width, geometry.height)
    }

    var effectiveFrameRate: Int { min(120, max(1, frameRate)) }
    var effectiveAudioGain: Float {
        audioMuted ? 0 : Float(audioGain.isFinite ? min(2, max(0, audioGain)) : 1)
    }
}

/// Even encoder dimensions; the longer source dimension is the resolution
/// budget for aspect presets. A crop changes content, not its coordinates.
struct OutputGeometry: Equatable {
    let width: Int
    let height: Int

    init(sourceWidth: Int, sourceHeight: Int, settings: OutputSettings = .default, scale: Double = 1) {
        let crop = settings.crop.clamped()
        let croppedW = Double(max(2, sourceWidth)) * crop.width
        let croppedH = Double(max(2, sourceHeight)) * crop.height
        let ratio = settings.aspectRatio.ratio ?? (croppedW / croppedH)
        let longest = max(croppedW, croppedH)
        let w = ratio >= 1 ? longest : longest * ratio
        let h = ratio >= 1 ? longest / ratio : longest
        let factor = scale.isFinite ? min(1, max(0.1, scale)) : 1
        width = max(2, Int(w * factor) / 2 * 2)
        height = max(2, Int(h * factor) / 2 * 2)
    }
}
