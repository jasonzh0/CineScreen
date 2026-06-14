import AppKit
import SwiftUI

/// Floating "Start a Recording" bar — mirror of the screenshot the user
/// shared. Shows mode buttons (Display / Window / Area / Device), audio
/// toggles, and a settings dropdown. Disappears when recording begins (the
/// in-progress RecordingBar takes over).
@MainActor
final class ControlBarController {
    static let shared = ControlBarController()

    private var panel: NSPanel?

    func show(state: AppState) {
        if panel == nil {
            panel = makePanel(state: state)
        }
        positionAtBottomCenter()
        panel?.orderFrontRegardless()
        Log.app.info("ControlBar shown")
    }

    func hide() {
        panel?.orderOut(nil)
    }

    private func makePanel(state: AppState) -> NSPanel {
        let onDismiss: () -> Void = { [weak self] in self?.hide() }
        let onStartRecording: () -> Void = { [weak self] in
            self?.hide()
            // Floating recording HUD (timer + Stop/Cancel). It's excluded from
            // the capture by ScreenCaptureService, so it can safely float over
            // the screen — unlike the old menu-bar dot, it's impossible to miss.
            RecordingBarController.shared.show(state: state)
        }
        let content = ControlBarView(
            state: state,
            onDismiss: onDismiss,
            onStartRecording: onStartRecording
        )
        .environment(state)
        let host = NSHostingView(rootView: content)
        host.frame = NSRect(x: 0, y: 0, width: 720, height: 60)

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 720, height: 60),
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = false
        panel.isMovableByWindowBackground = true
        panel.contentView = host
        return panel
    }

    private func positionAtBottomCenter() {
        guard let panel = panel, let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let w = panel.frame.width
        let h = panel.frame.height
        let x = visible.midX - w / 2
        let y = visible.minY + 60
        panel.setFrame(NSRect(x: x, y: y, width: w, height: h), display: true)
    }
}
