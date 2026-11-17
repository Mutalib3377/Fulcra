/**
 * The hero's background: slow ribbons of light in Fulcra greens, drawn on the GPU.
 * GLSL ES 1.0 so it runs on old Android phones (WebGL 1).
 */
export const heroVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const heroFragmentShader = /* glsl */ `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uPointer;   // -1..1, eased
  uniform float uScroll;   // 0 at top, 1 when the hero has scrolled away

  // Smooth value noise: large, slow shapes only.
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    return 0.65 * noise(p) + 0.35 * noise(p * 2.1 + 3.7);
  }

  // A soft ribbon of light following a slow wave.
  float ribbon(vec2 p, float phase, float height, float width, float t) {
    float wave = height
      + 0.16 * sin(p.x * 1.15 + t * 0.9 + phase)
      + 0.08 * sin(p.x * 2.3 - t * 0.6 + phase * 1.7)
      + 0.22 * (fbm(vec2(p.x * 0.55 + t * 0.15, phase)) - 0.5);
    float d = abs(p.y - wave);
    return exp(-d / width) ;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float t = uTime * 0.35;

    vec2 bend = uPointer * vec2(0.06, 0.04);
    vec2 q = p + bend;

    vec3 base = vec3(0.016, 0.051, 0.043);
    vec3 green = vec3(0.04, 0.42, 0.29);
    vec3 emerald = vec3(0.18, 0.82, 0.56);
    vec3 mint = vec3(0.78, 1.0, 0.9);

    // Large drifting glows.
    float g1 = smoothstep(0.95, 0.0, length(q - vec2(0.55 + 0.08 * sin(t * 0.4), 0.38)));
    float g2 = smoothstep(1.1, 0.0, length(q - vec2(-0.2 + 0.1 * cos(t * 0.3), -0.55)));
    vec3 col = base + green * (0.55 * g1 + 0.3 * g2);

    // Three ribbons, sitting low and to the right so the text on the left stays clear.
    float r1 = ribbon(q, 0.0, -0.18, 0.022, t);
    float r2 = ribbon(q, 2.4, -0.3, 0.05, t * 0.8);
    float r3 = ribbon(q, 4.1, 0.05, 0.09, t * 0.6);
    float rightSide = smoothstep(-0.9, 0.6, q.x);
    col += emerald * (0.55 * r2 + 0.35 * r3) * rightSide;
    col += mint * pow(r1, 1.6) * 0.75 * rightSide;
    col += emerald * r1 * 0.25 * rightSide;

    // Keep the area behind the headline calm, darken edges and fade as the page scrolls.
    float textCalm = smoothstep(0.1, -0.9, q.x) * smoothstep(-0.6, 0.3, q.y);
    col = mix(col, base, textCalm * 0.55);
    float vignette = smoothstep(1.4, 0.2, length(p * vec2(0.85, 1.1)));
    col *= mix(0.6, 1.0, vignette);
    col *= 1.0 - 0.6 * uScroll;

    // Fine grain so gradients never band on cheap screens.
    float grain = hash(uv * uResolution + fract(uTime) * 100.0);
    col += (grain - 0.5) * 0.02;

    gl_FragColor = vec4(col, 1.0);
  }
`;
