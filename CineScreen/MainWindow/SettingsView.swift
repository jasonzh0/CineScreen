import SwiftUI
import AppKit

struct SettingsView: View {
    @Environment(AppState.self) private var state

    var body: some View {
        @Bindable var state = state

        TabView {
            generalTab
                .tabItem { Label("General", systemImage: "gear") }
            recordingTab
                .tabItem { Label("Recording", systemImage: "record.circle") }
            permissionsTab
                .tabItem { Label("Permissions", systemImage: "lock.shield") }
        }
        .frame(width: 520, height: 420)
        .padding(20)
    }

    // MARK: - General

    private var generalTab: some View {
        @Bindable var state = state
        return Form {
            Section("Projects") {
                LabeledContent("Folder") {
                    HStack {
                        Text(state.projectsDirectory.path)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Change…") { pickProjectsDirectory() }
                        Button("Reveal") {
                            NSWorkspace.shared.activateFileViewerSelecting([state.projectsDirectory])
                        }
                    }
                }
                Text("CineScreen stores each recording as a folder inside this directory. Use Reveal to open it in Finder.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Section("Onboarding") {
                HStack {
                    Text("First-launch tour")
                    Spacer()
                    Button("Replay") {
                        OnboardingState.reset()
                        state.needsOnboarding = true
                    }
                }
                Text("Re-runs the welcome flow on the main window. Useful for re-granting permissions or testing the setup steps.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .formStyle(.grouped)
    }

    // MARK: - Recording defaults

    private var recordingTab: some View {
        @Bindable var state = state
        return Form {
            Section("Defaults") {
                Picker("Frame rate", selection: $state.frameRate) {
                    Text("30 fps").tag(30)
                    Text("60 fps").tag(60)
                }
                .onChange(of: state.frameRate) { _, new in state.saveFrameRate(new) }

                Picker("Quality", selection: $state.quality) {
                    Text("Low").tag(CaptureRequest.Quality.low)
                    Text("Medium").tag(CaptureRequest.Quality.medium)
                    Text("High").tag(CaptureRequest.Quality.high)
                }
                .onChange(of: state.quality) { _, new in state.saveQuality(new) }
            }
            Section("Audio") {
                Toggle("Record system audio by default", isOn: $state.captureSystemAudio)
                    .onChange(of: state.captureSystemAudio) { _, new in
                        state.saveCaptureSystemAudio(new)
                    }
                Toggle("Record microphone by default", isOn: $state.captureMic)
                    .disabled(state.permissions.microphone != .granted)
                    .onChange(of: state.captureMic) { _, new in
                        state.saveCaptureMic(new)
                    }
            }
            Section("Webcam") {
                Toggle("Record webcam by default", isOn: $state.captureCamera)
                    .disabled(state.permissions.camera != .granted)
                    .onChange(of: state.captureCamera) { _, new in
                        state.saveCaptureCamera(new)
                    }
                Picker("Camera", selection: Binding(
                    get: { state.selectedCameraID ?? "" },
                    set: { state.saveSelectedCameraID($0.isEmpty ? nil : $0) }
                )) {
                    Text("System default").tag("")
                    ForEach(WebcamCaptureService.availableDevices(), id: \.uniqueID) { device in
                        Text(device.localizedName).tag(device.uniqueID)
                    }
                }
                .disabled(state.permissions.camera != .granted)
                Text("Webcam is saved as `webcam.mp4` next to the screen recording. It plays as a circular overlay in the editor preview.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .formStyle(.grouped)
    }

    // MARK: - Permissions

    private var permissionsTab: some View {
        Form {
            Section {
                permissionRow(
                    "Screen Recording",
                    "Required to capture your screen.",
                    state.permissions.screenRecording,
                    required: true
                ) {
                    Task {
                        _ = await Permissions.requestScreenRecording()
                        state.refreshPermissions()
                    }
                }
                permissionRow(
                    "Accessibility",
                    "Required to track cursor movement and clicks.",
                    state.permissions.accessibility,
                    required: true
                ) {
                    _ = Permissions.requestAccessibility()
                    state.refreshPermissions()
                }
                permissionRow(
                    "Microphone",
                    "Optional — narration audio.",
                    state.permissions.microphone,
                    required: false
                ) {
                    Task {
                        _ = await Permissions.requestMicrophone()
                        state.refreshPermissions()
                    }
                }
                permissionRow(
                    "Camera",
                    "Optional — for webcam overlay (v2.1).",
                    state.permissions.camera,
                    required: false
                ) {
                    Task {
                        _ = await Permissions.requestCamera()
                        state.refreshPermissions()
                    }
                }
            }

            Section {
                HStack {
                    Button("Refresh") { state.refreshPermissions() }
                    Spacer()
                    Button("Open System Settings") {
                        Permissions.openSystemSettings(pane: .screenRecording)
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    private func permissionRow(
        _ title: String,
        _ detail: String,
        _ state: PermissionState,
        required: Bool,
        action: @escaping () -> Void
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(color(for: state))
                .frame(width: 8, height: 8)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(title).fontWeight(.medium)
                    if required {
                        Text("Required")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.15), in: Capsule())
                    }
                }
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if state == .granted {
                Text("Granted").font(.caption).foregroundStyle(.green)
            } else {
                Button("Grant", action: action)
            }
        }
        .padding(.vertical, 4)
    }

    private func color(for s: PermissionState) -> Color {
        switch s {
        case .granted: return .green
        case .denied, .restricted: return .red
        case .notDetermined, .unavailable: return .secondary
        }
    }

    private func pickProjectsDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        panel.directoryURL = state.projectsDirectory
        if panel.runModal() == .OK, let url = panel.url {
            state.saveProjectsDirectory(url)
        }
    }
}
