#include <metal_stdlib>
using namespace metal;

// =============================================================================
// Shared uniforms
// =============================================================================

struct AspectUniforms {
    float2 scale;
    float2 cropOrigin;
    float2 cropSize;
};

// Canvas (background + padding) applied as an outer transform on top of the
// aspect-fit and zoom transforms.
struct CanvasUniforms {
    // Multiplied with the post-aspect-fit position to shrink the video into
    // a padded sub-region. e.g. 0.8 = 20% padding total.
    float2 contentScale;
    float2 cornerRadiusUV;
};

// Zoom: shifts UV space so a sub-region of the video fills the drawable.
// `centerUV` ∈ [0, 1]² — the point the user is zooming on.
// `scale`: 1 = no zoom; 2 = 2× zoom.
struct ZoomUniforms {
    float2 centerUV;
    float scale;
};

struct VertexOut {
    float4 position [[position]];
    float2 uv;
    float2 frameUV;
};

// Unit quad for the cursor / click sprite passes.
constant float2 kUnitQuad[4] = {
    float2(-0.5, -0.5),
    float2( 0.5, -0.5),
    float2(-0.5,  0.5),
    float2( 0.5,  0.5)
};
constant float2 kUnitUV[4] = {
    float2(0.0, 1.0),
    float2(1.0, 1.0),
    float2(0.0, 0.0),
    float2(1.0, 0.0)
};

// =============================================================================
// Canvas background pipeline (1- to 4-stop linear gradient, full-screen)
// =============================================================================

struct BackgroundUniforms {
    float4 stop0;
    float4 stop1;
    float4 stop2;
    float4 stop3;
    float4 stopPositions;
    float angleRadians;
    int stopCount;
    float pad0;
    float pad1;
    float vignette;
    float grain;
    int gradientStyle;
    float pad2;
};

float4 finish_background(float4 color, float2 uv, float2 pixel, constant BackgroundUniforms &u) {
    float edge = smoothstep(0.28, 0.92, length(uv - 0.5) * 1.42);
    color.rgb *= 1.0 - u.vignette * edge;
    // Fixed per-pixel dither prevents banding without temporal shimmer.
    float noise = fract(sin(dot(floor(pixel), float2(12.9898, 78.233))) * 43758.5453) - 0.5;
    color.rgb = clamp(color.rgb + noise * u.grain, 0.0, 1.0);
    return color;
}

vertex VertexOut background_vertex(uint vid [[vertex_id]]) {
    float2 positions[4] = {
        float2(-1.0, -1.0),
        float2( 1.0, -1.0),
        float2(-1.0,  1.0),
        float2( 1.0,  1.0)
    };
    VertexOut out;
    out.position = float4(positions[vid], 0.0, 1.0);
    out.uv = positions[vid] * 0.5 + 0.5;
    out.frameUV = out.uv;
    return out;
}

fragment float4 background_fragment(
    VertexOut in [[stage_in]],
    constant BackgroundUniforms &u [[buffer(0)]]
) {
    if (u.stopCount <= 1) {
        return finish_background(u.stop0, in.uv, in.position.xy, u);
    }

    // Rotate uv around centre by angle, project onto the gradient axis, and
    // remap to 0..1 across the diagonal so the gradient reaches every corner.
    float2 centred = float2(in.uv.x, 1.0 - in.uv.y) - 0.5;
    float c = cos(u.angleRadians);
    float s = sin(u.angleRadians);
    float t = centred.x * c + centred.y * s;
    float maxT = 0.5 * (abs(c) + abs(s));
    float normT = u.gradientStyle == 1
        ? clamp(length(centred - float2(c, -s) * 0.28) / 0.95, 0.0, 1.0)
        : clamp((t + maxT) / (2.0 * maxT), 0.0, 1.0);

    float4 stops[4] = { u.stop0, u.stop1, u.stop2, u.stop3 };
    float positions[4] = {
        u.stopPositions.x,
        u.stopPositions.y,
        u.stopPositions.z,
        u.stopPositions.w
    };
    int count = u.stopCount;

    if (normT <= positions[0])           return finish_background(stops[0], in.uv, in.position.xy, u);
    if (normT >= positions[count - 1])   return finish_background(stops[count - 1], in.uv, in.position.xy, u);

    for (int i = 0; i < count - 1; i++) {
        if (normT >= positions[i] && normT <= positions[i + 1]) {
            float span = max(0.0001, positions[i + 1] - positions[i]);
            float local = (normT - positions[i]) / span;
            if (u.gradientStyle == 1) local = smoothstep(0.0, 1.0, local);
            return finish_background(mix(stops[i], stops[i + 1], local), in.uv, in.position.xy, u);
        }
    }
    return finish_background(stops[count - 1], in.uv, in.position.xy, u);
}

