import Foundation

/// A reusable personal look, without recording-specific times or cursor events.
struct LookPreset: Codable, Identifiable {
    var id = UUID()
    var name: String
    var canvas: CanvasStyleConfig
    var cursor: CursorConfig
    var zoom: ZoomConfig
    var effects: MouseEffectsConfig?
    var webcam: WebcamLayout
    var output: OutputSettings
}
