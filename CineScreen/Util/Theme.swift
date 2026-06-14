import SwiftUI
import AppKit

// =============================================================================
// CineScreen design system — "Cinema Noir"
// =============================================================================
//
// One source of truth for colour, metrics, gradients, and reusable controls so
// every surface (projects, editor, timeline, control bar, onboarding, settings)
// reads as one app. The aesthetic is a refined, filmic dark theme:
//
//   • warm near-black layered surfaces (shadows, not slate)
//   • GOLD  — the primary interactive accent (selection, sliders, CTAs)
//   • CORAL — reserved for the record button + destructive actions
//   • TEAL  — the cool counterpoint for data (zoom track, webcam ring)
//
// gold + coral + teal is a deliberate cinematic "teal & orange" grade.

enum CTheme {

    // MARK: - Brand & accents

    /// Record / destructive. The signature CineScreen coral-red.
    static let brand      = Color(red: 0.95, green: 0.33, blue: 0.27)
    static let brandDeep  = Color(red: 0.74, green: 0.16, blue: 0.19)

    /// Primary interactive accent — warm gold. Selection, sliders, CTAs.
    static let accent     = Color(red: 0.98, green: 0.74, blue: 0.38)
    static let accentDeep = Color(red: 0.92, green: 0.56, blue: 0.20)

    /// Cool counterpoint — teal. Zoom track, webcam ring, secondary data.
    static let teal       = Color(red: 0.36, green: 0.80, blue: 0.83)
    static let tealDeep   = Color(red: 0.20, green: 0.58, blue: 0.66)

    /// Semantic.
    static let positive   = Color(red: 0.44, green: 0.85, blue: 0.58)
    static let warning    = Color(red: 0.97, green: 0.80, blue: 0.38)
    static let danger     = brand

    // MARK: - Surfaces (warm near-black)

    static let bgTop      = Color(red: 0.088, green: 0.078, blue: 0.086)
    static let bgBottom   = Color(red: 0.034, green: 0.029, blue: 0.038)
    /// Flat editor canvas / panel base (opaque so Metal/AppKit siblings match).
    static let panel      = Color(red: 0.072, green: 0.066, blue: 0.074)
    static let panelDeep  = Color(red: 0.050, green: 0.045, blue: 0.052)

    static let surface    = Color.white.opacity(0.045)   // resting card fill
    static let surfaceHi  = Color.white.opacity(0.075)   // hovered / elevated
    static let surfaceLo  = Color.white.opacity(0.025)

    static let stroke     = Color.white.opacity(0.08)
    static let strokeHi   = Color.white.opacity(0.16)

    // MARK: - Text

    static let textPrimary   = Color.white.opacity(0.95)
    static let textSecondary = Color.white.opacity(0.60)
    static let textTertiary  = Color.white.opacity(0.38)

    // MARK: - Metrics

    enum Radius {
        static let xs: CGFloat = 5
        static let sm: CGFloat = 8
        static let md: CGFloat = 11
        static let lg: CGFloat = 14
        static let xl: CGFloat = 18
    }

    // MARK: - Gradients

