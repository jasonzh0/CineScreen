import SwiftUI
import AppKit

/// Quit guard: ⌘Q mid-recording used to abandon the AVAssetWriter and leave
/// an unplayable .mp4 — intercept termination and stop-and-save first.
final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Wired by CineScreenApp.onAppear so quit can consult the session.
    nonisolated(unsafe) static weak var state: AppState?

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        MainActor.assumeIsolated {
            guard let state = Self.state, state.session.isBusy else { return .terminateNow }
            let alert = NSAlert()
            alert.messageText = "Stop recording and quit?"
            alert.informativeText = "A recording is in progress. CineScreen will stop and save it before quitting."
            alert.addButton(withTitle: "Stop & Quit")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return .terminateCancel }
            Task { @MainActor in
                _ = try? await state.session.stop()
                NSApp.reply(toApplicationShouldTerminate: true)
            }
            return .terminateLater
        }
    }
}

@main
struct CineScreenApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var state = AppState()

    var body: some Scene {
        Window("CineScreen", id: "main") {
            Group {
                if state.needsOnboarding {
                    OnboardingView { state.needsOnboarding = false }
                } else {
                    ProjectsView()
                }
            }
                .environment(state)
                .frame(minWidth: 720, minHeight: 520)
                .onAppear {
                    AppDelegate.state = state
                    state.refreshPermissions()
                    Task { await state.refreshAvailableWindows() }
                    state.refreshProjects()
                }
        }
        .windowStyle(.titleBar)
        .windowResizability(.contentMinSize)
        .defaultSize(width: 880, height: 640)
        .commands {
            CommandGroup(after: .appInfo) {
                CheckForUpdatesView(updater: UpdaterController.shared)
            }
            CommandGroup(replacing: .newItem) {
                Button("New Recording") {
                    state.refreshPermissions()
                    Task { await state.refreshAvailableWindows() }
                    ControlBarController.shared.show(state: state)
                }
                .keyboardShortcut("n", modifiers: .command)
                .disabled(!state.permissions.allRequiredGranted || state.session.isBusy)
            }
        }

        Settings {
            SettingsView()
                .environment(state)
        }

        WindowGroup("Studio", id: "studio", for: URL.self) { $url in
            if let url = url {
                EditorView(videoURL: url)
            } else {
                Text("No recording opened.")
                    .padding()
            }
        }
        .windowStyle(.titleBar)
        .windowResizability(.contentMinSize)
        .defaultSize(width: 1120, height: 720)
    }
}
