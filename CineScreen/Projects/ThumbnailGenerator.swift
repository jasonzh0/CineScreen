import Foundation
import AVFoundation
import AppKit

/// Pulls the first frame of a recording and writes it as a JPEG sidecar
/// (`thumbnail.jpg`) inside the project folder, so ProjectTile can show it
/// instead of a generic icon.
enum ThumbnailGenerator {
    /// Generates and caches a thumbnail at `project.thumbnailURL`. Returns
    /// the URL if a thumbnail is available on disk after the call. No-ops if
    /// one already exists.
    static func ensureThumbnail(for project: Project) async -> URL? {
        let dest = project.thumbnailURL
        let fm = FileManager.default
        if fm.fileExists(atPath: dest.path) { return dest }
        guard let videoURL = project.videoURL,
              fm.fileExists(atPath: videoURL.path) else { return nil }

        let asset = AVURLAsset(url: videoURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        // Cap the rendered thumbnail at ~640px wide — plenty for a project tile.
        generator.maximumSize = CGSize(width: 640, height: 360)

        do {
            // Pick a frame ~10% into the clip (or 0.5s, whichever is sooner)
            // so we skip the blank "first frame after session start" case.
            let duration = try await asset.load(.duration).seconds
            let time = CMTime(seconds: min(0.5, max(0.0, duration * 0.1)),
                              preferredTimescale: 600)
            let (cgImage, _) = try await generator.image(at: time)
            try writeJPEG(cgImage, to: dest)
            return dest
        } catch {
            return nil
        }
    }

    private static func writeJPEG(_ cg: CGImage, to url: URL) throws {
        let rep = NSBitmapImageRep(cgImage: cg)
        guard let data = rep.representation(using: .jpeg,
                                            properties: [.compressionFactor: 0.85]) else {
            throw NSError(domain: "ThumbnailGenerator", code: 1)
        }
        try data.write(to: url, options: .atomic)
    }
}
