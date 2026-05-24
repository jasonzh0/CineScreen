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
    }

    var step: Step = .welcome

    static var hasCompleted: Bool {
        UserDefaults.standard.bool(forKey: Keys.completed)
    }

    static func markCompleted() {
        UserDefaults.standard.set(true, forKey: Keys.completed)
    }

    static func reset() {
        UserDefaults.standard.set(false, forKey: Keys.completed)
    }

    var progress: Double {
        let total = Double(Step.allCases.count - 1)
        return total > 0 ? Double(step.rawValue) / total : 0
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
