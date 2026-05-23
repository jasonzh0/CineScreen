import Foundation
import AVFoundation
import CoreGraphics
import AppKit

/// Current TCC state for a specific permission, mirroring the v1.6 schema.
enum PermissionState: String {
    case granted
    case denied
    case notDetermined = "not-determined"
    case restricted
    case unavailable
}

struct PermissionStatus {
    var screenRecording: PermissionState
    var accessibility: PermissionState
    var microphone: PermissionState
    var camera: PermissionState

    var allRequiredGranted: Bool {
        screenRecording == .granted && accessibility == .granted
    }
}

/// Probes TCC for the permissions CineScreen needs and routes requests to
/// either the native consent dialog or System Settings.
enum Permissions {
    // MARK: - Status

    static func currentStatus() -> PermissionStatus {
        PermissionStatus(
            screenRecording: screenRecordingState(),
            accessibility: accessibilityState(),
            microphone: deviceState(for: .audio),
            camera: deviceState(for: .video)
        )
    }

    // MARK: - Requests

    /// Trigger the native consent dialog for the microphone. If TCC won't
    /// surface the dialog (already-denied case), opens System Settings.
    static func requestMicrophone() async -> PermissionState {
        let granted = await AVCaptureDevice.requestAccess(for: .audio)
        if granted { return .granted }
        let next = deviceState(for: .audio)
        if next == .denied { openSystemSettings(pane: .microphone) }
        return next
    }

    static func requestCamera() async -> PermissionState {
        let granted = await AVCaptureDevice.requestAccess(for: .video)
        if granted { return .granted }
        let next = deviceState(for: .video)
        if next == .denied { openSystemSettings(pane: .camera) }
        return next
    }

    /// Screen Recording does not expose an inline consent API; calling
    /// `CGRequestScreenCaptureAccess()` shows the system dialog the first
    /// time and triggers TCC otherwise.
    static func requestScreenRecording() async -> PermissionState {
        let triggered = CGRequestScreenCaptureAccess()
        Log.permissions.info("CGRequestScreenCaptureAccess returned \(triggered)")
        // Give TCC a moment to settle
        try? await Task.sleep(nanoseconds: 200_000_000)
        let next = screenRecordingState()
        if next != .granted {
            openSystemSettings(pane: .screenRecording)
        }
        return next
    }

    /// Accessibility has no in-process API to prompt — must direct the user.
    static func requestAccessibility() -> PermissionState {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        _ = AXIsProcessTrustedWithOptions(options as CFDictionary)
        let next = accessibilityState()
        if next != .granted {
            openSystemSettings(pane: .accessibility)
        }
        return next
    }

    // MARK: - System Settings deep links

    enum SettingsPane {
        case screenRecording
        case accessibility
        case microphone
        case camera

        var anchor: String {
            switch self {
            case .screenRecording: return "Privacy_ScreenCapture"
            case .accessibility:   return "Privacy_Accessibility"
            case .microphone:      return "Privacy_Microphone"
            case .camera:          return "Privacy_Camera"
            }
        }
    }

    static func openSystemSettings(pane: SettingsPane) {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane.anchor)")!
        NSWorkspace.shared.open(url)
    }

    // MARK: - Internals

    private static func screenRecordingState() -> PermissionState {
        // CGPreflightScreenCaptureAccess is documented for macOS 11+ and is
        // accurate for the v1.6 TCC bucket the Electron app also uses.
        CGPreflightScreenCaptureAccess() ? .granted : .notDetermined
    }

    private static func accessibilityState() -> PermissionState {
        AXIsProcessTrusted() ? .granted : .notDetermined
    }

    private static func deviceState(for mediaType: AVMediaType) -> PermissionState {
        switch AVCaptureDevice.authorizationStatus(for: mediaType) {
        case .authorized: return .granted
        case .denied:     return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }
}
