import SwiftUI
import AppKit
import ScreenCaptureKit

/// The "Start a Recording" floating bar. Mirrors the layout in the user's
/// screenshot: close · mode buttons · audio toggles · settings.
struct ControlBarView: View {
    @Bindable var state: AppState
    var onDismiss: () -> Void
    var onStartRecording: () -> Void

    enum CaptureMode: String, CaseIterable, Identifiable {
        case display, window, area, device
        var id: String { rawValue }
        var label: String {
            switch self {
            case .display: return "Display"
            case .window:  return "Window"
            case .area:    return "Area"
            case .device:  return "Device"
            }
        }
        var symbol: String {
            switch self {
            case .display: return "display"
            case .window:  return "macwindow"
            case .area:    return "viewfinder.rectangular"
            case .device:  return "iphone"
            }
        }
    }

    @State private var hoveredMode: CaptureMode?
    @State private var showSettings = false

    var body: some View {
        HStack(spacing: 0) {
            closeButton

            separator

            modeSection

            separator

            audioSection

            separator

            settingsSection
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.regularMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
        .padding(8)
    }

    // MARK: - Sections

    private var closeButton: some View {
        Button(action: onDismiss) {
            ZStack {
                Circle().fill(Color.white.opacity(0.1))
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.primary.opacity(0.8))
            }
            .frame(width: 32, height: 32)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 6)
        .help("Close")
    }

    private var modeSection: some View {
        HStack(spacing: 0) {
            ForEach(CaptureMode.allCases) { mode in
                modeButton(mode)
            }
        }
    }

    private func modeButton(_ mode: CaptureMode) -> some View {
        let enabled = mode == .display || mode == .window
        let isHovered = hoveredMode == mode
        return Button {
            select(mode)
        } label: {
            VStack(spacing: 4) {
                Image(systemName: mode.symbol)
                    .font(.system(size: 18))
                Text(mode.label)
                    .font(.system(size: 10, weight: .medium))
            }
            .foregroundStyle(enabled ? .primary : .secondary)
            .opacity(enabled ? 1.0 : 0.45)
            .frame(width: 64, height: 46)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(isHovered && enabled ? Color.white.opacity(0.08) : Color.clear)
            )
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .onHover { hoveredMode = $0 ? mode : nil }
        .help(enabled ? mode.label : "Coming soon")
    }

    private var audioSection: some View {
        HStack(spacing: 4) {
            pillToggle(
                label: cameraLabel,
                systemImage: state.captureCamera && state.permissions.camera == .granted ? "video.fill" : "video.slash",
                isOn: state.captureCamera && state.permissions.camera == .granted,
                disabled: false,
                onChange: { value in
                    if state.permissions.camera != .granted {
                        Task {
                            _ = await Permissions.requestCamera()
                            state.refreshPermissions()
                            if state.permissions.camera == .granted {
                                state.saveCaptureCamera(true)
                            }
                        }
                        return
                    }
                    state.saveCaptureCamera(value)
                }
            )
            pillToggle(
                label: micLabel,
                systemImage: state.captureMic && state.permissions.microphone == .granted ? "mic.fill" : "mic.slash",
                isOn: state.captureMic && state.permissions.microphone == .granted,
                disabled: state.permissions.microphone != .granted,
                onChange: { value in
                    state.saveCaptureMic(value)
                }
            )
            pillToggle(
                label: state.captureSystemAudio ? "System audio" : "No system audio",
                systemImage: state.captureSystemAudio ? "speaker.wave.2.fill" : "speaker.slash.fill",
                isOn: state.captureSystemAudio,
                disabled: false,
                onChange: { value in
                    state.saveCaptureSystemAudio(value)
                }
            )
        }
    }

    private func pillToggle(
        label: String,
        systemImage: String,
        isOn: Bool,
        disabled: Bool,
        onChange: @escaping (Bool) -> Void
    ) -> some View {
        Button {
            onChange(!isOn)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 13))
                Text(label)
                    .font(.system(size: 12, weight: .medium))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(isOn ? Color.white.opacity(0.18) : Color.white.opacity(0.05))
            )
            .foregroundStyle(isOn ? .primary : .secondary)
            .opacity(disabled ? 0.5 : 1.0)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .help(disabled ? "Permission required" : label)
    }

    private var settingsSection: some View {
        Menu {
            Picker("Display capture", selection: $state.selectedWindowID) {
                Text("Entire screen").tag(CGWindowID?.none)
                ForEach(state.availableWindows, id: \.id) { w in
                    Text("\(w.appName) — \(w.title)").tag(CGWindowID?.some(w.id))
                }
            }
            Divider()
            Picker("Frame rate", selection: $state.frameRate) {
                Text("30 fps").tag(30)
                Text("60 fps").tag(60)
            }
            Picker("Quality", selection: $state.quality) {
                Text("Low").tag(CaptureRequest.Quality.low)
                Text("Medium").tag(CaptureRequest.Quality.medium)
                Text("High").tag(CaptureRequest.Quality.high)
            }
            Divider()
            Button("Refresh windows") {
                Task { await state.refreshAvailableWindows() }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 14))
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .frame(height: 32)
    }

    private var separator: some View {
        Rectangle()
            .fill(Color.white.opacity(0.08))
            .frame(width: 1, height: 32)
            .padding(.horizontal, 4)
    }

    private var micLabel: String {
        if state.permissions.microphone != .granted { return "No microphone" }
        return state.captureMic ? "Microphone" : "No microphone"
    }

    private var cameraLabel: String {
        if state.permissions.camera != .granted { return "No camera" }
        return state.captureCamera ? "Camera" : "No camera"
    }

    // MARK: - Actions

    private func select(_ mode: CaptureMode) {
        switch mode {
        case .display:
            state.selectedWindowID = nil
            startNewProjectRecording(preBuiltFilter: nil)
        case .window:
            // Use the system-provided picker so the user gets the same native
            // overlay that QuickTime / Screen Studio use.
            Task { @MainActor in
                onDismiss()  // hide the control bar while the picker is open
                let filter = await WindowPicker.shared.pick(mode: .singleWindow)
                guard let filter = filter else {
                    // Cancelled — re-show ourselves.
                    ControlBarController.shared.show(state: state)
                    return
                }
                startNewProjectRecording(preBuiltFilter: filter)
            }
        case .area, .device:
            // v2.1 features
            break
        }
    }

    private func startNewProjectRecording(preBuiltFilter: SCContentFilter?) {
        guard let project = state.beginNewProject() else { return }
        let outputURL = project.fallbackVideoURL
        let request = CaptureRequest(
            outputURL: outputURL,
            windowID: state.selectedWindowID,
            preBuiltFilter: preBuiltFilter,
            fps: state.frameRate,
            quality: state.quality,
            captureSystemAudio: state.captureSystemAudio,
            captureMic: state.captureMic && state.permissions.microphone == .granted,
            captureCamera: state.captureCamera && state.permissions.camera == .granted,
            cameraDeviceID: state.selectedCameraID,
            webcamURL: project.fallbackWebcamURL
        )
        Task { @MainActor in
            do {
                try await state.session.start(request)
                onStartRecording()
                // Hide the projects window during recording so it doesn't
                // appear in the capture.
                if let projectsWindow = NSApp.windows.first(where: {
                    $0.identifier?.rawValue == "main" || $0.title.contains("CineScreen")
                }) {
                    projectsWindow.orderOut(nil)
                }
            } catch {
                Log.app.error("ControlBar start failed: \(error.localizedDescription)")
                state.statusMessage = error.localizedDescription
            }
        }
    }
}
