import XCTest
import AVFoundation
import CoreVideo
import ImageIO
@testable import CineScreen

/// Real decoder → GPU shaders → MP4/GIF encoder regression coverage. Fixtures
/// are generated locally so this suite has no ffmpeg or media-download dependency.
@MainActor
final class ExportIntegrationTests: XCTestCase {
    func testMP4CutsAndSpeedRenderCorrectPixelsAspectAndAudioDuration() async throws {
        let folder = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let source = try await ExportFixtures.make(in: folder)
        let output = folder.appendingPathComponent("edited.mp4")
        let calls = ExportTimestampProbe()
        _ = try await ExportPipeline().export(input(source: source, output: output, format: .mp4, calls: calls), onProgress: { _ in })

        let asset = AVURLAsset(url: output)
        let duration = try await asset.load(.duration)
        XCTAssertEqual(duration.seconds, 2.5, accuracy: 0.035)
        let videos = try await asset.loadTracks(withMediaType: .video)
        let audios = try await asset.loadTracks(withMediaType: .audio)
        let video = try XCTUnwrap(videos.first)
        let audio = try XCTUnwrap(audios.first)
        let size = try await video.load(.naturalSize)
        XCTAssertEqual(size.width, 180)
        XCTAssertEqual(size.height, 320)
        let audioRange = try await audio.load(.timeRange)
        XCTAssertEqual(audioRange.end.seconds, 2.5, accuracy: 0.002)
        XCTAssertGreaterThan(try audioPeak(asset: asset, track: audio), 1_000, "Retimed audio must contain the fixture tone")

        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        let first = try generator.copyCGImage(at: CMTime(seconds: 0.25, preferredTimescale: 600), actualTime: nil)
        let second = try generator.copyCGImage(at: CMTime(seconds: 1.5, preferredTimescale: 600), actualTime: nil)
        let sourceGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: source))
        let sourceGreen = try sourceGenerator.copyCGImage(at: CMTime(seconds: 2.5, preferredTimescale: 600), actualTime: nil)
        let sourceGreenPixel = try centerPixel(sourceGreen)
        let exportedGreenPixel = try centerPixel(second)
        for channel in 0..<3 {
            XCTAssertEqual(Double(sourceGreenPixel[channel]), Double(exportedGreenPixel[channel]), accuracy: 10,
                           "The encoded export must preserve the source color in the same sRGB space")
        }
        assertRed(try centerPixel(first))
        assertGreen(try centerPixel(second))
        assertRetainedSourceTimes(calls.values)
    }

    func testGIFUsesSameCutsSpeedAspectAndPixels() async throws {
        let folder = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let source = try await ExportFixtures.make(in: folder)
        let output = folder.appendingPathComponent("edited.gif")
        let calls = ExportTimestampProbe()
        _ = try await ExportPipeline().export(input(source: source, output: output, format: .gif, calls: calls), onProgress: { _ in })

        let imageSource = try XCTUnwrap(CGImageSourceCreateWithURL(output as CFURL, nil))
        XCTAssertEqual(CGImageSourceGetCount(imageSource), 38) // ceil(2.5s × 15fps)
        let first = try XCTUnwrap(CGImageSourceCreateImageAtIndex(imageSource, 3, nil))
        let second = try XCTUnwrap(CGImageSourceCreateImageAtIndex(imageSource, 22, nil))
        XCTAssertEqual(first.width, 180)
        XCTAssertEqual(first.height, 320)
        assertRed(try centerPixel(first))
        assertGreen(try centerPixel(second))
        assertRetainedSourceTimes(calls.values)
    }

    func testEmptyEditRejectsExportAndPreservesExistingDestination() async throws {
        let folder = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let source = try await ExportFixtures.make(in: folder)
        let output = folder.appendingPathComponent("existing.mp4")
        let previous = Data("previous export".utf8)
        try previous.write(to: output)
        var request = input(source: source, output: output, format: .mp4, calls: ExportTimestampProbe())
        request.editSegments = []
        do {
            _ = try await ExportPipeline().export(request, onProgress: { _ in })
            XCTFail("An empty edit must not silently export the original clip")
        } catch ExportError.emptyTimeline {
            XCTAssertEqual(try Data(contentsOf: output), previous)
        }
    }

    func testLegacyAudioHostTimestampsCannotExtendTheVideoExport() async throws {
        let folder = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let source = try await ExportFixtures.make(in: folder, audioStartSeconds: 1234)
        let sourceDuration = try await AVURLAsset(url: source).load(.duration)
        XCTAssertGreaterThan(sourceDuration.seconds, 1234)
        let output = folder.appendingPathComponent("bounded.gif")
        let request = ExportPipeline.Input(sourceVideoURL: source, outputURL: output,
                                           trimRangeMs: 0..<0, cursorAt: { _ in nil }, format: .gif)
        _ = try await ExportPipeline().export(request, onProgress: { _ in })
        let imageSource = try XCTUnwrap(CGImageSourceCreateWithURL(output as CFURL, nil))
        XCTAssertEqual(CGImageSourceGetCount(imageSource), 60, "Only the 4-second screen track bounds the export")
    }

    func testGPUCropCornerRoundingAndDirectionalShadowUseRequestedFraming() throws {
        let compositor = try XCTUnwrap(ExportCompositor())
        let source = try gpuBuffer(width: 200, height: 100)
        CVPixelBufferLockBaseAddress(source, [])
        let base = try XCTUnwrap(CVPixelBufferGetBaseAddress(source)).assumingMemoryBound(to: UInt8.self)
        let rowBytes = CVPixelBufferGetBytesPerRow(source)
        for y in 0..<100 { for x in 0..<200 {
            let index = y * rowBytes + x * 4
            base[index] = 0
            base[index + 1] = x >= 100 ? 255 : 0
            base[index + 2] = x < 100 ? 255 : 0
            base[index + 3] = 255
        } }
        CVPixelBufferUnlockBaseAddress(source, [])
        let output = OutputSettings(aspectRatio: .square, crop: NormalizedCrop(x: 0.5, y: 0, width: 0.5, height: 1))
        let square = try gpuBuffer(width: 200, height: 200)
        var style = CanvasStyle(padding: 0.2, background: .solid("#FFFFFF"), dropShadow: false,
                                shadowStrength: 0.7, shadowSoftness: 0.14, shadowDistance: 0.12,
                                shadowAngle: 90, cornerRadius: 0)
        XCTAssertTrue(compositor.render(source: source, cursor: nil, canvas: style, output: output, destination: square))
        // An asymmetric right-half crop must remain right-half at identity;
        // sampling both interior sides catches an accidental source-center reset.
        assertGreen(try bufferPixel(square, x: 45, y: 100))
        assertGreen(try bufferPixel(square, x: 155, y: 100))
        assertGreen(try bufferPixel(square, x: 42, y: 42))

        let rounded = try gpuBuffer(width: 200, height: 200)
        style.cornerRadius = 0.15
        XCTAssertTrue(compositor.render(source: source, cursor: nil, canvas: style, output: output, destination: rounded))
        let roundedCorner = try bufferPixel(rounded, x: 42, y: 42)
        XCTAssertGreaterThan(roundedCorner[0], 230)
        XCTAssertGreaterThan(roundedCorner[1], 230)
        XCTAssertGreaterThan(roundedCorner[2], 230)
        assertGreen(try bufferPixel(rounded, x: 100, y: 100))

        let shadowed = try gpuBuffer(width: 200, height: 200)
        style.dropShadow = true
        XCTAssertTrue(compositor.render(source: source, cursor: nil, canvas: style, output: output, destination: shadowed))
        let below = try (161...195).map { Int(try bufferPixel(shadowed, x: 100, y: $0)[0]) }.min()!
        let above = try (5...38).map { Int(try bufferPixel(shadowed, x: 100, y: $0)[0]) }.min()!
        XCTAssertLessThan(below, 245, "A visible shadow must shade the white canvas below the content")
        XCTAssertLessThan(below, above - 5, "90-degree lighting must cast the stronger shadow downward")
        XCTAssertGreaterThan(try bufferPixel(shadowed, x: 5, y: 5)[0], 245)

        let clicked = try gpuBuffer(width: 200, height: 200)
        let click = ClickRingState(centerInVideoPixels: SIMD2(150, 50), radiusInPixels: 10,
                                   thicknessInPixels: 2, color: SIMD4(1, 0, 0, 1))
        XCTAssertTrue(compositor.render(source: source, cursor: nil, clicks: [click], canvas: .none,
                                        output: output, destination: clicked))
        // The 100px-wide source crop fills 200px, so a 10px source radius
        // must draw at 20px. The former half-radius shader leaves x=118 green.
        assertRed(try bufferPixel(clicked, x: 118, y: 100))
        assertGreen(try bufferPixel(clicked, x: 110, y: 100))
    }

    private func gpuBuffer(width: Int, height: Int) throws -> CVPixelBuffer {
        var buffer: CVPixelBuffer?
        let attributes: [String: Any] = [kCVPixelBufferMetalCompatibilityKey as String: true,
                                         kCVPixelBufferIOSurfacePropertiesKey as String: [:]]
        let status = CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, attributes as CFDictionary, &buffer)
        XCTAssertEqual(status, kCVReturnSuccess)
        return try XCTUnwrap(buffer)
    }

    private func bufferPixel(_ buffer: CVPixelBuffer, x: Int, y: Int) throws -> [UInt8] {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let base = try XCTUnwrap(CVPixelBufferGetBaseAddress(buffer)).assumingMemoryBound(to: UInt8.self)
        let index = y * CVPixelBufferGetBytesPerRow(buffer) + x * 4
        return [base[index + 2], base[index + 1], base[index], base[index + 3]]
    }

    private func input(source: URL, output: URL, format: ExportPipeline.Format, calls: ExportTimestampProbe) -> ExportPipeline.Input {
        ExportPipeline.Input(sourceVideoURL: source, outputURL: output, trimRangeMs: 0..<0,
                             cursorAt: { time in calls.record(time); return nil },
                             format: format,
                             editSegments: [EditSegment(startMs: 0, endMs: 1_000, speed: 2),
                                            EditSegment(startMs: 2_000, endMs: 3_000, speed: 0.5)],
                             output: OutputSettings(aspectRatio: .vertical, frameRate: 30))
    }

    private func assertRetainedSourceTimes(_ times: [Double], file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertFalse(times.isEmpty, file: file, line: line)
        XCTAssertTrue(times.contains { $0 >= 2_000 }, file: file, line: line)
        XCTAssertTrue(times.allSatisfy { ($0 >= 0 && $0 < 1_000) || ($0 >= 2_000 && $0 < 3_000) }, file: file, line: line)
    }

    private func assertRed(_ pixel: [UInt8], file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertGreaterThan(pixel[0], 180, file: file, line: line)
        XCTAssertLessThan(pixel[1], 70, file: file, line: line)
        XCTAssertLessThan(pixel[2], 70, file: file, line: line)
    }

    private func assertGreen(_ pixel: [UInt8], file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertLessThan(pixel[0], 70, file: file, line: line)
        XCTAssertGreaterThan(pixel[1], 180, file: file, line: line)
        XCTAssertLessThan(pixel[2], 70, file: file, line: line)
    }

    private func audioPeak(asset: AVAsset, track: AVAssetTrack) throws -> Int {
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ])
        reader.add(output)
        XCTAssertTrue(reader.startReading())
        var peak = 0
        while let sample = output.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
            let length = CMBlockBufferGetDataLength(block)
            var values = [Int16](repeating: 0, count: length / 2)
            let status = values.withUnsafeMutableBytes { bytes in
                CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: bytes.baseAddress!)
            }
            XCTAssertEqual(status, kCMBlockBufferNoErr)
            peak = max(peak, values.map { abs(Int($0)) }.max() ?? 0)
        }
        XCTAssertEqual(reader.status, .completed, reader.error?.localizedDescription ?? "")
        return peak
    }

    private func centerPixel(_ image: CGImage, colorSpace: CGColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!) throws -> [UInt8] {
        var pixels = [UInt8](repeating: 0, count: image.width * image.height * 4)
        try pixels.withUnsafeMutableBytes { bytes in
            let context = try XCTUnwrap(CGContext(data: bytes.baseAddress, width: image.width, height: image.height,
                                                 bitsPerComponent: 8, bytesPerRow: image.width * 4,
                                                 space: colorSpace,
                                                 bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        let index = ((image.height / 2) * image.width + image.width / 2) * 4
        return Array(pixels[index..<(index + 4)])
    }

    private func temporaryFolder() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("cinescreen-export-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }


}

private final class ExportTimestampProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var timestamps: [Double] = []
    func record(_ time: Double) { lock.lock(); defer { lock.unlock() }; timestamps.append(time) }
    var values: [Double] { lock.lock(); defer { lock.unlock() }; return timestamps }
}
