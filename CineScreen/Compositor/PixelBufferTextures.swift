import CoreVideo
import Metal

/// Keeps the CV binding and its backing buffer alive alongside the texture.
/// Immutable resource references can be retained by a GPU completion handler.
final class PixelBufferTexture: @unchecked Sendable {
    let texture: MTLTexture
    private let binding: CVMetalTexture
    private let buffer: CVPixelBuffer

    fileprivate init(texture: MTLTexture, binding: CVMetalTexture, buffer: CVPixelBuffer) {
        self.texture = texture
        self.binding = binding
        self.buffer = buffer
    }
}

/// BGRA texture bindings shared by preview and export. Confine the cache to
/// its adapter's rendering queue. Expiry bounds decoder/writer pool retention;
/// never flush while a writer may still use the destination's IOSurface.
final class PixelBufferTextures {
    private let cache: CVMetalTextureCache

    init?(device: MTLDevice) {
        let attributes = [kCVMetalTextureCacheMaximumTextureAgeKey as String: 0.5 as CFNumber] as CFDictionary
        var cache: CVMetalTextureCache?
        guard CVMetalTextureCacheCreate(kCFAllocatorDefault, attributes, device, nil, &cache) == kCVReturnSuccess,
              let cache else { return nil }
        self.cache = cache
    }

    func bind(_ buffer: CVPixelBuffer) -> PixelBufferTexture? {
        var binding: CVMetalTexture?
        guard CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault, cache, buffer, nil, .bgra8Unorm,
            CVPixelBufferGetWidth(buffer), CVPixelBufferGetHeight(buffer), 0, &binding
        ) == kCVReturnSuccess, let binding, let texture = CVMetalTextureGetTexture(binding) else { return nil }
        return PixelBufferTexture(texture: texture, binding: binding, buffer: buffer)
    }
}