// =============================================================================
// Drop-shadow pipeline (soft black halo beneath the video quad)
// =============================================================================

struct ShadowUniforms {
    float2 centerNDC;    // recording centre in NDC (post-zoom translate)
    float2 halfSize;     // recording half-size in NDC (post-zoom scale)
    float2 offsetNDC;
    float blur;          // blur in isotropic viewport-width units
    float cornerRadius;  // rounded-corner radius in NDC, matching the video
    float opacity;       // peak alpha at the recording's edge
    float viewportAspect;
};

vertex VertexOut shadow_vertex(uint vid [[vertex_id]]) {
    float2 positions[4] = {
        float2(-1.0, -1.0),
        float2( 1.0, -1.0),
        float2(-1.0,  1.0),
        float2( 1.0,  1.0)
    };
    VertexOut out;
    out.position = float4(positions[vid], 0.0, 1.0);
    out.uv = positions[vid];
    out.frameUV = out.uv;
    return out;
}

fragment float4 shadow_fragment(
    VertexOut in [[stage_in]],
    constant ShadowUniforms &u [[buffer(0)]]
) {
    // Sample in the shifted shadow rect's local frame.
    float2 metric = float2(1.0, 1.0 / max(0.01, u.viewportAspect));
    float2 p = (in.uv - u.centerNDC - u.offsetNDC) * metric;

    // SDF to a rounded rectangle centred at the shifted position.
    float2 inner = max(u.halfSize * metric - float2(u.cornerRadius), float2(0.0));
    float2 d = abs(p) - inner;
    float dist = length(max(d, float2(0.0))) + min(max(d.x, d.y), 0.0) - u.cornerRadius;

    // Proper drop shadow: solid `opacity` everywhere inside the shifted
    // shadow rect, falling off over `blur` outside it. The recording is
    // composited on top in a later pass, so the part of the shadow that
    // overlaps the recording is hidden — what's visible is the shifted
    // portion extending past the recording's silhouette (mostly below).
    //
    // The previous version used step(0, dist) to KILL alpha inside the
    // rect; combined with the downward offset that produced a "dead zone"
    // band of pure gradient between the recording's bottom edge and where
    // the shadow's outer falloff started.
    float distance = max(dist, 0.0);
    float sigma = max(0.0001, u.blur);
    float ambient = exp(-0.5 * distance * distance / (sigma * sigma));
    float contact = exp(-0.5 * distance * distance / (sigma * sigma * 0.0484));
    float alpha = u.opacity * (0.66 * ambient + 0.34 * contact);
    return float4(0.0, 0.0, 0.0, alpha);
}

// =============================================================================
// Video passthrough pipeline
// =============================================================================
//
// Camera model: the recording is a finite rectangle that scales and
// translates as one object. The canvas is a camera frame looking at it.
// `zoom.scale` is inverse camera distance; `zoom.centerUV` is the point
// on the recording the camera is pointed at.
//
//   scale = 1   : recording fills the canvas content rect (the padded
//                 inner region). The gradient padding is visible around it.
//   scale > 1   : recording grows past the content rect into the padding
//                 region — eventually filling the whole canvas (and beyond,
//                 where Metal auto-clips at NDC [-1, 1]). The recording is
//                 not limited by the padding "frame".
//   scale < 1   : recording shrinks below the content rect, gradient
//                 padding takes over more of the canvas.
//
// No fragment discard: the recording's geometry is its own bounds; outside
// the quad we don't render the video at all, so the gradient pass that ran
// underneath remains visible.

