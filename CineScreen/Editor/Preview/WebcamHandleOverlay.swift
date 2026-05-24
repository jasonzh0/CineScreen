import SwiftUI

/// SwiftUI overlay that draws transparent drag + resize affordances on top of
/// the Metal preview. The circle the user actually sees is rendered by the
/// Metal pipeline — this view only handles input and the dashed editing
/// outline that appears while the user is interacting.
struct WebcamHandleOverlay: View {
    @Bindable var vm: EditorViewModel

    /// Set true while the user is mid-drag so we can show the dashed
    /// outline + resize handle without cluttering the canvas the rest of the
    /// time.
    @State private var isHovering = false
    @State private var isInteracting = false
    /// Layout snapshot taken at gesture start so each tick computes deltas
    /// against the original values rather than chaining.
    @State private var dragStartLayout: WebcamLayout?

    var body: some View {
        // Only show if the project has a webcam track and the user hasn't
        // hidden it.
        if vm.webcamPlayer != nil, vm.webcamLayout.enabled {
            GeometryReader { proxy in
                let rect = circleRect(in: proxy.size)
                let editing = isHovering || isInteracting
                ZStack(alignment: .topLeading) {
                    // Hit region matching the visible circle. Transparent —
                    // the actual pixels come from Metal underneath.
                    Circle()
                        .fill(Color.white.opacity(0.001))
                        .frame(width: rect.width, height: rect.height)
                        .position(x: rect.midX, y: rect.midY)
                        .overlay(
                            // Dashed outline while editing — gives the user a
                            // visible affordance without competing with the
                            // actual webcam pixels.
                            Circle()
                                .strokeBorder(
                                    Color.white.opacity(editing ? 0.85 : 0.0),
                                    style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])
                                )
                                .frame(width: rect.width, height: rect.height)
                                .position(x: rect.midX, y: rect.midY)
                                .allowsHitTesting(false)
                        )
                        .onHover { isHovering = $0 }
                        .gesture(
                            DragGesture(minimumDistance: 0)
                                .onChanged { value in
                                    if dragStartLayout == nil {
                                        dragStartLayout = vm.webcamLayout
                                        isInteracting = true
                                    }
                                    guard let start = dragStartLayout else { return }
                                    let dxNorm = Float(value.translation.width / proxy.size.width)
                                    let dyNorm = Float(value.translation.height / proxy.size.height)
                                    var next = start
                                    next.centerXNorm = start.centerXNorm + dxNorm
                                    next.centerYNorm = start.centerYNorm + dyNorm
                                    vm.setWebcamLayout(next)
                                }
                                .onEnded { _ in
                                    dragStartLayout = nil
                                    isInteracting = false
                                }
                        )

                    // Resize handle on the bottom-right of the circle's
                    // bounding box. Visible only while editing.
                    resizeHandle(rect: rect, viewSize: proxy.size, editing: editing)
                }
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
            }
            .allowsHitTesting(true)
        }
    }

    @ViewBuilder
    private func resizeHandle(rect: CGRect, viewSize: CGSize, editing: Bool) -> some View {
        // Place the handle on the 45° outer edge of the circle.
        let r = rect.width / 2
        let offset = r / CGFloat(2.0).squareRoot()  // r * sin(45°) = r/√2
        let cx = rect.midX + offset
        let cy = rect.midY + offset
        ZStack {
            Circle()
                .fill(Color.white)
                .overlay(
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(Color.black.opacity(0.65))
                )
                .frame(width: 18, height: 18)
                .shadow(color: .black.opacity(0.35), radius: 4, y: 1)
        }
        .opacity(editing ? 1.0 : 0.0)
        .animation(.easeInOut(duration: 0.12), value: editing)
        .position(x: cx, y: cy)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    if dragStartLayout == nil {
                        dragStartLayout = vm.webcamLayout
                        isInteracting = true
                    }
                    guard let start = dragStartLayout else { return }
                    // Translate the corner outward → grow the diameter.
                    // We project the drag onto the 45° axis so both up-left
                    // and down-right diagonals shrink/grow naturally.
                    let projected = (value.translation.width + value.translation.height) / 2
                    let shortSide = min(viewSize.width, viewSize.height)
                    let deltaNorm = Float((projected / shortSide) * 2)
                    var next = start
                    next.diameterNorm = start.diameterNorm + deltaNorm
                    vm.setWebcamLayout(next)
                }
                .onEnded { _ in
                    dragStartLayout = nil
                    isInteracting = false
                }
        )
    }

    /// Computes the on-screen pixel rect for the webcam circle from the
    /// current canvas style + layout. Mirrors `MetalRenderer.webcamUniforms`
    /// math but in SwiftUI points instead of NDC.
    private func circleRect(in size: CGSize) -> CGRect {
        let layout = vm.webcamLayout.clamped()
        let padding = Float(max(0, min(0.5, vm.canvasPadding)))
        let contentScaleX = 1.0 - padding * 2.0
        let contentScaleY = 1.0 - padding * 2.0  // Editor uses symmetric padding
        let shortSide = min(contentScaleX, contentScaleY)

        // halfX in NDC; with shared math the visual circle ends up with
        // pixelWidth = halfXNDC * viewW (since NDC width = 2 spans viewW).
        let halfXNDC = layout.diameterNorm * shortSide
        let pixelWidth = CGFloat(halfXNDC) * size.width
        // halfY = halfX * (viewW/viewH) → pixelHeight = halfY * viewH = halfX * viewW
        let pixelHeight = pixelWidth  // visually circular

        let centerXNDC = contentScaleX * (2 * layout.centerXNorm - 1)
        let centerYNDC = contentScaleY * (1 - 2 * layout.centerYNorm)
        let cx = (CGFloat(centerXNDC) + 1) * size.width / 2
        let cy = (1 - CGFloat(centerYNDC)) * size.height / 2

        return CGRect(
            x: cx - pixelWidth / 2,
            y: cy - pixelHeight / 2,
            width: pixelWidth,
            height: pixelHeight
        )
    }
}
