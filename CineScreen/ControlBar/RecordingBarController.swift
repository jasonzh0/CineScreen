import AppKit
import SwiftUI

/// The in-progress recording HUD: a small floating bar with a pulsing record
/// dot, an elapsed timer, and Stop / Cancel buttons. Shown the moment a
/// recording begins so there is always an obvious, on-screen way to stop.
///
/// It is safe to float this over the screen because `ScreenCaptureService`
/// excludes CineScreen's own windows from full-display capture — the bar never
/// appears in the recorded video. (That exclusion is why the old approach of a
/// menu-bar-only dot, which users couldn't find, is no longer necessary.)
@MainActor
final class RecordingBarController {
    static let shared = RecordingBarController()

    private var panel: NSPanel?
    private weak var state: AppState?
    /// Local + global keyDown monitors so ⌥⎋ stops the recording from
    /// anywhere (the user is usually in another app while recording).
    private var keyMonitors: [Any] = []
    /// Guards stop/cancel against double-firing (e.g. mashing ESC).
    private var finishing = false

    func show(state: AppState) {
        self.state = state
        hide()  // clear any stale panel first
        finishing = false

        let view = RecordingBarView(
            startedAt: Date(),
            onStop: { [weak self] in self?.performStop() },
            onCancel: { [weak self] in self?.performCancel() }
        )
        .environment(state)

        let host = NSHostingView(rootView: view)
        host.layoutSubtreeIfNeeded()
        let size = host.fittingSize
        let w = max(280, size.width)
        let h = max(60, size.height)
        host.frame = NSRect(x: 0, y: 0, width: w, height: h)

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: w, height: h),
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        // Force dark appearance: the bar is a branded dark HUD whose text +
        // buttons are designed for dark surfaces. Without this, `.regularMaterial`
        // adapts to a light-mode system and renders a washed-out white pill with
        // near-invisible white text.
        panel.appearance = NSAppearance(named: .darkAqua)
        panel.hasShadow = false  // the SwiftUI bar draws its own shadow
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovableByWindowBackground = true
        panel.contentView = host

        self.panel = panel
        positionAtBottomCenter(panel)
        panel.orderFrontRegardless()
        installEscMonitor()
        Log.app.info("Recording bar shown")
    }

    func hide() {
        removeEscMonitor()
        panel?.orderOut(nil)
        panel = nil
    }

    // MARK: - Option-Escape-to-stop

    /// Installs keyDown monitors for Option-Escape (keyCode 53 + ⌥). The
    /// global monitor fires when another app is frontmost (the usual case
    /// while recording) and is observe-only, so the keystroke still reaches
    /// that app; the local monitor covers CineScreen itself being frontmost.
    ///
    /// Plain ESC deliberately does NOT stop the recording: it's one of the
    /// most-pressed keys in normal work (dismissing dialogs, exiting
    /// fullscreen, vim), and an unmodified global ESC monitor silently ended
    /// recordings whenever the user pressed it in the app being recorded.
    /// The exact-modifier match also keeps ⌘⌥⎋ (Force Quit) from stopping.
    private func installEscMonitor() {
        removeEscMonitor()
        let onKey: (NSEvent) -> Void = { [weak self] event in
            guard event.keyCode == 53 else { return }
            let flags = event.modifierFlags
                .intersection(.deviceIndependentFlagsMask)
                .subtracting(.capsLock)
            guard flags == .option else { return }
            self?.performStop()
        }
        if let global = NSEvent.addGlobalMonitorForEvents(matching: .keyDown, handler: onKey) {
            keyMonitors.append(global)
        }
        if let local = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { event in
            onKey(event)
            return event
        }) {
            keyMonitors.append(local)
        }
    }

    private func removeEscMonitor() {
        for monitor in keyMonitors { NSEvent.removeMonitor(monitor) }
        keyMonitors.removeAll()
    }

    private func positionAtBottomCenter(_ panel: NSPanel) {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let w = panel.frame.width
        let h = panel.frame.height
        let x = visible.midX - w / 2
        let y = visible.minY + 36
        panel.setFrame(NSRect(x: x, y: y, width: w, height: h), display: true)
    }

    // MARK: - Actions (mirror RecordingStatusController so behavior is identical)

    private func performStop() {
        guard !finishing else { return }
        finishing = true
        removeEscMonitor()
        guard let state = state else { hide(); return }
        Log.app.info("Recording bar: stop requested")
        Task { @MainActor in
            defer {
                self.hide()
                state.refreshProjects()
                NSApp.activate(ignoringOtherApps: true)
                bringProjectsWindowFront()
            }
            do {
                let result = try await state.session.stop()
                state.statusMessage = "Saved \(result.videoURL.lastPathComponent)"
                state.pendingProjectToOpen = result.videoURL
            } catch {
                state.statusMessage = "Recording failed: \(error.localizedDescription)"
            }
        }
    }

    private func performCancel() {
        guard !finishing else { return }
        finishing = true
        removeEscMonitor()
        guard let state = state else { hide(); return }
        Log.app.info("Recording bar: cancel requested")
        Task { @MainActor in
            // When the session already died underneath the HUD, "Cancel" is
            // the failure bar's Close button — carry the failure into the
            // main window's banner ("failed" keys its error styling).
            let failure: String?
            if case let .error(message) = state.session.state { failure = message } else { failure = nil }
            await state.session.cancel()
            self.hide()
            state.refreshProjects()
            NSApp.activate(ignoringOtherApps: true)
            bringProjectsWindowFront()
            state.statusMessage = failure.map { "Recording failed: \($0)" } ?? "Recording cancelled."
        }
    }

    private func bringProjectsWindowFront() {
        if let projects = NSApp.windows.first(where: {
            $0.identifier?.rawValue == "main" || $0.title.contains("CineScreen")
        }) {
            projects.makeKeyAndOrderFront(nil)
        }
    }
}