vertex VertexOut video_vertex(
    uint vid [[vertex_id]],
    constant float4 *vertices [[buffer(0)]],   // x, y, u, v
    constant AspectUniforms &aspect [[buffer(1)]],
    constant ZoomUniforms &zoom [[buffer(2)]],
    constant CanvasUniforms &canvas [[buffer(3)]]
) {
    float4 v = vertices[vid];

    // Map the focal point (source UV, top-left origin) into the quad's
    // coordinate system (NDC-style, y-up).
    float2 centerInQuad = float2(zoom.centerUV.x * 2.0 - 1.0,
                                 1.0 - zoom.centerUV.y * 2.0);

    // Scale the quad around the focal point so it lands at canvas centre.
    // Multiply by aspect + contentScale to position within the canvas.
    float2 scaledQuad = (v.xy - centerInQuad) * zoom.scale;

    VertexOut out;
    out.position = float4(scaledQuad * aspect.scale * canvas.contentScale, 0.0, 1.0);
    out.uv = aspect.cropOrigin + v.zw * aspect.cropSize;
    out.frameUV = v.zw;
    return out;
}

float frame_alpha(float2 uv, float2 radius) {
    float2 edge = min(uv, 1.0 - uv);
    if (any(edge < 0.0)) return 0.0;
    if (radius.x > 0.0 && radius.y > 0.0 && edge.x < radius.x && edge.y < radius.y) {
        float distance = length((radius - edge) / radius) - 1.0;
        float aa = max(0.001, fwidth(distance));
        return 1.0 - smoothstep(-aa, aa, distance);
    }
    return 1.0;
}

fragment float4 video_fragment(
    VertexOut in [[stage_in]],
    constant CanvasUniforms &canvas [[buffer(0)]],
    texture2d<float> tex [[texture(1)]]
) {
    float alpha = frame_alpha(in.frameUV, canvas.cornerRadiusUV);
    constexpr sampler s(mag_filter::linear, min_filter::linear, address::clamp_to_edge);
    float4 color = tex.sample(s, in.uv);
    color.a *= alpha;
    return color;
}

// =============================================================================
// Cursor sprite pipeline
// =============================================================================

struct CursorUniforms {
    float2 cursorPos;     // pointer hot-spot in video pixels (top-left origin)
    float2 videoSize;
    float2 aspectScale;
    float2 cropOrigin;
    float2 cropSize;
    float2 hotspot;       // hot spot as a fraction of the sprite, [0,1]², top-left
    float2 motionBlur;    // directional blur vector in sprite-UV units (0 = none)
    float size;           // sprite size in video pixels
    float opacity;
};

vertex VertexOut cursor_vertex(
    uint vid [[vertex_id]],
    constant CursorUniforms &u [[buffer(0)]],
    constant ZoomUniforms &zoom [[buffer(1)]],
    constant CanvasUniforms &canvas [[buffer(2)]]
) {
    // `cursorPos` is the pointer's hot spot (where the real cursor pointed).
    // Normalize it to UV space, then to zoom-scaled NDC.
    float2 sourceUV = u.cursorPos / u.videoSize;
    float2 posUV = (sourceUV - u.cropOrigin) / u.cropSize;
    float2 centerOffsetUV = posUV - zoom.centerUV;
    float2 cursorNDC = float2(
        centerOffsetUV.x * 2.0 * zoom.scale,
        -(centerOffsetUV.y * 2.0 * zoom.scale)
    );

    // Sprite half-extent in NDC, scaled with zoom.
    float2 quadHalfNDC = float2(u.size, u.size) / (u.videoSize * u.cropSize) * zoom.scale;
    float2 offset = kUnitQuad[vid] * float2(quadHalfNDC.x * 2.0, -quadHalfNDC.y * 2.0);

    // Shift the whole sprite so its hot spot (not its centre) lands on
    // `cursorNDC`. In the sprite's normalized space the centre is (0.5,0.5);
    // moving it by (centre - hotspot) brings the hot spot onto the pointer
    // location. X is right-positive, Y is flipped because NDC is y-up while
    // the hot spot is measured top-down.
    float2 hotspotShift = float2(
         (0.5 - u.hotspot.x) * quadHalfNDC.x * 2.0,
        -(0.5 - u.hotspot.y) * quadHalfNDC.y * 2.0
    );

    float2 pos = (cursorNDC + hotspotShift + offset) * u.aspectScale * canvas.contentScale;

    VertexOut out;
    out.position = float4(pos, 0.0, 1.0);
    out.uv = kUnitUV[vid];
    out.frameUV = (sourceUV + (kUnitUV[vid] - u.hotspot) * u.size / u.videoSize - u.cropOrigin) / u.cropSize;
    return out;
}

