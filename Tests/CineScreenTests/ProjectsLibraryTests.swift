import XCTest
@testable import CineScreen

final class ProjectsLibraryTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("CineScreenTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    @MainActor
    func testCreateNewWritesDescriptorAndAvoidsCollisions() throws {
        let a = try ProjectsLibrary.createNew(in: root, name: "Take")
        let b = try ProjectsLibrary.createNew(in: root, name: "Take")
        XCTAssertNotEqual(a.folderURL, b.folderURL)
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: a.folderURL.appendingPathComponent(Project.projectFileName).path
        ))
    }

    /// The library must never present arbitrary folders as projects —
    /// Settings allows pointing it at any directory, and Delete moves listed
    /// folders to the Trash.
    @MainActor
    func testListingIgnoresFoldersWithoutCineScreenArtifacts() throws {
        _ = try ProjectsLibrary.createNew(in: root, name: "Real")
        let foreign = root.appendingPathComponent("Vacation Photos", isDirectory: true)
        try FileManager.default.createDirectory(at: foreign, withIntermediateDirectories: true)

        let listed = ProjectsLibrary.projects(in: root)
        XCTAssertEqual(listed.count, 1)
        XCTAssertEqual(listed.first?.name, "Real")
    }

    @MainActor
    func testRenameMovesFolderAndPreservesCreationDate() throws {
        let original = try ProjectsLibrary.createNew(in: root, name: "Before")
        let renamed = try ProjectsLibrary.rename(original, to: "After")
        XCTAssertEqual(renamed.name, "After")
        XCTAssertFalse(FileManager.default.fileExists(atPath: original.folderURL.path))
        XCTAssertEqual(
            renamed.createdAt.timeIntervalSince1970,
            original.createdAt.timeIntervalSince1970,
            accuracy: 0.01
        )
    }

    @MainActor
    func testDuplicateCopiesArtifactsAndAvoidsCollisions() throws {
        let original = try ProjectsLibrary.createNew(in: root, name: "Take")
        FileManager.default.createFile(
            atPath: original.fallbackVideoURL.path,
            contents: Data([1, 2, 3])
        )
        let copy = try ProjectsLibrary.duplicate(original)
        let copy2 = try ProjectsLibrary.duplicate(original)
        XCTAssertNotEqual(copy.folderURL, original.folderURL)
        XCTAssertNotEqual(copy2.folderURL, copy.folderURL)
        XCTAssertTrue(FileManager.default.fileExists(atPath: copy.fallbackVideoURL.path))
        XCTAssertEqual(ProjectsLibrary.projects(in: root).count, 3)
    }

    /// Pre-descriptor recordings (video only, no project.json) stay visible.
    @MainActor
    func testListingKeepsFoldersWithVideoButNoDescriptor() throws {
        let legacy = root.appendingPathComponent("Old Recording", isDirectory: true)
        try FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
        FileManager.default.createFile(
            atPath: legacy.appendingPathComponent(Project.videoFileName).path,
            contents: Data([0x00])
        )
        XCTAssertEqual(ProjectsLibrary.projects(in: root).count, 1)
    }
}