// MARK: - Bar view

private struct RecordingBarView: View {
    let startedAt: Date
    var onStop: () -> Void
    var onCancel: () -> Void

    @Environment(AppState.self) private var state
    @State private var pulse = false

    /// Non-nil once the session died underneath the HUD (stream failure) —
    /// swaps the timer/Stop UI for a failure notice so the bar doesn't keep
    /// counting over a dead stream.
    private var sessionFailed: Bool {
        if case .error = state.session.state { return true }
        return false
    }

    var body: some View {
        HStack(spacing: 14) {
            if sessionFailed {
                failureContent
            } else {
                recordingContent
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(CTheme.stroke, lineWidth: 1))
        .shadow(color: .black.opacity(0.45), radius: 20, x: 0, y: 8)
        .padding(10)
        .fixedSize()
    }

    private var failureContent: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13))
                .foregroundStyle(CTheme.warning)
            Text("Recording stopped")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(CTheme.textPrimary)
            Button("Close", action: onCancel)
                .buttonStyle(CineGhostButtonStyle(font: .system(size: 12.5, weight: .medium), hPad: 13, vPad: 9))
        }
    }

    private var recordingContent: some View {
        HStack(spacing: 14) {
            recordDot

            // Elapsed time — fully-qualified SwiftUI.TimelineView because the
            // editor declares its own `TimelineView` type in this module.
            SwiftUI.TimelineView(.periodic(from: startedAt, by: 0.5)) { context in
                Text(elapsed(to: context.date))
                    .font(.system(size: 15, weight: .semibold, design: .monospaced))
                    .monospacedDigit()
                    .foregroundStyle(CTheme.textPrimary)
            }
            .frame(minWidth: 54, alignment: .leading)

            Rectangle()
                .fill(CTheme.stroke)
                .frame(width: 1, height: 24)

            Button(action: onStop) {
                HStack(spacing: 7) {
                    RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                        .fill(.white)
                        .frame(width: 9, height: 9)
                    Text("Stop")
                }
            }
            .buttonStyle(CineFilledButtonStyle(
                palette: .record, font: .system(size: 13, weight: .semibold), hPad: 15, vPad: 9
            ))

            Button("Cancel", action: onCancel)
                .buttonStyle(CineGhostButtonStyle(font: .system(size: 12.5, weight: .medium), hPad: 13, vPad: 9))

            Text("⌥⎋")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(CTheme.textTertiary)
                .padding(.leading, 2)
                .help("Press Option-Escape anywhere to stop recording")
        }
    }

    private var recordDot: some View {
        Circle()
            .fill(CTheme.brand)
            .frame(width: 11, height: 11)
            .shadow(color: CTheme.brand.opacity(0.8), radius: pulse ? 7 : 2)
            .scaleEffect(pulse ? 1.0 : 0.78)
            .opacity(pulse ? 1.0 : 0.7)
            .animation(.easeInOut(duration: 0.85).repeatForever(autoreverses: true), value: pulse)
            .onAppear { pulse = true }
            .padding(.leading, 2)
    }

    private func elapsed(to now: Date) -> String {
        let total = max(0, Int(now.timeIntervalSince(startedAt)))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}