fragment float4 cursor_fragment(
    VertexOut in [[stage_in]],
    constant CursorUniforms &u [[buffer(0)]],
    constant CanvasUniforms &canvas [[buffer(1)]],
    texture2d<float> tex [[texture(0)]]
) {
    constexpr sampler s(mag_filter::linear, min_filter::linear, address::clamp_to_edge);

    // Directional motion blur: average several taps along the blur vector so
    // the sprite smears in the direction of travel. The sprite's transparent
    // border + clamp_to_edge means taps that fall outside the sprite read as
    // transparent, so the smear fades out cleanly.
    if (any(in.frameUV < 0.0) || any(in.frameUV > 1.0)) discard_fragment();
    float blurLen = length(u.motionBlur);
    float4 c;
    if (blurLen < 0.001) {
        c = tex.sample(s, in.uv);
    } else {
        const int kTaps = 9;
        float4 acc = float4(0.0);
        for (int i = 0; i < kTaps; i++) {
            float t = (float(i) / float(kTaps - 1)) - 0.5;  // -0.5 … 0.5
            acc += tex.sample(s, in.uv + u.motionBlur * t);
        }
        c = acc / float(kTaps);
    }

    c.a *= u.opacity * frame_alpha(in.frameUV, canvas.cornerRadiusUV);
    return c;
}

// =============================================================================
// Webcam overlay pipeline (circular crop with feathered edge + ring)
// =============================================================================
//
// The vertex stage emits a square quad in NDC positioned at `centerNDC` with
// `halfSizeNDC` extents — the caller computes these in client code so the
// shader doesn't need to know about canvas padding or aspect ratio.
//
// The fragment stage samples the webcam texture with aspect-fill cropping
// (a square cut from the centre of a typically-widescreen frame) and applies
// a circular alpha mask with anti-aliased edge + a thin white ring.

struct WebcamUniforms {
    float2 centerNDC;
    float2 halfSizeNDC;
    float2 textureUVScale;     // applied to centred [-0.5,0.5] UV before re-shifting
    float2 textureUVOffset;    // texture coords for the centre of the crop
    float4 ringColor;
    float ringWidthNorm;       // ring thickness as a fraction of radius (0..1)
    float pad0;
    float pad1;
    float pad2;
};

vertex VertexOut webcam_vertex(
    uint vid [[vertex_id]],
    constant WebcamUniforms &u [[buffer(0)]]
) {
    float2 quadOffset = kUnitQuad[vid] * (u.halfSizeNDC * 2.0);
    float2 pos = u.centerNDC + quadOffset;
    VertexOut out;
    out.position = float4(pos, 0.0, 1.0);
    // Centred UV in [-0.5, 0.5] — the fragment shader uses it for both the
    // circular mask and the aspect-fill texture lookup.
    out.uv = kUnitQuad[vid];
    out.frameUV = out.uv;
    return out;
}

