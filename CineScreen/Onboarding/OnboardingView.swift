import SwiftUI
import AppKit

/// Full-window first-launch experience. Replaces ProjectsView content until
/// the user finishes (or opts out via the "Skip" affordance on the welcome
/// step).
struct OnboardingView: View {
    @Environment(AppState.self) private var appState
    @State private var onboarding = OnboardingState()

    /// Closure invoked when the user finishes — used by the host to swap the
    /// window back to ProjectsView.
    var onComplete: () -> Void

    /// Polls permissions while the flow is up so the indicators flip green
    /// the moment macOS confirms a grant.
    private let pollTimer = Timer.publish(every: 0.6, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            backdrop
            VStack(spacing: 0) {
                progressBar
                ZStack {
                    switch onboarding.step {
                    case .welcome:     WelcomeStep(onboarding: onboarding, onSkip: finish)
                    case .permissions: PermissionsStep(onboarding: onboarding)
                    case .optional:    OptionalStep(onboarding: onboarding)
                    case .library:     LibraryStep(onboarding: onboarding)
                    case .done:        DoneStep(onFinish: finish)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.asymmetric(
                    insertion: .opacity.combined(with: .move(edge: .trailing)),
                    removal: .opacity.combined(with: .move(edge: .leading))
                ))
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: onboarding.step)
            }
        }
        .frame(minWidth: 720, minHeight: 540)
        .tint(CTheme.accent)
        .onReceive(pollTimer) { _ in appState.refreshPermissions() }
    }

    // MARK: - Chrome

    private var backdrop: some View {
        CineBackdrop()
            .ignoresSafeArea()
    }

    private var progressBar: some View {
        VStack(spacing: 10) {
            HStack(spacing: 6) {
                ForEach(OnboardingState.Step.allCases, id: \.self) { step in
                    Capsule()
                        .fill(step.rawValue <= onboarding.step.rawValue
                              ? CTheme.accent
                              : CTheme.stroke)
                        .frame(height: 3)
                        .animation(.easeInOut(duration: 0.25), value: onboarding.step)
                }
            }
            HStack {
                Text(onboarding.step.title.uppercased())
                    .font(.system(size: 10, weight: .bold))
                    .tracking(2)
                    .foregroundStyle(CTheme.textTertiary)
                Spacer()
                Text("Step \(onboarding.step.rawValue + 1) of \(OnboardingState.Step.allCases.count)")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(CTheme.textTertiary)
            }
        }
        .padding(.horizontal, 36)
        .padding(.top, 26)
        .padding(.bottom, 4)
    }

    private func finish() {
        OnboardingState.markCompleted()
        onComplete()
    }
}

// MARK: - Step: Welcome

private struct WelcomeStep: View {
    let onboarding: OnboardingState
    var onSkip: () -> Void

