import Foundation

/// One CineScreen project on disk. A project is a folder containing the
/// recording video and its metadata JSON sidecar (plus future thumbnails,
/// edit history, etc.). This abstracts the user-visible concept away from
/// "two separate files."
struct Project: Identifiable, Hashable {
    var id: URL { folderURL }
    /// The directory the project lives in.
    var folderURL: URL
    /// Human-readable name. Defaults to the folder's display name.
    var name: String
    var createdAt: Date
    /// Discovered video URL inside the folder (`recording.mov` by convention).
    var videoURL: URL?
    /// Discovered metadata URL (`recording.json` by convention).
    var metadataURL: URL?
    /// Discovered webcam URL (`webcam.mp4`) — nil if the recording was made
    /// without webcam.
    var webcamURL: URL?

    static let videoFileName = "recording.mp4"
    static let metadataFileName = "recording.json"
    static let projectFileName = "project.json"
    static let thumbnailFileName = "thumbnail.jpg"
    static let webcamFileName = "webcam.mp4"

    var thumbnailURL: URL { folderURL.appendingPathComponent(Self.thumbnailFileName) }

    var isComplete: Bool { videoURL != nil && metadataURL != nil }

    var fallbackVideoURL: URL { folderURL.appendingPathComponent(Self.videoFileName) }
    var fallbackMetadataURL: URL { folderURL.appendingPathComponent(Self.metadataFileName) }
    var fallbackWebcamURL: URL { folderURL.appendingPathComponent(Self.webcamFileName) }
    var projectFileURL: URL { folderURL.appendingPathComponent(Self.projectFileName) }
}

/// On-disk descriptor written into the project folder. Lets us track
/// editor-specific state that doesn't belong in the recording metadata.
struct ProjectDescriptor: Codable, Equatable {
    var name: String
    var createdAtMs: Double
    /// Schema version for future migrations.
    var schemaVersion: Int = 1
}
