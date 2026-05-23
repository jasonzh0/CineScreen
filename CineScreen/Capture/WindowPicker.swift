import Foundation
import ScreenCaptureKit

/// Wraps the system-provided `SCContentSharingPicker` so callers can present
/// the native macOS window/display picker as a single async call. Returns
/// the `SCContentFilter` the user picked, or nil if they cancelled.
@MainActor
final class WindowPicker: NSObject, SCContentSharingPickerObserver {
    static let shared = WindowPicker()

    enum Mode {
        case singleWindow
        case singleDisplay
        case anyContent

        var pickerModes: SCContentSharingPickerMode {
            switch self {
            case .singleWindow:  return .singleWindow
            case .singleDisplay: return .singleDisplay
            case .anyContent:    return [.singleWindow, .singleDisplay, .singleApplication]
            }
        }
    }

    private var continuation: CheckedContinuation<SCContentFilter?, Never>?

    private override init() {
        super.init()
    }

    /// Presents the system picker. Returns the chosen filter or nil if the
    /// user cancelled. Safe to call multiple times — concurrent calls reuse
    /// the latest continuation (only one pick can be in flight at a time).
    func pick(mode: Mode) async -> SCContentFilter? {
        // If somehow a previous pick is still pending, cancel it.
        continuation?.resume(returning: nil)
        continuation = nil

        let picker = SCContentSharingPicker.shared
        picker.add(self)
        picker.isActive = true

        var configuration = SCContentSharingPickerConfiguration()
        configuration.allowedPickerModes = mode.pickerModes
        configuration.allowsChangingSelectedContent = false
        picker.defaultConfiguration = configuration

        return await withCheckedContinuation { cont in
            self.continuation = cont
            picker.present()
        }
    }

    // MARK: - SCContentSharingPickerObserver

    nonisolated func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didCancelFor stream: SCStream?
    ) {
        Task { @MainActor in finish(with: nil) }
    }

    nonisolated func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didUpdateWith filter: SCContentFilter,
        for stream: SCStream?
    ) {
        Task { @MainActor in finish(with: filter) }
    }

    nonisolated func contentSharingPickerStartDidFailWithError(_ error: any Error) {
        Log.capture.error("Picker failed: \(error.localizedDescription)")
        Task { @MainActor in finish(with: nil) }
    }

    private func finish(with filter: SCContentFilter?) {
        let cont = continuation
        continuation = nil
        let picker = SCContentSharingPicker.shared
        picker.remove(self)
        picker.isActive = false
        cont?.resume(returning: filter)
    }
}
