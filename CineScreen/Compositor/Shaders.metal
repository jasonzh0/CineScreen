#include <metal_stdlib>
using namespace metal;

// =============================================================================
// Shared uniforms
// =============================================================================

struct AspectUniforms {
    float2 scale;
};

// Canvas (background + padding) applied as an outer transform on top of the
// aspect-fit and zoom transforms.
struct CanvasUniforms {
    // Multiplied with the post-aspect-fit position to shrink the video into
    // a padded sub-region. e.g. 0.8 = 20% padding total.
    float2 contentScale;
    // Corner radius in normalized canvas coordinates (0..1). 0 = sharp.
    float cornerRadius;
    float _pad;
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
// Video passthrough pipeline
// =============================================================================

vertex VertexOut video_vertex(
    uint vid [[vertex_id]],
    constant float4 *vertices [[buffer(0)]],   // x, y, u, v
    constant AspectUniforms &aspect [[buffer(1)]],
    constant ZoomUniforms &zoom [[buffer(2)]],
    constant CanvasUniforms &canvas [[buffer(3)]]
) {
    float4 v = vertices[vid];
    float2 zoomedUV = zoom.centerUV + (v.zw - 0.5) / zoom.scale;
    VertexOut out;
    // Apply aspect-fit, then canvas contentScale to inset into the background.
    out.position = float4(v.xy * aspect.scale * canvas.contentScale, 0.0, 1.0);
    out.uv = zoomedUV;
    return out;
}

fragment float4 video_fragment(
    VertexOut in [[stage_in]],
    constant CanvasUniforms &canvas [[buffer(0)]],
    texture2d<float> tex [[texture(1)]]
) {
    constexpr sampler s(mag_filter::linear, min_filter::linear, address::clamp_to_edge);
    float4 colour = tex.sample(s, in.uv);

    // Optional rounded corners. We're sampling the texture at UV in [0,1].
    // Bend the quad's UV into a signed-distance from rounded rectangle.
    if (canvas.cornerRadius > 0.0) {
        float r = canvas.cornerRadius;
        float2 d = abs(in.uv - 0.5) - (0.5 - r);
        float corner = length(max(d, float2(0.0))) - r;
        // AA edge: smoothstep from inside the rounded edge to fully outside.
        float aa = max(fwidth(corner), 0.0005);
        float mask = 1.0 - smoothstep(0.0, aa, corner);
        colour.a *= mask;
    }
    return colour;
}

// =============================================================================
// Cursor sprite pipeline
// =============================================================================

struct CursorUniforms {
    float2 cursorPos;     // in video pixels (top-left origin)
    float size;           // sprite size in video pixels
    float2 videoSize;
    float2 aspectScale;
    float opacity;
};

vertex VertexOut cursor_vertex(
    uint vid [[vertex_id]],
    constant CursorUniforms &u [[buffer(0)]],
    constant ZoomUniforms &zoom [[buffer(1)]],
    constant CanvasUniforms &canvas [[buffer(2)]]
) {
    // Cursor position normalized to UV space.
    float2 posUV = u.cursorPos / u.videoSize;
    // Distance from zoom center in UV, then to NDC scaled by zoom.
    float2 centerOffsetUV = posUV - zoom.centerUV;
    float2 cursorNDC = float2(
        centerOffsetUV.x * 2.0 * zoom.scale,
        -(centerOffsetUV.y * 2.0 * zoom.scale)
    );

    // Sprite half-extent in NDC, scaled with zoom.
    float2 quadHalfNDC = float2(u.size, u.size) / u.videoSize * zoom.scale;
    float2 offset = kUnitQuad[vid] * float2(quadHalfNDC.x * 2.0, -quadHalfNDC.y * 2.0);

    float2 pos = (cursorNDC + offset) * u.aspectScale * canvas.contentScale;

    VertexOut out;
    out.position = float4(pos, 0.0, 1.0);
    out.uv = kUnitUV[vid];
    return out;
}

fragment float4 cursor_fragment(
    VertexOut in [[stage_in]],
    constant CursorUniforms &u [[buffer(0)]],
    texture2d<float> tex [[texture(0)]]
) {
    constexpr sampler s(mag_filter::linear, min_filter::linear, address::clamp_to_edge);
    float4 c = tex.sample(s, in.uv);
    c.a *= u.opacity;
    return c;
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
    float4 color;
};

vertex VertexOut click_vertex(
    uint vid [[vertex_id]],
    constant ClickUniforms &u [[buffer(0)]],
    constant ZoomUniforms &zoom [[buffer(1)]],
    constant CanvasUniforms &canvas [[buffer(2)]]
) {
    float2 posUV = u.centerInVideoPixels / u.videoSize;
    float2 centerOffsetUV = posUV - zoom.centerUV;
    float2 centerNDC = float2(
        centerOffsetUV.x * 2.0 * zoom.scale,
        -(centerOffsetUV.y * 2.0 * zoom.scale)
    );

    float2 quadHalfNDC = float2(u.radiusInPixels, u.radiusInPixels) / u.videoSize * zoom.scale;
    float2 offset = kUnitQuad[vid] * float2(quadHalfNDC.x * 2.0, -quadHalfNDC.y * 2.0);
    float2 pos = (centerNDC + offset) * u.aspectScale;

    VertexOut out;
    out.position = float4(pos, 0.0, 1.0);
    out.uv = kUnitQuad[vid] + 0.5;
    return out;
}

fragment float4 click_fragment(
    VertexOut in [[stage_in]],
    constant ClickUniforms &u [[buffer(0)]]
) {
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
    colour.a *= mask;
    return colour;
}
