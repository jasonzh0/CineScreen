import SwiftUI
import AppKit

/// Main-window root: a list of recent projects + a "New Recording" CTA.
struct ProjectsView: View {
    @Environment(AppState.self) private var state
    @Environment(\.openWindow) private var openWindow

    @State private var hoveredProject: Project.ID?
    /// Set when the user picks Delete — the confirmation dialog acts on it.
    @State private var projectPendingDeletion: Project?

    var body: some View {
        ZStack(alignment: .top) {
            backdrop

            VStack(spacing: 0) {
                header

                VStack(spacing: 10) {
                    if !state.permissions.allRequiredGranted {
                        permissionsBanner
                    }
                    if let message = state.statusMessage {
                        statusBanner(message)
                    }
                }
                .padding(.horizontal, 28)
                .padding(.bottom, state.permissions.allRequiredGranted && state.statusMessage == nil ? 0 : 8)

                if state.projects.isEmpty {
                    emptyState
                } else {
                    projectsGrid
                }
            }
        }
        .tint(CTheme.accent)
        .frame(minWidth: 720, minHeight: 540)
        .onAppear {
            state.refreshPermissions()
            state.refreshProjects()
            openPendingIfAny()
        }
        .onChange(of: state.pendingProjectToOpen) { _, _ in
            openPendingIfAny()
        }
        .confirmationDialog(
            "Move \u{201C}\(projectPendingDeletion?.name ?? "recording")\u{201D} to the Trash?",
            isPresented: Binding(
                get: { projectPendingDeletion != nil },
                set: { if !$0 { projectPendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Move to Trash", role: .destructive) {
                if let project = projectPendingDeletion {
                    deleteProject(project)
                }
                projectPendingDeletion = nil
            }
        } message: {
            Text("The recording and its edits can be restored from the Trash.")
        }
    }

    // MARK: - Backdrop

    private var backdrop: some View {
        CineBackdrop()
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("CineScreen")
                    .font(.system(size: 28, weight: .heavy))
                    .tracking(-0.5)
                    .foregroundStyle(CTheme.textPrimary)
                Text(state.projectsDirectory.path)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(CTheme.textTertiary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer(minLength: 8)
            newRecordingButton
        }
        .padding(.horizontal, 28)
        .padding(.top, 22)
        .padding(.bottom, 22)
    }

    private var newRecordingButton: some View {
        Button {
            Task { await state.refreshAvailableWindows() }
            state.refreshPermissions()
            ControlBarController.shared.show(state: state)
        } label: {
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.55), lineWidth: 1)
                        .frame(width: 16, height: 16)
                    Circle()
                        .fill(.white)
                        .frame(width: 8, height: 8)
                }
                Text("New Recording")
            }
        }
        .buttonStyle(CineFilledButtonStyle(palette: .record))
        .cineHover()
        .disabled(!state.permissions.allRequiredGranted)
        .opacity(state.permissions.allRequiredGranted ? 1.0 : 0.5)
    }

    // MARK: - Grid

    private var projectsGrid: some View {
        ScrollView {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 260), spacing: 20)],
                spacing: 20
            ) {
                ForEach(state.projects) { project in
                    ProjectTile(
                        project: project,
                        isHovered: hoveredProject == project.id
                    ) {
                        if let videoURL = project.videoURL {
                            openWindow(id: "studio", value: videoURL)
                        }
                    } onReveal: {
                        ProjectsLibrary.reveal(project)
                    } onDelete: {
                        projectPendingDeletion = project
                    }
                    .onHover { hovering in
                        hoveredProject = hovering ? project.id : nil
                    }
                }
            }
            .padding(.horizontal, 28)
            .padding(.top, 4)
            .padding(.bottom, 32)
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "video")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(CTheme.textTertiary)
            Text("No recordings yet")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(CTheme.textPrimary)
            Text("Click New Recording to capture your first project.")
                .font(.system(size: 12))
                .foregroundStyle(CTheme.textSecondary)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 28)
        .padding(.bottom, 60)
    }

    // MARK: - Banners

    private func statusBanner(_ message: String) -> some View {
        let isError = message.lowercased().contains("fail") || message.lowercased().contains("error")
        let accent = isError ? CTheme.danger : CTheme.positive
        return HStack(alignment: .center, spacing: 12) {
            Circle().fill(accent).frame(width: 8, height: 8)
            Text(message)
                .font(.system(size: 12.5))
                .foregroundStyle(CTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
            Button { state.statusMessage = nil } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(CTheme.textSecondary)
                    .padding(8)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .cineCard(radius: CTheme.Radius.sm, stroke: accent.opacity(0.25))
    }

    private var permissionsBanner: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.shield.fill")
                .font(.system(size: 16))
                .foregroundStyle(CTheme.warning)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                Text("Permission required")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(CTheme.textPrimary)
                Text("Grant Screen Recording and Accessibility in Settings (⌘,) to capture your screen.")
                    .font(.system(size: 12))
                    .foregroundStyle(CTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .cineCard(radius: CTheme.Radius.sm, stroke: CTheme.warning.opacity(0.28))
    }

    // MARK: - Helpers

    private func openPendingIfAny() {
        guard let url = state.pendingProjectToOpen else { return }
        state.pendingProjectToOpen = nil
        openWindow(id: "studio", value: url)
    }

    private func deleteProject(_ project: Project) {
        do {
            try ProjectsLibrary.delete(project)
            state.refreshProjects()
        } catch {
            // "failed" keys the status banner's error styling.
            state.statusMessage = "Delete failed: \(error.localizedDescription)"
        }
    }
}

// MARK: - Project tile

private struct ProjectTile: View {
    let project: Project
    let isHovered: Bool
    var onOpen: () -> Void
    var onReveal: () -> Void
    var onDelete: () -> Void

    @State private var thumbnail: NSImage?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            thumbnailView
            footer
        }
        .padding(8)
        .cineCard(
            radius: CTheme.Radius.md,
            fill: isHovered ? CTheme.surfaceHi : CTheme.surfaceLo,
            stroke: isHovered ? CTheme.strokeHi : CTheme.stroke
        )
        .shadow(color: .black.opacity(isHovered ? 0.4 : 0.18),
                radius: isHovered ? 22 : 10,
                x: 0,
                y: isHovered ? 12 : 5)
        .offset(y: isHovered ? -2 : 0)
        .animation(.spring(response: 0.32, dampingFraction: 0.85), value: isHovered)
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { if project.isComplete { onOpen() } }
        .contextMenu {
            Button("Open") { onOpen() }
                .disabled(!project.isComplete)
            Button("Reveal in Finder") { onReveal() }
            Divider()
            Button("Delete", role: .destructive) { onDelete() }
        }
    }

    private var thumbnailView: some View {
        Button {
            if project.isComplete { onOpen() }
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 6).fill(.black)
                if let thumbnail = thumbnail {
                    Image(nsImage: thumbnail)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                } else {
                    Image(systemName: project.isComplete ? "play.rectangle" : "exclamationmark.triangle")
                        .font(.system(size: 26, weight: .light))
                        .foregroundStyle(project.isComplete
                                         ? CTheme.textTertiary
                                         : CTheme.warning)
                }

                if isHovered && project.isComplete {
                    Image(systemName: "play.fill")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.black)
                        .padding(14)
                        .background(Circle().fill(.white))
                        .shadow(color: .black.opacity(0.4), radius: 10, y: 4)
                        .transition(.scale(scale: 0.85).combined(with: .opacity))
                }
            }
            .aspectRatio(16.0/9.0, contentMode: .fit)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!project.isComplete)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .task(id: project.folderURL) { await loadThumbnail() }
    }

    private var footer: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(project.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(CTheme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(relative(project.createdAt))
                    .font(.system(size: 11))
                    .foregroundStyle(CTheme.textSecondary)
            }
            Spacer()
            if !project.isComplete {
                Text("Incomplete")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(CTheme.warning)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(
                        Capsule().fill(CTheme.warning.opacity(0.15))
                    )
            }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 2)
    }

    private func loadThumbnail() async {
        let fm = FileManager.default
        let url = project.thumbnailURL
        if !fm.fileExists(atPath: url.path) {
            _ = await ThumbnailGenerator.ensureThumbnail(for: project)
        }
        if fm.fileExists(atPath: url.path),
           let img = NSImage(contentsOf: url) {
            await MainActor.run { self.thumbnail = img }
        }
    }

    private func relative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