    var body: some View {
        VStack(spacing: 28) {
            Spacer()

            ZStack {
                Circle()
                    .stroke(CTheme.stroke, lineWidth: 1)
                    .frame(width: 132, height: 132)
                Circle()
                    .stroke(CTheme.surface, lineWidth: 1)
                    .frame(width: 168, height: 168)
                Circle()
                    .fill(CTheme.brandGradient)
                    .frame(width: 92, height: 92)
                    .shadow(color: CTheme.brand.opacity(0.55),
                            radius: 30, x: 0, y: 12)
                Image(systemName: "video.fill")
                    .font(.system(size: 38, weight: .bold))
                    .foregroundStyle(.white)
            }

            VStack(spacing: 10) {
                Text("Welcome to CineScreen")
                    .font(.system(size: 30, weight: .heavy))
                    .tracking(-0.5)
                    .foregroundStyle(CTheme.textPrimary)
                Text("Cinematic screen recording for macOS.\nLet's get you set up in under a minute.")
                    .multilineTextAlignment(.center)
                    .font(.system(size: 14))
                    .foregroundStyle(CTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            VStack(spacing: 10) {
                PrimaryButton(title: "Get Started") { onboarding.advance() }
                Button("Skip for now") { onSkip() }
                    .buttonStyle(.plain)
                    .font(.system(size: 12))
                    .foregroundStyle(CTheme.textTertiary)
            }
            .padding(.bottom, 48)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 60)
    }
}

// MARK: - Step: Required permissions

private struct PermissionsStep: View {
    @Environment(AppState.self) private var appState
    let onboarding: OnboardingState

    private var requiredGranted: Bool {
        appState.permissions.screenRecording == .granted
        && appState.permissions.accessibility == .granted
    }

    var body: some View {
        StepShell(
            title: "Grant access",
            subtitle: "CineScreen needs two macOS permissions to record your screen. We don't ask for anything else.",
            primaryTitle: requiredGranted ? "Continue" : "Continue when granted",
            primaryEnabled: requiredGranted,
            onPrimary: { onboarding.advance() },
            onBack: { onboarding.back() }
        ) {
            VStack(spacing: 12) {
                PermissionCard(
                    icon: "rectangle.inset.filled.and.cursorarrow",
                    title: "Screen Recording",
                    detail: "Required — capture the pixels on your display.",
                    state: appState.permissions.screenRecording,
                    required: true
                ) {
                    Task {
                        _ = await Permissions.requestScreenRecording()
                        appState.refreshPermissions()
                    }
                }
                PermissionCard(
                    icon: "cursorarrow.click.2",
                    title: "Accessibility",
                    detail: "Required — track cursor movement so the editor can zoom and follow clicks.",
                    state: appState.permissions.accessibility,
                    required: true
                ) {
                    _ = Permissions.requestAccessibility()
                    appState.refreshPermissions()
                }
            }
        }
    }
}

// MARK: - Step: Optional capture

private struct OptionalStep: View {
    @Environment(AppState.self) private var appState
    let onboarding: OnboardingState

    var body: some View {
        StepShell(
            title: "Audio & video",
            subtitle: "Optional — turn these on now if you'd like to record narration or a webcam overlay. You can always change this later.",
            primaryTitle: "Continue",
            primaryEnabled: true,
            onPrimary: { onboarding.advance() },
            onBack: { onboarding.back() }
        ) {
            VStack(spacing: 12) {
                PermissionCard(
                    icon: "mic.fill",
                    title: "Microphone",
                    detail: "Record narration alongside your screen.",
                    state: appState.permissions.microphone,
                    required: false
                ) {
                    Task {
                        _ = await Permissions.requestMicrophone()
                        appState.refreshPermissions()
                    }
                }
                PermissionCard(
                    icon: "web.camera.fill",
                    title: "Camera",
                    detail: "Add a webcam overlay to your recording.",
                    state: appState.permissions.camera,
                    required: false
                ) {
                    Task {
                        _ = await Permissions.requestCamera()
                        appState.refreshPermissions()
                    }
                }
            }
        }
    }
}

// MARK: - Step: Projects library

private struct LibraryStep: View {
    @Environment(AppState.self) private var appState
    let onboarding: OnboardingState

    var body: some View {
        StepShell(
            title: "Where should recordings live?",
            subtitle: "Every recording becomes a folder inside this directory — the .mov, thumbnail, and edit metadata stay together.",
            primaryTitle: "Continue",
            primaryEnabled: true,
            onPrimary: { onboarding.advance() },
            onBack: { onboarding.back() }
        ) {
            VStack(spacing: 12) {
                HStack(alignment: .top, spacing: 14) {
                    CineIconChip(symbol: "folder.fill", tint: CTheme.accent, size: 36)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Projects folder")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(CTheme.textPrimary)
                        Text(appState.projectsDirectory.path)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(CTheme.textSecondary)
                            .lineLimit(2)
                            .truncationMode(.middle)
                    }
                    Spacer()
                    Button("Change…") { pickFolder() }
                        .buttonStyle(SecondaryButtonStyle())
                }
                .padding(16)
                .cineCard(radius: CTheme.Radius.lg)

                Text("Tip: pick somewhere with plenty of free space — a minute of 4K capture is roughly 200 MB.")
                    .font(.system(size: 11))
                    .foregroundStyle(CTheme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func pickFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        panel.directoryURL = appState.projectsDirectory
        if panel.runModal() == .OK, let url = panel.url {
            appState.saveProjectsDirectory(url)
        }
    }
}

// MARK: - Step: Done

private struct DoneStep: View {
    var onFinish: () -> Void

    var body: some View {
        VStack(spacing: 28) {
            Spacer()

            ZStack {
                Circle()
                    .fill(CTheme.positive)
                    .frame(width: 84, height: 84)
                    .shadow(color: CTheme.positive.opacity(0.45),
                            radius: 24, x: 0, y: 10)
                Image(systemName: "checkmark")
                    .font(.system(size: 32, weight: .black))
                    .foregroundStyle(.white)
            }

            VStack(spacing: 8) {
                Text("You're all set")
                    .font(.system(size: 26, weight: .heavy))
                    .tracking(-0.5)
                    .foregroundStyle(CTheme.textPrimary)
                Text("Press the red button — or ⌘N — to start your first recording.")
                    .multilineTextAlignment(.center)
                    .font(.system(size: 13))
                    .foregroundStyle(CTheme.textSecondary)
            }

            VStack(alignment: .leading, spacing: 12) {
                TipRow(kbd: "⌘N", text: "Start a new recording from anywhere in the app.")
                TipRow(kbd: "ESC", text: "Stop the current recording.")
                TipRow(kbd: "⌘,", text: "Open settings — tweak fps, quality, and audio defaults.")
            }
            .padding(18)
            .frame(maxWidth: 420)
            .cineCard(radius: CTheme.Radius.lg)

            Spacer()

            Button(action: onFinish) { Text("Start Using CineScreen") }
                .buttonStyle(CineFilledButtonStyle(palette: .accent))
                .padding(.bottom, 48)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 60)
    }
}

// MARK: - Shared building blocks

private struct StepShell<Content: View>: View {
    let title: String
    let subtitle: String
    let primaryTitle: String
    let primaryEnabled: Bool
    var onPrimary: () -> Void
    var onBack: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 24, weight: .heavy))
                    .tracking(-0.4)
                    .foregroundStyle(CTheme.textPrimary)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(CTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 460)
            }
            .padding(.top, 36)
            .padding(.bottom, 28)

            content()
                .frame(maxWidth: 520)

            Spacer()

            HStack {
                Button("Back", action: onBack)
                    .buttonStyle(SecondaryButtonStyle())
                Spacer()
                PrimaryButton(title: primaryTitle, action: onPrimary)
                    .opacity(primaryEnabled ? 1.0 : 0.45)
                    .allowsHitTesting(primaryEnabled)
            }
            .frame(maxWidth: 520)
            .padding(.bottom, 36)
        }
        .padding(.horizontal, 60)
    }
}

