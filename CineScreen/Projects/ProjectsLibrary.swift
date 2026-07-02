import Foundation
import AppKit

/// Manages a single root directory of projects on disk. Lists, creates,
/// and deletes projects. Acts as the bridge between the project-based UX
/// and the underlying `recording.mp4 + recording.json` files.
@MainActor
final class ProjectsLibrary {
    /// Default location: `~/Documents/CineScreen`.
    static var defaultRootDirectory: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Documents", isDirectory: true)
        return docs.appendingPathComponent("CineScreen", isDirectory: true)
    }

    // MARK: - Listing

    /// Returns the projects in `root` sorted by createdAt descending.
    static func projects(in root: URL) -> [Project] {
        let fm = FileManager.default
        try? fm.createDirectory(at: root, withIntermediateDirectories: true)
        let entries: [URL] = (try? fm.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey, .creationDateKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        )) ?? []

        var results: [Project] = []
        for url in entries {
            guard (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { continue }
            // Only folders that carry CineScreen artifacts are projects.
            // Settings lets users point the library at any directory —
            // without this check every subfolder rendered as an "Incomplete"
            // project whose Delete destroyed arbitrary user data. The video
            // fallback keeps pre-descriptor recordings visible.
            let hasDescriptor = fm.fileExists(atPath: url.appendingPathComponent(Project.projectFileName).path)
            let hasVideo = fm.fileExists(atPath: url.appendingPathComponent(Project.videoFileName).path)
            guard hasDescriptor || hasVideo else { continue }
            results.append(load(from: url))
        }
        results.sort { $0.createdAt > $1.createdAt }
        return results
    }

    /// Builds a `Project` from a folder on disk, reading the descriptor if
    /// present and falling back to filesystem metadata.
    static func load(from folder: URL) -> Project {
        let fm = FileManager.default
        var descriptor: ProjectDescriptor?
        let descriptorURL = folder.appendingPathComponent(Project.projectFileName)
        if let data = try? Data(contentsOf: descriptorURL),
           let parsed = try? JSONDecoder().decode(ProjectDescriptor.self, from: data) {
            descriptor = parsed
        }

        let candidateVideo = folder.appendingPathComponent(Project.videoFileName)
        let candidateMetadata = folder.appendingPathComponent(Project.metadataFileName)
        let candidateWebcam = folder.appendingPathComponent(Project.webcamFileName)
        let videoURL = fm.fileExists(atPath: candidateVideo.path) ? candidateVideo : nil
        let metadataURL = fm.fileExists(atPath: candidateMetadata.path) ? candidateMetadata : nil
        let webcamURL = fm.fileExists(atPath: candidateWebcam.path) ? candidateWebcam : nil

        let createdAt: Date
        if let descriptor = descriptor {
            createdAt = Date(timeIntervalSince1970: descriptor.createdAtMs / 1000)
        } else if let fsCreation = try? folder.resourceValues(forKeys: [.creationDateKey]).creationDate {
            createdAt = fsCreation
        } else {
            createdAt = .distantPast
        }
        let name = descriptor?.name ?? folder.lastPathComponent

        return Project(
            folderURL: folder,
            name: name,
            createdAt: createdAt,
            videoURL: videoURL,
            metadataURL: metadataURL,
            webcamURL: webcamURL
        )
    }

    // MARK: - Mutations

    /// Creates a new empty project folder under `root`. Returns the project
    /// — the caller starts the recording into `project.fallbackVideoURL`.
    static func createNew(in root: URL, name: String? = nil) throws -> Project {
        let fm = FileManager.default
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        let stamp = Self.timestampFormatter.string(from: Date())
        let folderName = name?.isEmpty == false ? name! : "Recording \(stamp)"
        var folder = root.appendingPathComponent(folderName, isDirectory: true)
        // Avoid clashing with an existing folder.
        var counter = 2
        while fm.fileExists(atPath: folder.path) {
            folder = root.appendingPathComponent("\(folderName) (\(counter))", isDirectory: true)
            counter += 1
        }
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)

        let now = Date()
        let descriptor = ProjectDescriptor(
            name: folder.lastPathComponent,
            createdAtMs: now.timeIntervalSince1970 * 1000
        )
        try writeDescriptor(descriptor, to: folder)

        return Project(
            folderURL: folder,
            name: folder.lastPathComponent,
            createdAt: now,
            videoURL: nil,
            metadataURL: nil,
            webcamURL: nil
        )
    }

    static func writeDescriptor(_ descriptor: ProjectDescriptor, to folder: URL) throws {
        let url = folder.appendingPathComponent(Project.projectFileName)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(descriptor).write(to: url, options: .atomic)
    }

    /// Renames the project folder and updates its descriptor, preserving the
    /// original creation date. Throws if a folder with the new name already
    /// exists. Note: renaming a project that's open in a Studio window leaves
    /// that window pointing at the old path until it's reopened.
    static func rename(_ project: Project, to newName: String) throws -> Project {
        let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != project.name else { return project }
        let dest = project.folderURL.deletingLastPathComponent()
            .appendingPathComponent(trimmed, isDirectory: true)
        try FileManager.default.moveItem(at: project.folderURL, to: dest)
        try writeDescriptor(
            ProjectDescriptor(name: trimmed, createdAtMs: project.createdAt.timeIntervalSince1970 * 1000),
            to: dest
        )
        return load(from: dest)
    }

    /// Copies the whole project folder as "Name copy" (then "copy 2", …).
    static func duplicate(_ project: Project) throws -> Project {
        let fm = FileManager.default
        let parent = project.folderURL.deletingLastPathComponent()
        var name = "\(project.name) copy"
        var dest = parent.appendingPathComponent(name, isDirectory: true)
        var counter = 2
        while fm.fileExists(atPath: dest.path) {
            name = "\(project.name) copy \(counter)"
            dest = parent.appendingPathComponent(name, isDirectory: true)
            counter += 1
        }
        try fm.copyItem(at: project.folderURL, to: dest)
        try writeDescriptor(
            ProjectDescriptor(name: name, createdAtMs: Date().timeIntervalSince1970 * 1000),
            to: dest
        )
        return load(from: dest)
    }

    /// Moves the project folder to the Trash — recoverable, unlike a hard
    /// delete. Deliberately no `removeItem` fallback: on volumes without a
    /// Trash this throws, and the caller surfaces the error, rather than
    /// silently escalating to permanent deletion.
    static func delete(_ project: Project) throws {
        try FileManager.default.trashItem(at: project.folderURL, resultingItemURL: nil)
    }

    static func reveal(_ project: Project) {
        NSWorkspace.shared.activateFileViewerSelecting([project.folderURL])
    }

    // MARK: - Helpers

    private static let timestampFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH-mm-ss"
        return f
    }()
}

