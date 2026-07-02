import AppKit

/// App-wide ⌥⌘R hotkey: opens the recording control bar when idle, stops the
/// active recording otherwise. Uses NSEvent key monitors — the app already
/// requires Accessibility, which is what global key monitoring needs — and
/// observes only, so the keystroke still reaches the frontmost app.
@MainActor
final class HotkeyController {
    static let shared = HotkeyController()

    private var monitors: [Any] = []
    private weak var state: AppState?

    /// Installed once at launch; the Settings toggle gates behaviour, not
    /// installation, so flipping it doesn't need monitor churn.
    func install(state: AppState) {
        self.state = state
        guard monitors.isEmpty else { return }

        let handler: (NSEvent) -> Void = { [weak self] event in
            guard event.keyCode == 15 else { return }  // 'R'
            let flags = event.modifierFlags
                .intersection(.deviceIndependentFlagsMask)
                .subtracting(.capsLock)
            guard flags == [.option, .command] else { return }
            self?.toggle()
        }
        if let global = NSEvent.addGlobalMonitorForEvents(matching: .keyDown, handler: handler) {
            monitors.append(global)
        }
        if let local = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { event in
            handler(event)
            return event
        }) {
            monitors.append(local)
        }
    }

    private func toggle() {
        guard let state, state.enableGlobalHotkey else { return }
        if case .recording = state.session.state {
            RecordingBarController.shared.requestStop()
        } else if !state.session.isBusy {
            guard state.permissions.allRequiredGranted else { return }
            NSApp.activate(ignoringOtherApps: true)
            ControlBarController.shared.show(state: state)
        }
    }
}
