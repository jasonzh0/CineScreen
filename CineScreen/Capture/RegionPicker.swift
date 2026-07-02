import AppKit
import SwiftUI

/// Full-screen selection overlay for area recording. Presents a dimmed
/// crosshair layer over the primary display; the user drags out a rectangle
/// and releases to confirm (Esc cancels). Returns the selection in **display
/// pixels, top-left origin** — the space `CaptureRequest.region` expects.
///
/// Scoped to the primary display, matching `CaptureRequest.displayID`'s
/// default: the capture engine records the region from that display, so
/// offering the picker elsewhere would select content the engine won't see.
@MainActor
final class RegionPicker {
    static let shared = RegionPicker()

    private var window: NSWindow?
    private var keyMonitor: Any?
    private var continuation: CheckedContinuation<CGRect?, Never>?

    func pick() async -> CGRect? {
        // A pending pick being re-entered means the previous one is stale.
        finish(with: nil)

        guard let screen = NSScreen.screens.first(where: { $0.frame.origin == .zero })
                ?? NSScreen.screens.first else { return nil }
        let scale = screen.backingScaleFactor

        let selection = RegionSelectionView(
            onSelect: { [weak self] rectPoints in
                // View-local top-left points == display top-left points (the
                // window covers exactly the primary screen). Convert to the
                // pixel space the capture engine slices with; dimensions are
                // rounded down to even so the stream size matches the
                // encoder's even-ized inputs.
                let pixels = CGRect(
                    x: (rectPoints.minX * scale).rounded(.down),
                    y: (rectPoints.minY * scale).rounded(.down),
                    width: (rectPoints.width * scale / 2).rounded(.down) * 2,
                    height: (rectPoints.height * scale / 2).rounded(.down) * 2
                )
                self?.finish(with: pixels)
            },
            onCancel: { [weak self] in self?.finish(with: nil) }
        )

        let window = NSWindow(
            contentRect: screen.frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isOpaque = false
        window.backgroundColor = .clear
        window.level = .screenSaver
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: selection)
        self.window = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        NSCursor.crosshair.push()

        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 {  // Esc
                self?.finish(with: nil)
                return nil
            }
            return event
        }

        return await withCheckedContinuation { continuation = $0 }
    }

    private func finish(with rect: CGRect?) {
        if let monitor = keyMonitor { NSEvent.removeMonitor(monitor) }
        keyMonitor = nil
        if window != nil { NSCursor.pop() }
        window?.orderOut(nil)
        window = nil
        let cont = continuation
        continuation = nil
        cont?.resume(returning: rect)
    }
}

/// The dimmed drag-to-select layer. Confirms on mouse-up when the selection
/// is at least 40×40 points; smaller drags reset so a stray click doesn't
/// start a sliver recording.
private struct RegionSelectionView: View {
    var onSelect: (CGRect) -> Void
    var onCancel: () -> Void

    @State private var start: CGPoint?
    @State private var current: CGPoint?

    private var selectionRect: CGRect? {
        guard let start, let current else { return nil }
        return CGRect(
            x: min(start.x, current.x),
            y: min(start.y, current.y),
            width: abs(current.x - start.x),
            height: abs(current.y - start.y)
        )
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                // Dim everything except the selection (even-odd hole).
                Path { path in
                    path.addRect(CGRect(origin: .zero, size: proxy.size))
                    if let rect = selectionRect { path.addRect(rect) }
                }
                .fill(Color.black.opacity(0.35), style: FillStyle(eoFill: true))

                if let rect = selectionRect {
                    Rectangle()
                        .strokeBorder(Color.white.opacity(0.9), lineWidth: 1.5)
                        .frame(width: rect.width, height: rect.height)
                        .offset(x: rect.minX, y: rect.minY)
                    Text("\(Int(rect.width)) × \(Int(rect.height))")
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 5))
                        .offset(x: rect.minX, y: max(0, rect.minY - 28))
                } else {
                    Text("Drag to select an area — Esc to cancel")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(.black.opacity(0.7), in: Capsule())
                        .frame(maxWidth: .infinity)
                        .offset(y: 60)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 2)
                    .onChanged { value in
                        if start == nil { start = value.startLocation }
                        current = value.location
                    }
                    .onEnded { _ in
                        if let rect = selectionRect, rect.width >= 40, rect.height >= 40 {
                            onSelect(rect)
                        } else {
                            start = nil
                            current = nil
                        }
                    }
            )
        }
        .ignoresSafeArea()
    }
}