    static var windowBackground: LinearGradient {
        LinearGradient(colors: [bgTop, bgBottom], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
    static var accentGradient: LinearGradient {
        LinearGradient(colors: [accent, accentDeep], startPoint: .top, endPoint: .bottom)
    }
    static var brandGradient: LinearGradient {
        LinearGradient(colors: [brand, brandDeep], startPoint: .top, endPoint: .bottom)
    }
    static var tealGradient: LinearGradient {
        LinearGradient(colors: [teal, tealDeep], startPoint: .top, endPoint: .bottom)
    }
}

// =============================================================================
// Atmosphere — backdrop, vignette, film grain
// =============================================================================

/// The full-window cinematic backdrop: warm gradient + a soft top-center glow
/// + corner vignette + a whisper of film grain. Drop behind any root view.
struct CineBackdrop: View {
    /// Tint of the top glow. Defaults to the brand coral.
    var glow: Color = CTheme.brand
    var glowStrength: Double = 0.16

    var body: some View {
        ZStack {
            CTheme.windowBackground
            RadialGradient(
                colors: [glow.opacity(glowStrength), .clear],
                center: .top, startRadius: 0, endRadius: 620
            )
            .blendMode(.plusLighter)
            CineVignette()
            FilmGrain(opacity: 0.05)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

/// Radial darkening toward the corners — the single most effective way to make
/// a flat dark UI feel like a lit scene rather than a void.
struct CineVignette: View {
    var strength: Double = 0.55
    var body: some View {
        RadialGradient(
            colors: [.clear, .black.opacity(strength)],
            center: .center, startRadius: 240, endRadius: 900
        )
        .blendMode(.multiply)
        .allowsHitTesting(false)
    }
}

/// A static, tiled monochrome noise texture at very low opacity. Generated once
/// and cached, then tiled — cheap, and it kills the "plastic gradient" look.
struct FilmGrain: View {
    var opacity: Double = 0.05

    var body: some View {
        Image(nsImage: FilmGrain.texture)
            .resizable(resizingMode: .tile)
            .opacity(opacity)
            .blendMode(.overlay)
            .allowsHitTesting(false)
    }

    /// 128×128 grayscale noise, built once.
    static let texture: NSImage = {
        let side = 128
        var rng = SystemRandomNumberGenerator()
        let bytesPerRow = side * 4
        var data = [UInt8](repeating: 0, count: bytesPerRow * side)
        for i in stride(from: 0, to: data.count, by: 4) {
            let v = UInt8.random(in: 90...165, using: &rng)
            data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
        }
        let cs = CGColorSpaceCreateDeviceRGB()
        let ctx = CGContext(
            data: &data, width: side, height: side, bitsPerComponent: 8,
            bytesPerRow: bytesPerRow, space: cs,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
        guard let cg = ctx?.makeImage() else { return NSImage(size: NSSize(width: side, height: side)) }
        return NSImage(cgImage: cg, size: NSSize(width: side, height: side))
    }()
}

// =============================================================================
// Reusable modifiers
// =============================================================================

/// Standard card chrome: translucent fill + hairline stroke + rounded corners.
struct CineCard: ViewModifier {
    var radius: CGFloat = CTheme.Radius.md
    var fill: Color = CTheme.surface
    var stroke: Color = CTheme.stroke
    var strokeWidth: CGFloat = 1

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous).fill(fill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(stroke, lineWidth: strokeWidth)
            )
    }
}

/// Hover lift: subtle scale used on interactive cards and CTAs.
struct CineHover: ViewModifier {
    var scale: CGFloat = 1.02
    var lift: CGFloat = 0
    @State private var hovering = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(hovering ? scale : 1)
            .offset(y: hovering ? -lift : 0)
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: hovering)
            .onHover { hovering = $0 }
    }
}

extension View {
    func cineCard(
        radius: CGFloat = CTheme.Radius.md,
        fill: Color = CTheme.surface,
        stroke: Color = CTheme.stroke,
        strokeWidth: CGFloat = 1
    ) -> some View {
        modifier(CineCard(radius: radius, fill: fill, stroke: stroke, strokeWidth: strokeWidth))
    }

    func cineHover(scale: CGFloat = 1.02, lift: CGFloat = 0) -> some View {
        modifier(CineHover(scale: scale, lift: lift))
    }
}

// =============================================================================
// Button styles
// =============================================================================

/// Filled pill/rounded CTA. `palette` chooses the fill + glow colour so the
/// gold (primary), coral (record), and teal variants share one implementation.
struct CineFilledButtonStyle: ButtonStyle {
    enum Palette { case accent, record, teal }

    var palette: Palette = .accent
    var shape: ButtonShape = .capsule
    var font: Font = .system(size: 13, weight: .semibold)
    var hPad: CGFloat = 20
    var vPad: CGFloat = 11
    var glow: Bool = true

    enum ButtonShape { case capsule, rounded(CGFloat) }

    func makeBody(configuration: Configuration) -> some View {
        let g: LinearGradient
        let glowColor: Color
        switch palette {
        case .accent: g = CTheme.accentGradient; glowColor = CTheme.accent
        case .record: g = CTheme.brandGradient;  glowColor = CTheme.brand
        case .teal:   g = CTheme.tealGradient;   glowColor = CTheme.teal
        }
        // Gold/teal read better with near-black text; coral with white.
        let fg: Color = palette == .record ? .white : Color.black.opacity(0.88)
        return configuration.label
            .font(font)
            .foregroundStyle(fg)
            .padding(.horizontal, hPad)
            .padding(.vertical, vPad)
            .background(filledShape(g))
            .overlay(strokeOverlay)
            .shadow(color: glow ? glowColor.opacity(0.40) : .clear,
                    radius: 14, x: 0, y: 6)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }

    @ViewBuilder private func filledShape(_ g: LinearGradient) -> some View {
        switch shape {
        case .capsule: Capsule().fill(g)
        case .rounded(let r): RoundedRectangle(cornerRadius: r, style: .continuous).fill(g)
        }
    }

    @ViewBuilder private var strokeOverlay: some View {
        switch shape {
        case .capsule:
            Capsule().strokeBorder(Color.white.opacity(0.22), lineWidth: 1)
        case .rounded(let r):
            RoundedRectangle(cornerRadius: r, style: .continuous)
                .strokeBorder(Color.white.opacity(0.22), lineWidth: 1)
        }
    }
}

/// Translucent neutral button — secondary actions, "Back", inline controls.
struct CineGhostButtonStyle: ButtonStyle {
    var shape: CineFilledButtonStyle.ButtonShape = .capsule
    var font: Font = .system(size: 12.5, weight: .medium)
    var hPad: CGFloat = 14
    var vPad: CGFloat = 8

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(font)
            .foregroundStyle(CTheme.textPrimary)
            .padding(.horizontal, hPad)
            .padding(.vertical, vPad)
            .background(fill(configuration.isPressed))
            .overlay(strokeOverlay)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }

    @ViewBuilder private func fill(_ pressed: Bool) -> some View {
        let c = Color.white.opacity(pressed ? 0.14 : 0.06)
        switch shape {
        case .capsule: Capsule().fill(c)
        case .rounded(let r): RoundedRectangle(cornerRadius: r, style: .continuous).fill(c)
        }
    }

    @ViewBuilder private var strokeOverlay: some View {
        switch shape {
        case .capsule:
            Capsule().strokeBorder(CTheme.stroke, lineWidth: 1)
        case .rounded(let r):
            RoundedRectangle(cornerRadius: r, style: .continuous).strokeBorder(CTheme.stroke, lineWidth: 1)
        }
    }
}

// =============================================================================
// Small shared components
// =============================================================================

/// A square "icon chip" — a tinted rounded square holding an SF Symbol. Used in
/// card headers, permission rows, and section labels for a consistent rhythm.
struct CineIconChip: View {
    var symbol: String
    var tint: Color = CTheme.accent
    var size: CGFloat = 26
    var filledTint: Bool = false

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(tint.opacity(filledTint ? 0.9 : 0.14))
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: symbol)
                    .font(.system(size: size * 0.5, weight: .semibold))
                    .foregroundStyle(filledTint ? Color.black.opacity(0.85) : tint)
            )
    }
}
