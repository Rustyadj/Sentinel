// Neural Lens — GLSL for the globe renderer.
//
// Everything that changes every frame lives here rather than on the CPU: the
// breathing drift, the activity pulse, depth fog, and the travelling pulse
// along an active path are all computed per-vertex from a single `uTime`
// uniform. That's what lets the graph carry tens of thousands of edges and
// still cost nothing per frame — the JS side only rewrites buffers when the
// operator actually changes something (selection, lens, density).
//
// Shaders are written in GLSL1 style (attribute/varying/gl_FragColor); three
// rewrites them for WebGL2 automatically. Vertex colors come in through an
// explicit `aColor` attribute instead of three's built-in `color`, so nothing
// here depends on which shader chunks the renderer decides to inject.

/** Drift + fog, shared verbatim by the node, edge, and path shaders — the
 * node field and the edges wired to it must displace by exactly the same
 * amount or the graph visibly comes apart at close zoom. */
const COMMON = /* glsl */ `
uniform float uTime;
uniform float uDrift;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogStrength;

vec3 sentinelDrift(vec3 base, float phase) {
  return base + uDrift * vec3(
    sin(uTime * 0.13 + phase),
    cos(uTime * 0.11 + phase * 1.13),
    sin(uTime * 0.09 + phase * 1.43)
  );
}

float sentinelFog(float dist) {
  float t = clamp((dist - uFogNear) / max(uFogFar - uFogNear, 1.0), 0.0, 1.0);
  return 1.0 - uFogStrength * t;
}
`;

export const NODE_VERTEX_SHADER = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aPhase;
attribute float aPulse;

uniform float uSizeScale;
uniform float uScreenScale;
uniform float uPulse;

varying vec3 vColor;
varying float vAlpha;

${COMMON}

void main() {
  vec4 view = modelViewMatrix * vec4(sentinelDrift(position, aPhase), 1.0);
  float dist = max(-view.z, 1.0);

  float pulse = uPulse * aPulse * (0.5 + 0.5 * sin(uTime * 2.2 + aPhase * 3.0));

  vColor = aColor * (1.0 + pulse * 0.9);
  vAlpha = aAlpha * sentinelFog(dist) * (1.0 + pulse * 0.5);

  // aSize is a world-space radius; uScreenScale converts it to pixels for
  // this viewport, so a node keeps a physical size in the scene instead of
  // staying a constant number of pixels as you fly in.
  gl_PointSize = clamp(aSize * uSizeScale * (1.0 + pulse * 0.35) * uScreenScale / dist, 0.6, 640.0);
  gl_Position = projectionMatrix * view;
}
`;

/** A crisp dot with an anti-aliased edge — no texture lookup, no square points. */
export const NODE_FRAGMENT_SHADER = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
  // A wide flat core with a short anti-aliased shoulder. Squaring the falloff
  // (or starting it near the centre) makes a 2px dot read as a smudge at half
  // brightness, which is what turns a dense field into grey haze.
  float a = 1.0 - smoothstep(0.62, 1.0, r);
  float alpha = vAlpha * a;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

/** The bloom behind hubs and the selection: same geometry, far wider and
 * softer falloff, so glow stays localised instead of washing the field out. */
export const GLOW_FRAGMENT_SHADER = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  float r = clamp(length(gl_PointCoord - vec2(0.5)) * 2.0, 0.0, 1.0);
  float a = pow(1.0 - r, 2.8);
  float alpha = vAlpha * a;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

export const EDGE_VERTEX_SHADER = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aPhase;

varying vec3 vColor;
varying float vAlpha;

${COMMON}

void main() {
  vec4 view = modelViewMatrix * vec4(sentinelDrift(position, aPhase), 1.0);
  vColor = aColor;
  vAlpha = aAlpha * sentinelFog(max(-view.z, 1.0));
  gl_Position = projectionMatrix * view;
}
`;

export const EDGE_FRAGMENT_SHADER = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  if (vAlpha < 0.002) discard;
  gl_FragColor = vec4(vColor, vAlpha);
}
`;

/**
 * The active-path layer. `aArc` is the vertex's normalised distance along the
 * path, so a single moving window lights one stretch of the route at a time —
 * a traversal, not a flashing graph.
 */
export const PATH_VERTEX_SHADER = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aPhase;
attribute float aArc;

uniform float uPathSpeed;
uniform float uPathWidth;

varying vec3 vColor;
varying float vAlpha;

${COMMON}

void main() {
  vec4 view = modelViewMatrix * vec4(sentinelDrift(position, aPhase), 1.0);

  float head = fract(uTime * uPathSpeed);
  float delta = aArc - head;
  delta -= floor(delta + 0.5);
  float pulse = exp(-pow(delta / max(uPathWidth, 0.01), 2.0));

  vColor = mix(aColor, vec3(1.0), pulse * 0.7);
  vAlpha = aAlpha * (0.3 + 1.1 * pulse) * sentinelFog(max(-view.z, 1.0));
  gl_Position = projectionMatrix * view;
}
`;

/** Atmosphere: a back-facing shell whose rim brightens toward the silhouette,
 * which is what gives the globe an edge without drawing a hard outline. */
export const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;

void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-view.xyz);
  gl_Position = projectionMatrix * view;
}
`;

export const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;

varying vec3 vNormal;
varying vec3 vView;

void main() {
  float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
  // A high exponent keeps the glow pinned to the silhouette instead of
  // flooding the disc and washing out the node field behind it.
  float a = pow(clamp(rim, 0.0, 1.0), 7.0) * uStrength;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`;
