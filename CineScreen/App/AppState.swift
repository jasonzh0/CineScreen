import Foundation
import AppKit
import Observation

/// Top-level state shared across windows.
@MainActor
@Observable
final class AppState {
    // Project library
    var projectsDirectory: URL
    var projects: [Project] = []
    /// The project being recorded into. Set by ProjectsView when the user
    /// starts a new recording.
    var activeProject: Project?
    /// Set by the recording bar after a successful stop — the ProjectsView
    /// reads it once and opens the editor for that URL, then clears it.
    var pendingProjectToOpen: URL?

    // Persisted recording settings
    var frameRate: Int = 60
    var quality: CaptureRequest.Quality = .medium
    var captureSystemAudio: Bool = false
    var captureMic: Bool = false
    var captureCamera: Bool = false
    /// AVCaptureDevice uniqueID for the selected webcam. nil = system default.
    var selectedCameraID: String? = nil
    /// `nil` = capture the entire display. Otherwise the chosen on-screen window.
    var selectedWindowID: CGWindowID? = nil
    var availableWindows: [CaptureWindow] = []

    // Permissions snapshot (refreshed on a timer and after each request)
    var permissions: PermissionStatus

    // The one active recording session.
    let session = RecordingSession()

    // Toast/banner text for the main window — keep simple in Phase 1.
    var statusMessage: String?

    /// True until the first-launch onboarding flow has been completed. The
    /// main window swaps in OnboardingView while this is set.
    var needsOnboarding: Bool = !OnboardingState.hasCompleted

    init() {
        self.permissions = Permissions.currentStatus()
        // Load projects directory from settings (or default).
        if let stored = UserDefaults.standard.string(forKey: Keys.projectsDirectory) {
            self.projectsDirectory = URL(fileURLWithPath: stored, isDirectory: true)
        } else {
            self.projectsDirectory = ProjectsLibrary.defaultRootDirectory
        }
        loadSettings()
        refreshProjects()
    }

    // MARK: - Settings persistence (UserDefaults)

    private enum Keys {
        static let projectsDirectory = "cs.projectsDirectory"
        static let frameRate = "cs.frameRate"
        static let quality = "cs.quality"
        static let captureSystemAudio = "cs.captureSystemAudio"
        static let captureMic = "cs.captureMic"
        static let captureCamera = "cs.captureCamera"
        static let selectedCameraID = "cs.selectedCameraID"
    }

    private func loadSettings() {
        let d = UserDefaults.standard
        let fps = d.integer(forKey: Keys.frameRate)
        if fps > 0 { frameRate = fps }
        if let q = d.string(forKey: Keys.quality), let parsed = CaptureRequest.Quality(rawValue: q) {
            quality = parsed
        }
        captureSystemAudio = d.bool(forKey: Keys.captureSystemAudio)
        captureMic = d.bool(forKey: Keys.captureMic)
        captureCamera = d.bool(forKey: Keys.captureCamera)
        selectedCameraID = d.string(forKey: Keys.selectedCameraID)
    }

    func saveProjectsDirectory(_ url: URL) {
        projectsDirectory = url
        UserDefaults.standard.set(url.path, forKey: Keys.projectsDirectory)
        refreshProjects()
    }

    func saveFrameRate(_ fps: Int) {
        frameRate = fps
        UserDefaults.standard.set(fps, forKey: Keys.frameRate)
    }

    func saveQuality(_ q: CaptureRequest.Quality) {
        quality = q
        UserDefaults.standard.set(q.rawValue, forKey: Keys.quality)
    }

    func saveCaptureSystemAudio(_ on: Bool) {
        captureSystemAudio = on
        UserDefaults.standard.set(on, forKey: Keys.captureSystemAudio)
    }

    func saveCaptureMic(_ on: Bool) {
        captureMic = on
        UserDefaults.standard.set(on, forKey: Keys.captureMic)
    }

    func saveCaptureCamera(_ on: Bool) {
        captureCamera = on
        UserDefaults.standard.set(on, forKey: Keys.captureCamera)
    }

    func saveSelectedCameraID(_ id: String?) {
        selectedCameraID = id
        if let id = id {
            UserDefaults.standard.set(id, forKey: Keys.selectedCameraID)
        } else {
            UserDefaults.standard.removeObject(forKey: Keys.selectedCameraID)
        }
    }

    // MARK: - Permissions

    func refreshPermissions() {
        permissions = Permissions.currentStatus()
    }

    // MARK: - Windows

    func refreshAvailableWindows() async {
        do {
            availableWindows = try await ScreenCaptureService.availableWindows()
        } catch {
            Log.app.error("Failed to enumerate windows: \(error.localizedDescription)")
        }
    }

    // MARK: - Projects

    func refreshProjects() {
        projects = ProjectsLibrary.projects(in: projectsDirectory)
    }

    /// Creates a new project in the configured library and selects it as the
    /// recording target. The video will be written to
    /// `<projectFolder>/recording.mov`.
    func beginNewProject() -> Project? {
        do {
            let project = try ProjectsLibrary.createNew(in: projectsDirectory)
            activeProject = project
            refreshProjects()
            return project
        } catch {
            Log.app.error("Could not create project: \(error.localizedDescription)")
            statusMessage = "Couldn't create project: \(error.localizedDescription)"
            return nil
        }
    }

    /// Returns the destination video URL for the active project, or nil if no
    /// project is active.
    func nextOutputURL() -> URL? {
        activeProject?.fallbackVideoURL
    }
}
