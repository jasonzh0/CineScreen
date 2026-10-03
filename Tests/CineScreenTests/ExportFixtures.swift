import Foundation
import XCTest
import AVFoundation
import CoreVideo
@testable import CineScreen

/// Locally generated screen and audio fixture shared by playback/export tests.
@MainActor
enum ExportFixtures {
    static func make(in folder: URL, audioStartSeconds: Double = 0) async throws -> URL {
        let videoURL = folder.appendingPathComponent("colors.mov")
        let writer = try AVAssetWriter(outputURL: videoURL, fileType: .mov)
        let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 320, AVVideoHeightKey: 180,
            AVVideoColorPropertiesKey: [
                AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
            ],
        ])
        videoInput.expectsMediaDataInRealTime = false
        let attributes: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                                         kCVPixelBufferWidthKey as String: 320, kCVPixelBufferHeightKey as String: 180]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput, sourcePixelBufferAttributes: attributes)
        writer.add(videoInput)
        XCTAssertTrue(writer.startWriting())
        writer.startSession(atSourceTime: .zero)
        let deadline = Date().addingTimeInterval(20)
        for frame in 0..<120 {
            while !videoInput.isReadyForMoreMediaData {
                if writer.status == .failed { throw try XCTUnwrap(writer.error) }
                guard Date() < deadline else { throw ExportError.writeFailed("synthetic video writer timed out") }
                try await Task.sleep(for: .milliseconds(2))
            }
            var pixelBuffer: CVPixelBuffer?
            let status = CVPixelBufferCreate(kCFAllocatorDefault, 320, 180, kCVPixelFormatType_32BGRA, attributes as CFDictionary, &pixelBuffer)
            XCTAssertEqual(status, kCVReturnSuccess)
            let buffer = try XCTUnwrap(pixelBuffer)
            CVPixelBufferLockBaseAddress(buffer, [])
            let base = try XCTUnwrap(CVPixelBufferGetBaseAddress(buffer)).assumingMemoryBound(to: UInt8.self)
            let stride = CVPixelBufferGetBytesPerRow(buffer)
            // Red / blue / green / yellow source seconds make cuts visible.
            let colors: [[UInt8]] = [[0, 0, 255, 255], [255, 0, 0, 255], [0, 255, 0, 255], [0, 255, 255, 255]]
            let color = colors[frame / 30]
            for y in 0..<180 { for x in 0..<320 { for channel in 0..<4 { base[y * stride + x * 4 + channel] = color[channel] } } }
            CVPixelBufferUnlockBaseAddress(buffer, [])
            XCTAssertTrue(adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: 30)))
        }
        videoInput.markAsFinished()
        writer.endSession(atSourceTime: CMTime(seconds: 4, preferredTimescale: 600))
        await writer.finishWriting()
        XCTAssertEqual(writer.status, .completed, writer.error?.localizedDescription ?? "")

        let audioURL = folder.appendingPathComponent("tone.wav")
        try sineWave().write(to: audioURL)
        let videoAsset = AVURLAsset(url: videoURL), audioAsset = AVURLAsset(url: audioURL)
        let videoTracks = try await videoAsset.loadTracks(withMediaType: .video)
        let audioTracks = try await audioAsset.loadTracks(withMediaType: .audio)
        let sourceVideo = try XCTUnwrap(videoTracks.first)
        let sourceAudio = try XCTUnwrap(audioTracks.first)
        let composition = AVMutableComposition()
        let videoTrack = try XCTUnwrap(composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid))
        let audioTrack = try XCTUnwrap(composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid))
        let range = CMTimeRange(start: .zero, duration: CMTime(seconds: 4, preferredTimescale: 600))
        try videoTrack.insertTimeRange(range, of: sourceVideo, at: .zero)
        try audioTrack.insertTimeRange(range, of: sourceAudio, at: CMTime(seconds: audioStartSeconds, preferredTimescale: 600))
        let source = folder.appendingPathComponent("screen.mov")
        let exporter = try XCTUnwrap(AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough))
        exporter.outputURL = source
        exporter.outputFileType = .mov
        await exporter.export()
        XCTAssertEqual(exporter.status, .completed, exporter.error?.localizedDescription ?? "")
        return source
    }

    private static func sineWave() -> Data {
        let rate = 48_000, samples = rate * 4
        var data = Data()
        func u16(_ value: UInt16) { var value = value.littleEndian; withUnsafeBytes(of: &value) { data.append(contentsOf: $0) } }
        func u32(_ value: UInt32) { var value = value.littleEndian; withUnsafeBytes(of: &value) { data.append(contentsOf: $0) } }
        data.append(contentsOf: "RIFF".utf8); u32(UInt32(36 + samples * 2)); data.append(contentsOf: "WAVEfmt ".utf8)
        u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
        data.append(contentsOf: "data".utf8); u32(UInt32(samples * 2))
        for index in 0..<samples { u16(UInt16(bitPattern: Int16(sin(Double(index) * 2 * .pi * 440 / Double(rate)) * 8_000))) }
        return data
    }
}
