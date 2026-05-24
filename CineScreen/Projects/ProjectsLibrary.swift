import Foundation
import AppKit

/// Manages a single root directory of projects on disk. Lists, creates,
/// renames, and deletes projects. Acts as the bridge between the new
/// project-based UX and the underlying `.mov + .json` files.
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

    static func delete(_ project: Project) throws {
        try FileManager.default.removeItem(at: project.folderURL)
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

