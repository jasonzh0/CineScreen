import Foundation
import Observation

/// Drives the first-launch onboarding flow. The completion flag is stored in
/// UserDefaults — Settings exposes a "Replay Onboarding" button that flips it
/// back to `false`.
@MainActor
@Observable
final class OnboardingState {
    enum Step: Int, CaseIterable {
        case welcome
        case permissions
        case optional
        case library
        case done

        var title: String {
            switch self {
            case .welcome:     return "Welcome"
            case .permissions: return "Permissions"
            case .optional:    return "Audio & Video"
            case .library:     return "Library"
            case .done:        return "Ready"
            }
        }
    }

    private enum Keys {
        static let completed = "cs.onboarding.completed"
        static let step = "cs.onboarding.step"
    }

    /// Persisted so the flow resumes where it left off after the relaunch
    /// that a fresh Screen Recording grant requires.
    var step: Step = .welcome {
        didSet { UserDefaults.standard.set(step.rawValue, forKey: Keys.step) }
    }

    init() {
        if !Self.hasCompleted,
           let saved = Step(rawValue: UserDefaults.standard.integer(forKey: Keys.step)) {
            step = saved
        }
    }

    static var hasCompleted: Bool {
        UserDefaults.standard.bool(forKey: Keys.completed)
    }

    static func markCompleted() {
        UserDefaults.standard.set(true, forKey: Keys.completed)
        UserDefaults.standard.removeObject(forKey: Keys.step)
    }

    static func reset() {
        UserDefaults.standard.set(false, forKey: Keys.completed)
        UserDefaults.standard.removeObject(forKey: Keys.step)
    }

    func advance() {
        guard let next = Step(rawValue: step.rawValue + 1) else { return }
        step = next
    }

    func back() {
        guard let prev = Step(rawValue: step.rawValue - 1) else { return }
        step = prev
    }
}