fragment float4 webcam_fragment(
    VertexOut in [[stage_in]],
    constant WebcamUniforms &u [[buffer(0)]],
    texture2d<float> tex [[texture(0)]]
) {
    constexpr sampler s(mag_filter::linear, min_filter::linear, address::clamp_to_edge);
    float2 centred = in.uv;
    float dist = length(centred);

    // Sample with aspect-fill: scale centred UV by `textureUVScale`, then
    // shift so [-0.5,0.5]² maps to the desired square crop in the source.
    float2 sampleUV = centred * u.textureUVScale + u.textureUVOffset;
    // Source frames arrive with top-left origin in the texture, so we flip Y.
    sampleUV.y = 1.0 - sampleUV.y;
    float4 colour = tex.sample(s, sampleUV);

    // Anti-aliased circle mask: alpha 1 inside, 0 outside the unit circle of
    // radius 0.5 (matching the centred UV space).
    float aa = fwidth(dist);
    float radius = 0.5;
    float circleAlpha = smoothstep(radius, radius - aa, dist);

    // Ring drawn just inside the circle edge.
    float ringOuter = radius;
    float ringInner = radius - u.ringWidthNorm;
    float ringMask = smoothstep(ringOuter, ringOuter - aa, dist)
                   * smoothstep(ringInner - aa, ringInner, dist);

    colour.a *= circleAlpha;
    // Blend the ring on top (premultiplied semantics — we just lerp RGB and
    // bump alpha toward the ring's alpha where the mask says we should).
    colour.rgb = mix(colour.rgb, u.ringColor.rgb, ringMask * u.ringColor.a);
    colour.a = max(colour.a, ringMask * u.ringColor.a);
    return colour;
}

// =============================================================================
// Click circle pipeline (procedural ring drawn over video)
// =============================================================================

struct ClickUniforms {
    float2 centerInVideoPixels;
    float radiusInPixels;
    float thicknessInPixels;
    float2 videoSize;
    float2 aspectScale;
    float2 cropOrigin;
    float2 cropSize;
    float4 color;
};

vertex VertexOut click_vertex(
    uint vid [[vertex_id]],
    constant ClickUniforms &u [[buffer(0)]],
    constant ZoomUniforms &zoom [[buffer(1)]],
    constant CanvasUniforms &canvas [[buffer(2)]]
) {
    float2 sourceUV = u.centerInVideoPixels / u.videoSize;
    float2 posUV = (sourceUV - u.cropOrigin) / u.cropSize;
    float2 centerOffsetUV = posUV - zoom.centerUV;
    float2 centerNDC = float2(
        centerOffsetUV.x * 2.0 * zoom.scale,
        -(centerOffsetUV.y * 2.0 * zoom.scale)
    );

    float2 quadHalfNDC = float2(u.radiusInPixels, u.radiusInPixels) * 2.0 / (u.videoSize * u.cropSize) * zoom.scale;
    float2 offset = kUnitQuad[vid] * float2(quadHalfNDC.x * 2.0, -quadHalfNDC.y * 2.0);
    // Apply canvas.contentScale to match the video and cursor passes — without
    // it, click rings drift outward from the recording whenever canvas padding
    // shrinks the video (contentScale < 1).
    float2 pos = (centerNDC + offset) * u.aspectScale * canvas.contentScale;

    VertexOut out;
    out.position = float4(pos, 0.0, 1.0);
    out.uv = kUnitQuad[vid] + 0.5;
    out.frameUV = (sourceUV + kUnitQuad[vid] * 2.0 * u.radiusInPixels / u.videoSize - u.cropOrigin) / u.cropSize;
    return out;
}

fragment float4 click_fragment(
    VertexOut in [[stage_in]],
    constant ClickUniforms &u [[buffer(0)]],
    constant CanvasUniforms &canvas [[buffer(1)]]
) {
    if (any(in.frameUV < 0.0) || any(in.frameUV > 1.0)) discard_fragment();
    float2 d = in.uv - float2(0.5, 0.5);
    float dist = length(d);
    float thicknessNorm = (u.thicknessInPixels / max(1.0, u.radiusInPixels * 2.0));
    float ringOuter = 0.5;
    float ringInner = 0.5 - thicknessNorm;

    float aa = fwidth(dist);
    float outerEdge = smoothstep(ringOuter, ringOuter - aa, dist);
    float innerEdge = smoothstep(ringInner - aa, ringInner, dist);
    float mask = outerEdge * innerEdge;

    float4 colour = u.color;
    colour.a *= mask * frame_alpha(in.frameUV, canvas.cornerRadiusUV);
    return colour;
}
