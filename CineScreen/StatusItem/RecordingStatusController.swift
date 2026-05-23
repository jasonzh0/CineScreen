import AppKit
import SwiftUI

/// Shows a tiny red recording dot in the macOS menu bar while a recording is
/// in progress. Click stops & saves; right-click shows a small menu with
/// Cancel & Discard. Replaces the floating RecordingBar window — that always
/// got in the way of what the user was recording.
@MainActor
final class RecordingStatusController: NSObject {
    static let shared = RecordingStatusController()

    private var statusItem: NSStatusItem?
    private weak var state: AppState?
    private var startedAt: Date?
    private var ticker: Timer?

    // MARK: - Lifecycle

    func show(state: AppState) {
        self.state = state
        if statusItem == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
            if let button = item.button {
                button.target = self
                button.action = #selector(buttonClicked(_:))
                button.sendAction(on: [.leftMouseUp, .rightMouseUp])
                button.imagePosition = .imageLeading
            }
            statusItem = item
        }
        startedAt = Date()
        refresh()
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        Log.app.info("Recording status item shown")
    }

    func hide() {
        ticker?.invalidate()
        ticker = nil
        startedAt = nil
        if let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
        }
        statusItem = nil
    }

    // MARK: - Rendering

    private func refresh() {
        guard let button = statusItem?.button else { return }
        let elapsed = startedAt.map { Int(Date().timeIntervalSince($0)) } ?? 0
        let m = elapsed / 60
        let s = elapsed % 60
        let time = String(format: " %02d:%02d", m, s)

        let symbolConfig = NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
        button.image = NSImage(systemSymbolName: "record.circle.fill",
                               accessibilityDescription: "Recording in progress")?
            .withSymbolConfiguration(symbolConfig)
        button.contentTintColor = .systemRed
        button.attributedTitle = NSAttributedString(
            string: time,
            attributes: [
                .foregroundColor: NSColor.labelColor,
                .font: NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .medium)
            ]
        )
        button.toolTip = "CineScreen — click to stop · right-click for more"
    }

    // MARK: - Click handling

    @objc private func buttonClicked(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else {
            performStop()
            return
        }
        if event.type == .rightMouseUp || event.modifierFlags.contains(.control) {
            showContextMenu()
        } else {
            performStop()
        }
    }

    private func showContextMenu() {
        let menu = NSMenu()
        let stop = NSMenuItem(title: "Stop & Save", action: #selector(menuStop(_:)), keyEquivalent: "")
        let cancel = NSMenuItem(title: "Cancel & Discard", action: #selector(menuCancel(_:)), keyEquivalent: "")
        stop.target = self
        cancel.target = self
        menu.addItem(stop)
        menu.addItem(.separator())
        menu.addItem(cancel)

        // Pop the menu, then clear it so left-clicks still trigger the action.
        statusItem?.menu = menu
        statusItem?.button?.performClick(nil)
        statusItem?.menu = nil
    }

    @objc private func menuStop(_ sender: Any?) { performStop() }
    @objc private func menuCancel(_ sender: Any?) { performCancel() }

    // MARK: - Actions

    private func performStop() {
        guard let state = state else { hide(); return }
        Log.app.info("Status item: stop requested")
        Task { @MainActor in
            defer {
                self.hide()
                state.refreshProjects()
                NSApp.activate(ignoringOtherApps: true)
                if let projects = NSApp.windows.first(where: {
                    $0.identifier?.rawValue == "main" || $0.title.contains("CineScreen")
                }) {
                    projects.makeKeyAndOrderFront(nil)
                }
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
        guard let state = state else { hide(); return }
        Log.app.info("Status item: cancel requested")
        Task { @MainActor in
            await state.session.cancel()
            self.hide()
            state.refreshProjects()
            NSApp.activate(ignoringOtherApps: true)
            if let projects = NSApp.windows.first(where: {
                $0.identifier?.rawValue == "main" || $0.title.contains("CineScreen")
            }) {
                projects.makeKeyAndOrderFront(nil)
            }
            state.statusMessage = "Recording cancelled."
        }
    }
}
