import SwiftUI

@main
struct CineScreenApp: App {
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
                    state.refreshPermissions()
                    Task { await state.refreshAvailableWindows() }
                    state.refreshProjects()
                }
        }
        .windowStyle(.titleBar)
        .windowResizability(.contentMinSize)
        .defaultSize(width: 880, height: 640)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Recording") {
                    state.refreshPermissions()
                    Task { await state.refreshAvailableWindows() }
                    ControlBarController.shared.show(state: state)
                }
                .keyboardShortcut("n", modifiers: .command)
                .disabled(!state.permissions.allRequiredGranted)
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
