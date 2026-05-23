import SwiftUI
import AppKit

/// Main-window root: a list of recent projects + a "New Recording" CTA.
/// Replaces the old tab-based UI.
struct ProjectsView: View {
    @Environment(AppState.self) private var state
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(spacing: 0) {
            header

            if !state.permissions.allRequiredGranted {
                permissionsBanner
            }

            if let message = state.statusMessage {
                statusBanner(message)
            }

            if state.projects.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 220), spacing: 16)],
                        spacing: 16
                    ) {
                        ForEach(state.projects) { project in
                            ProjectTile(project: project) {
                                if let videoURL = project.videoURL {
                                    openWindow(id: "studio", value: videoURL)
                                }
                            } onReveal: {
                                ProjectsLibrary.reveal(project)
                            } onDelete: {
                                deleteProject(project)
                            }
                        }
                    }
                    .padding(24)
                }
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear {
            state.refreshPermissions()
            state.refreshProjects()
            openPendingIfAny()
        }
        .onChange(of: state.pendingProjectToOpen) { _, _ in
            openPendingIfAny()
        }
    }

    // MARK: - Sections

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "video.fill")
                .font(.system(size: 22))
                .foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 2) {
                Text("CineScreen")
                    .font(.title2)
                    .fontWeight(.semibold)
                Text(state.projectsDirectory.path)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer()
            Button {
                Task { await state.refreshAvailableWindows() }
                state.refreshPermissions()
                ControlBarController.shared.show(state: state)
            } label: {
                Label("New Recording", systemImage: "record.circle.fill")
                    .fontWeight(.semibold)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(.red)
            .disabled(!state.permissions.allRequiredGranted)
        }
        .padding(.horizontal, 24)
        .padding(.top, 22)
        .padding(.bottom, 16)
    }

    private func statusBanner(_ message: String) -> some View {
        let isError = message.lowercased().contains("fail") || message.lowercased().contains("error")
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: isError ? "exclamationmark.octagon.fill" : "checkmark.seal.fill")
                .foregroundStyle(isError ? .red : .green)
            Text(message)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
            Button {
                state.statusMessage = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(
            (isError ? Color.red : Color.green).opacity(0.12),
            in: RoundedRectangle(cornerRadius: 10)
        )
        .padding(.horizontal, 24)
        .padding(.bottom, 12)
    }

    private var permissionsBanner: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.shield.fill")
                .foregroundStyle(.yellow)
                .font(.system(size: 20))
            VStack(alignment: .leading, spacing: 4) {
                Text("Permission required")
                    .fontWeight(.semibold)
                Text("Grant Screen Recording and Accessibility so CineScreen can capture your screen and track the cursor. Use the Settings window (⌘,) to grant them.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(14)
        .background(Color.yellow.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 24)
        .padding(.bottom, 12)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "tray")
                .font(.system(size: 44))
                .foregroundStyle(.tertiary)
            Text("No recordings yet")
                .font(.title3)
            Text("Click New Recording to capture your first project.\nProjects live in \(state.projectsDirectory.path).")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .font(.callout)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(40)
    }

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
            state.statusMessage = "Could not delete: \(error.localizedDescription)"
        }
    }
}

// MARK: - Project tile

private struct ProjectTile: View {
    let project: Project
    var onOpen: () -> Void
    var onReveal: () -> Void
    var onDelete: () -> Void

    @State private var thumbnail: NSImage?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.black.opacity(0.6))
                if let thumbnail = thumbnail {
                    Image(nsImage: thumbnail)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                } else {
                    Image(systemName: project.isComplete ? "play.rectangle.fill" : "exclamationmark.triangle")
                        .font(.system(size: 28))
                        .foregroundStyle(project.isComplete ? .white.opacity(0.85) : .yellow)
                }
            }
            .aspectRatio(16/9, contentMode: .fit)
            .task(id: project.folderURL) {
                await loadThumbnail()
            }

            Text(project.name)
                .font(.headline)
                .lineLimit(1)
                .truncationMode(.middle)

            Text(relative(project.createdAt))
                .font(.caption)
                .foregroundStyle(.secondary)

            if !project.isComplete {
                Text("Incomplete recording")
                    .font(.caption)
                    .foregroundStyle(.yellow)
            }
        }
        .padding(12)
        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { onOpen() }
        .contextMenu {
            Button("Open") { onOpen() }
                .disabled(!project.isComplete)
            Button("Reveal in Finder") { onReveal() }
            Divider()
            Button("Delete", role: .destructive) { onDelete() }
        }
    }

    private func relative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private func loadThumbnail() async {
        // Use cached thumbnail.jpg if present, otherwise generate it.
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
}