private struct PermissionCard: View {
    let icon: String
    let title: String
    let detail: String
    let state: PermissionState
    let required: Bool
    var onGrant: () -> Void

    private var isGranted: Bool { state == .granted }

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            CineIconChip(symbol: icon, tint: isGranted ? CTheme.positive : CTheme.accent, size: 40)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(CTheme.textPrimary)
                    if required {
                        Text("Required")
                            .font(.system(size: 9, weight: .bold))
                            .tracking(0.5)
                            .foregroundStyle(CTheme.warning)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(
                                Capsule().fill(CTheme.warning.opacity(0.14))
                            )
                    }
                }
                Text(detail)
                    .font(.system(size: 11.5))
                    .foregroundStyle(CTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            if isGranted {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 13))
                    Text("Granted")
                        .font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(CTheme.positive)
                .transition(.scale(scale: 0.85).combined(with: .opacity))
            } else {
                Button("Grant", action: onGrant)
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(14)
        .cineCard(
            radius: CTheme.Radius.lg,
            stroke: isGranted ? CTheme.positive.opacity(0.35) : CTheme.stroke
        )
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isGranted)
    }
}

private struct TipRow: View {
    let kbd: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Text(kbd)
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(CTheme.textPrimary)
                .frame(minWidth: 36)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(
                    RoundedRectangle(cornerRadius: CTheme.Radius.xs)
                        .fill(CTheme.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: CTheme.Radius.xs)
                                .strokeBorder(CTheme.stroke, lineWidth: 1)
                        )
                )
            Text(text)
                .font(.system(size: 12))
                .foregroundStyle(CTheme.textSecondary)
            Spacer()
        }
    }
}

private struct PrimaryButton: View {
    let title: String
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(Color.black.opacity(0.88))
                .padding(.horizontal, 22)
                .padding(.vertical, 12)
                .background(
                    CTheme.accentGradient,
                    in: Capsule()
                )
                .overlay(
                    Capsule().strokeBorder(Color.white.opacity(0.22), lineWidth: 1)
                )
                .shadow(color: CTheme.accent.opacity(hovering ? 0.55 : 0.35),
                        radius: hovering ? 22 : 14, x: 0, y: hovering ? 10 : 6)
                .scaleEffect(hovering ? 1.02 : 1.0)
                .animation(.spring(response: 0.3, dampingFraction: 0.8), value: hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

private struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(CTheme.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                Capsule()
                    .fill(configuration.isPressed ? CTheme.surfaceHi : CTheme.surface)
                    .overlay(
                        Capsule().strokeBorder(CTheme.stroke, lineWidth: 1)
                    )
            )
    }
}
