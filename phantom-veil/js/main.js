// --- Phantom Veil — Main Entry ---

import { createCloth, updatePhysics, findClosestPoint, getClothPerimeter, resetCloth, getClusteringRatio } from './physics.js';
import { createHandTracker } from './hand-tracking.js';
import { createAudioEngine, startRustle, stopRustle, setVeilOpenRatio, setGlassEnabled, setMasterVolume, destroyAudioEngine } from './audio.js';
import { createParticleSystem, updateParticles, getParticlePositions, getParticleCount, getYoungCount, destroyParticleSystem } from './particles.js';
import { fetchDefaultContent } from './api.js';

const canvas = document.getElementById('veil-canvas');
const gl = canvas.getContext('webgl', {
  alpha: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  stencil: true,
});

if (!gl) {
  document.getElementById('debug-info').innerText = 'WebGL not supported';
  throw new Error('WebGL not available');
}

// --- State ---
let webcamTexture = null;
let animationId = null;
let cloth = null;
let mouseX = 0, mouseY = 0, mouseDown = false;
let mouseGrabbedIdx = null;
let currentMode = 2; // 0=stress 1=wire 2=edge 3=velvet (default: edge glow)
let showDebugGrid = false; // G to toggle
let showVeil = true;       // V to toggle cloth/veil
let showGlass = true;      // F to toggle glass filter
const modeNames = ['Stress', 'Wireframe', 'Edge Glow', 'Velvet'];
const handTracker = createHandTracker(canvas);
let prevHands = []; // track previous hand positions for velocity
let audioInited = false;
let lastFrameTime = performance.now();
let dustBuf = null;  // particle position buffer
let hasEverOpened = false;
let uiHidden = false;
let prevClothSample = null; // for cloth velocity tracking
let lastHandTime = performance.now();
let autoClosing = false;
let autoResetEnabled = false;
let contentVideo = null;
let contentTexture = null;
let useVideo = false;

// --- Shaders ---

const quadVert = /* glsl */ `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

const veilFrag = /* glsl */ `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_webcam;
uniform sampler2D u_clothData;
uniform float u_mirror;
uniform vec2 u_clothTexSize;
uniform float u_time;
uniform int u_mode; // 0=stress 1=wire 2=edge 3=velvet
uniform vec2 u_hand0;     // fingertip position (0..1 UV)
uniform vec2 u_hand1;
uniform float u_pinch0;   // 0=open 1=pinching
uniform float u_pinch1;
uniform int u_handCount;
uniform vec3 u_haloColor;

vec2 getDisp(vec2 uv) {
  vec4 s = texture2D(u_clothData, uv);
  return (s.rg - 0.5) * 2.0;
}

float getMag(vec2 uv) {
  return clamp(length(getDisp(uv)), 0.0, 1.0);
}

float getStress(vec2 uv) {
  vec2 step = 1.0 / u_clothTexSize;
  vec2 d0 = getDisp(uv);
  vec2 dl = getDisp(uv - vec2(step.x, 0.0));
  vec2 dr = getDisp(uv + vec2(step.x, 0.0));
  vec2 du = getDisp(uv - vec2(0.0, step.y));
  vec2 dd = getDisp(uv + vec2(0.0, step.y));
  return clamp(length(dr - dl) + length(dd - du), 0.0, 1.0);
}

float isEdge(vec2 uv) {
  vec2 step = 1.0 / u_clothTexSize;
  float s0 = getStress(uv);
  float sl = getStress(uv - vec2(step.x, 0.0));
  float sr = getStress(uv + vec2(step.x, 0.0));
  float su = getStress(uv - vec2(0.0, step.y));
  float sd = getStress(uv + vec2(0.0, step.y));
  return clamp((abs(s0 - sl) + abs(s0 - sr) + abs(s0 - su) + abs(s0 - sd)) * 5.0, 0.0, 1.0);
}

// Fingertip halo: thin fluorescent ring
float fingertipHalo(vec2 uv, vec2 handPos, float pinching) {
  float d = length(uv - handPos);
  float radius = pinching > 0.5 ? 0.035 : 0.022;
  float glow = 0.003; // ring thickness
  // Outer edge of the ring
  float outer = 1.0 - smoothstep(radius - glow, radius, d);
  // Inner edge
  float inner = 1.0 - smoothstep(radius - glow * 3.0, radius - glow * 2.0, d);
  float ring = outer * (1.0 - inner);
  // Soft outer glow
  ring += (1.0 - smoothstep(radius, radius + glow * 5.0, d)) * 0.15;
  float brightness = pinching > 0.5 ? 0.8 : 0.3;
  return ring * brightness;
}

// Wind-like ripple from hand
float ripple(vec2 uv, vec2 handPos) {
  float d = length(uv - handPos);
  // Linear waves fading with distance
  float wave = sin((uv.x - handPos.x) * 90.0 + u_time * 3.0) * 0.5 + 0.5;
  wave *= 1.0 - smoothstep(0.02, 0.25, d); // fade out
  wave *= smoothstep(0.02, 0.0, d);        // don't show right at hand
  return wave * 0.12;
}

void main() {
  vec2 uv = v_texCoord;
  float mag = getMag(uv);
  float stress = getStress(uv);
  float edge = isEdge(uv);

  // Mirror for webcam display
  vec2 webcamUV = uv;
  if (u_mirror > 0.5) webcamUV.x = 1.0 - webcamUV.x;
  vec4 color = texture2D(u_webcam, webcamUV);

  float intensity = max(mag * 0.8, stress);

  if (u_mode == 0) {
    color.rgb = mix(color.rgb, color.rgb * 0.6, intensity * 0.4);
    color.rgb += vec3(0.12, 0.14, 0.2) * intensity;
  } else if (u_mode == 1) {
    vec2 grid = fract(uv * u_clothTexSize);
    float line = 1.0 - step(0.04, grid.x) * step(0.04, grid.y);
    float glow = line * (0.03 + intensity * 0.2);
    color.rgb += glow * 0.7;
  } else if (u_mode == 2) {
    float halo = edge * (0.06 + intensity * 0.25);
    color.rgb += vec3(0.5, 0.7, 1.0) * halo;
  } else {
    float noise = fract(sin(dot(uv * 80.0, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 dark  = vec3(0.28, 0.02, 0.03);
    vec3 mid   = vec3(0.42, 0.03, 0.05);
    color.rgb = mix(dark, mid, noise);
  }

  // --- Visual polish overlays (all modes) ---

  // Fingertip halos
  if (u_handCount > 0) {
    color.rgb += u_haloColor * fingertipHalo(uv, u_hand0, u_pinch0);
  }
  if (u_handCount > 1) {
    color.rgb += u_haloColor * fingertipHalo(uv, u_hand1, u_pinch1);
  }

  // Ripples from fingertips
  if (u_handCount > 0) {
    color.rgb += vec3(0.5, 0.7, 1.0) * ripple(uv, u_hand0);
  }
  if (u_handCount > 1) {
    color.rgb += vec3(0.5, 0.7, 1.0) * ripple(uv, u_hand1);
  }

  // Stress crease: white highlight on high-stress edges
  float crease = isEdge(uv) * intensity * 0.3;
  color.rgb += vec3(1.0, 1.0, 1.0) * crease;

  gl_FragColor = color;
}`;

// Glass frag: hidden ocean with multi-layered waves, optional video overlay
const glassFrag = /* glsl */ `
precision mediump float;
varying vec2 v_texCoord;
uniform vec2 u_resolution;
uniform sampler2D u_webcam;
uniform sampler2D u_content;
uniform float u_mirror;
uniform float u_showGlass;
uniform float u_useVideo;
uniform vec2 u_hand0;
uniform vec2 u_hand1;
uniform float u_pinch0;
uniform float u_pinch1;
uniform int u_handCount;
uniform float u_time;
uniform vec3 u_haloColor;

float fingertipHalo(vec2 uv, vec2 handPos, float pinching) {
  float d = length(uv - handPos);
  float radius = pinching > 0.5 ? 0.035 : 0.022;
  float glow = 0.003;
  float outer = 1.0 - smoothstep(radius - glow, radius, d);
  float inner = 1.0 - smoothstep(radius - glow * 3.0, radius - glow * 2.0, d);
  float ring = outer * (1.0 - inner);
  ring += (1.0 - smoothstep(radius, radius + glow * 5.0, d)) * 0.15;
  float brightness = pinching > 0.5 ? 0.8 : 0.3;
  return ring * brightness;
}

// Procedural ocean with layered sine waves
vec3 oceanColor(vec2 uv, float t) {
  // Deep ocean palette
  vec3 deepBlue   = vec3(0.01, 0.08, 0.25);
  vec3 midBlue    = vec3(0.02, 0.18, 0.45);
  vec3 surface    = vec3(0.05, 0.30, 0.55);
  vec3 foam       = vec3(0.25, 0.45, 0.60);

  // Multi-layered waves at different angles and speeds
  float wave1 = sin(uv.x * 8.0  + uv.y * 3.0  + t * 0.4) * 0.5 + 0.5;
  float wave2 = sin(uv.x * 5.0  - uv.y * 6.0  + t * 0.6) * 0.5 + 0.5;
  float wave3 = sin(uv.x * 12.0 + uv.y * 10.0 - t * 0.35) * 0.5 + 0.5;
  float wave4 = cos(uv.x * 3.0  - uv.y * 8.0  + t * 0.5) * 0.5 + 0.5;

  float height = wave1 * 0.35 + wave2 * 0.25 + wave3 * 0.25 + wave4 * 0.15;
  // Normalize to ~0..1
  height = height * 0.85 + 0.075;

  // Light caustic-like patterns
  float caustic = sin(uv.x * 30.0 + uv.y * 20.0 - t * 0.7) *
                  cos(uv.x * 25.0 - uv.y * 18.0 + t * 0.5);
  caustic = caustic * 0.5 + 0.5;
  caustic = pow(caustic, 3.0) * 0.08;

  // Color gradient: deep at bottom, lighter near top (depth illusion)
  vec3 col = mix(deepBlue, midBlue, smoothstep(0.2, 0.6, height));
  col = mix(col, surface, smoothstep(0.65, 0.85, height));
  // Foam crests at the highest points
  col = mix(col, foam, smoothstep(0.82, 0.92, height) * 0.3);

  // Add caustic shimmer
  col += caustic * vec3(0.3, 0.5, 0.7);

  // Subtle depth darkening toward bottom
  col = mix(col, deepBlue * 0.7, uv.y * 0.3);

  return col;
}

void main() {
  vec2 uv = v_texCoord;

  // Use video if available, otherwise procedural ocean
  vec3 ocean;
  if (u_useVideo > 0.5) {
    ocean = texture2D(u_content, uv).rgb;
  } else {
    ocean = oceanColor(uv, u_time);
  }

  if (u_showGlass < 0.5) {
    gl_FragColor = vec4(ocean, 1.0);
    return;
  }

  float rx = sin(uv.y * 200.0) * 0.0006;
  float ry = cos(uv.x * 180.0) * 0.0004;
  vec2 refrUV = uv + vec2(rx, ry);

  vec3 refrOcean;
  if (u_useVideo > 0.5) {
    refrOcean = texture2D(u_content, refrUV).rgb;
  } else {
    refrOcean = oceanColor(refrUV, u_time);
  }

  vec2 camUV = uv;
  if (u_mirror > 0.5) camUV.x = 1.0 - camUV.x;
  vec3 cam = texture2D(u_webcam, camUV).rgb;

  vec3 color = mix(refrOcean, cam, 0.12);

  // Fingertip halos on glass too
  if (u_handCount > 0) {
    color.rgb += u_haloColor * fingertipHalo(uv, u_hand0, u_pinch0);
  }
  if (u_handCount > 1) {
    color.rgb += u_haloColor * fingertipHalo(uv, u_hand1, u_pinch1);
  }

  gl_FragColor = vec4(color, 1.0);
}`;

// Stencil fill: maps pixel coords to clip space (same as debug line)
const stencilVert = /* glsl */ `
attribute vec2 a_position;
uniform vec2 u_resolution;
void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
}`;

const debugLineVert = /* glsl */ `
attribute vec2 a_position;
uniform vec2 u_resolution;
void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
}`;

const debugPointVert = /* glsl */ `
attribute vec2 a_position;
uniform vec2 u_resolution;
uniform float u_pointSize;
void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
  gl_PointSize = u_pointSize;
}`;

const debugColorFrag = /* glsl */ `
precision mediump float;
uniform vec3 u_color;
void main() {
  gl_FragColor = vec4(u_color, 1.0);
}`;

const alphaPointFrag = /* glsl */ `
precision mediump float;
uniform vec3 u_color;
uniform float u_alpha;
void main() {
  gl_FragColor = vec4(u_color, u_alpha);
}`;

// --- WebGL Helpers ---

function createShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('Shader error: ' + info);
  }
  return s;
}

function createProgram(vs, fs) {
  const v = createShader(gl.VERTEX_SHADER, vs);
  const f = createShader(gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error('Link error: ' + info);
  }
  return p;
}

function createQuad(prog) {
  const pos = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
  const tex = new Float32Array([0,1, 1,1, 0,0, 0,0, 1,1, 1,0]);
  const posLoc = gl.getAttribLocation(prog, 'a_position');
  const texLoc = gl.getAttribLocation(prog, 'a_texCoord');
  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
  const texBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
  gl.bufferData(gl.ARRAY_BUFFER, tex, gl.STATIC_DRAW);
  return { posBuf, texBuf, posLoc, texLoc };
}

function createTexture() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth * dpr;
  const h = window.innerHeight * dpr;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
  return { w, h };
}

// --- Debug Render ---

function updateLineBuffer(cloth) {
  let i = 0;
  for (const s of cloth.sticks) {
    debugF32[i++] = cloth.points[s.p0].x;
    debugF32[i++] = cloth.points[s.p0].y;
    debugF32[i++] = cloth.points[s.p1].x;
    debugF32[i++] = cloth.points[s.p1].y;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, debugBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, debugF32);
  return { buf: debugBuf, count: debugCount / 2 };
}

function drawDebugLines(prog, posLoc, data, res, color) {
  gl.useProgram(prog);
  gl.uniform2f(gl.getUniformLocation(prog, 'u_resolution'), res.w, res.h);
  gl.uniform3f(gl.getUniformLocation(prog, 'u_color'), color[0], color[1], color[2]);
  gl.bindBuffer(gl.ARRAY_BUFFER, data.buf);
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.LINES, 0, data.count);
}

// --- Render ---

let veilProg, quad, veilMirrorLoc, veilWebcamLoc;
let glassProg, glassQuad;
let stencilProg, stencilPosLoc;
let clothDataTexture;
let clothDataArr = null;      // reusable Uint8Array
let stencilBuf = null;         // persistent stencil buffer
let stencilF32 = null;         // reusable Float32Array for stencil data
let stencilCount = 0;
let debugBuf = null;
let debugF32 = null;
let debugCount = 0;
let edgeBuf = null;            // persistent edge (包边) buffer
let edgeF32 = null;
let dotBuf = null;             // persistent hand dot buffer
let dotF32 = null;
let lineProg, linePosLoc;
let pointProg, pointPosLoc, pointSizeLoc;
let dustProg, dustPosLoc, dustAlphaLoc;

function initRender() {
  veilProg = createProgram(quadVert, veilFrag);
  quad = createQuad(veilProg);
  veilMirrorLoc = gl.getUniformLocation(veilProg, 'u_mirror');
  veilWebcamLoc = gl.getUniformLocation(veilProg, 'u_webcam');

  glassProg = createProgram(quadVert, glassFrag);
  glassQuad = createQuad(glassProg);

  stencilProg = createProgram(stencilVert, debugColorFrag);
  stencilPosLoc = gl.getAttribLocation(stencilProg, 'a_position');

  lineProg = createProgram(debugLineVert, debugColorFrag);
  linePosLoc = gl.getAttribLocation(lineProg, 'a_position');
  pointProg = createProgram(debugPointVert, debugColorFrag);
  pointPosLoc = gl.getAttribLocation(pointProg, 'a_position');
  pointSizeLoc = gl.getUniformLocation(pointProg, 'u_pointSize');

  dustProg = createProgram(debugPointVert, alphaPointFrag);
  dustPosLoc = gl.getAttribLocation(dustProg, 'a_position');
  dustAlphaLoc = gl.getUniformLocation(dustProg, 'u_alpha');

  webcamTexture = createTexture();
  contentTexture = createTexture();
  // Init content texture with a dark blue so shader has valid data before first video frame
  gl.bindTexture(gl.TEXTURE_2D, contentTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([5, 40, 100, 255]));
}

function createClothDataTexture(cloth) {
  const w = cloth.cols;
  const h = cloth.rows;

  // Pre-allocate reusable arrays
  clothDataArr = new Uint8Array(w * h * 4);
  const triCount = (h - 1) * (w - 1) * 6 * 2; // 6 vertices × 2 floats per quad
  stencilF32 = new Float32Array(triCount);
  stencilBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, stencilBuf);
  gl.bufferData(gl.ARRAY_BUFFER, stencilF32.byteLength, gl.DYNAMIC_DRAW);
  stencilCount = triCount;
  debugCount = cloth.sticks.length * 4;
  debugF32 = new Float32Array(debugCount);
  debugBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, debugBuf);
  gl.bufferData(gl.ARRAY_BUFFER, debugF32.byteLength, gl.DYNAMIC_DRAW);

  // Edge buffer for perimeter binding (max perimeter length: 2*(w+h))
  const maxEdge = (w + h) * 2 * 2; // *2 for close loop, *2 for x,y
  edgeF32 = new Float32Array(maxEdge);
  edgeBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuf);
  gl.bufferData(gl.ARRAY_BUFFER, maxEdge * 4, gl.DYNAMIC_DRAW);

  // Dot buffers for hand tracking
  dotF32 = new Float32Array(10 * 2); // max 10 hand dots × 2 coords
  dotBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
  gl.bufferData(gl.ARRAY_BUFFER, dotF32.byteLength, gl.DYNAMIC_DRAW);

  clothDataTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, clothDataTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function updateClothDataTexture(cloth) {
  const w = cloth.cols;
  const h = cloth.rows;
  for (let i = 0; i < cloth.points.length; i++) {
    const p = cloth.points[i];
    clothDataArr[i * 4]     = Math.round(((p.x - p.origX) / cloth.width + 0.5) * 255);
    clothDataArr[i * 4 + 1] = Math.round(((p.y - p.origY) / cloth.height + 0.5) * 255);
    clothDataArr[i * 4 + 2] = 0;
    clothDataArr[i * 4 + 3] = 255;
  }
  gl.bindTexture(gl.TEXTURE_2D, clothDataTexture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, clothDataArr);
}

function render() {
  const res = resizeCanvas();

  // Update webcam texture from hand tracker's video element
  const videoEl = handTracker.getVideoElement();
  if (videoEl && videoEl.readyState >= videoEl.HAVE_CURRENT_DATA) {
    gl.bindTexture(gl.TEXTURE_2D, webcamTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoEl);
  }

  // Update content video texture if remote video is playing
  if (contentVideo && contentVideo.readyState >= 2) {
    gl.bindTexture(gl.TEXTURE_2D, contentTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, contentVideo);
  }

  // Collect grabbed indices from hands + mouse
  const hands = handTracker.getHands();
  const grabRadius = handTracker.getInteractionRadius();
  const grabbedIndices = [];

  // Compute hand velocity for particles
  let anyHandVel = 0;
  for (const h of hands) {
    const prev = prevHands.find(p => p.id === h.id);
    if (prev) {
      const dx = h.x - prev.x;
      const dy = h.y - prev.y;
      const vel = Math.sqrt(dx * dx + dy * dy);
      if (vel > anyHandVel) anyHandVel = vel;
    }
  }
  prevHands = hands.map(h => ({ id: h.id, x: h.x, y: h.y }));

  // Audio rustle: continuous noise modulated by cloth movement velocity
  // Sample cloth points every N points, compute average displacement from prev frame
  const sampleStep = Math.floor(cloth.points.length / 30); // ~30 sample points
  let clothVel = 0;
  if (prevClothSample) {
    let totalDisp = 0;
    let n = 0;
    for (let i = 0; i < cloth.points.length; i += sampleStep) {
      const p = cloth.points[i];
      const prev = prevClothSample[i];
      if (prev) {
        totalDisp += Math.sqrt((p.x - prev.x) ** 2 + (p.y - prev.y) ** 2);
        n++;
      }
    }
    clothVel = n > 0 ? totalDisp / n : 0;
  }
  // Store current positions for next frame's comparison
  prevClothSample = {};
  for (let i = 0; i < cloth.points.length; i += sampleStep) {
    const p = cloth.points[i];
    prevClothSample[i] = { x: p.x, y: p.y };
  }

  if (clothVel > 0.3) {
    startRustle(clothVel);
  } else {
    stopRustle();
  }

  // Dust particles: spawn near primary hand on any movement
  const now = performance.now();
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  const primaryHand = hands.find(h => h.isPinching) || hands[0];
  updateParticles(
    primaryHand ? primaryHand.x : null,
    primaryHand ? primaryHand.y : null,
    primaryHand ? anyHandVel : 0,
    dt
  );

  for (const h of hands) {
    if (h.isPinching) {
      if (h.grabbedIdx === null || !cloth.points[h.grabbedIdx]) {
        h.grabbedIdx = findClosestPoint(cloth, h.x, h.y, grabRadius);
      }
      if (h.grabbedIdx !== null) {
        const p = cloth.points[h.grabbedIdx];
        p.oldX = p.x; p.oldY = p.y;
        p.x = h.x; p.y = h.y;
        grabbedIndices.push(h.grabbedIdx);
      }
    } else {
      h.grabbedIdx = null;
    }
  }

  if (mouseDown && mouseGrabbedIdx !== null) {
    const p = cloth.points[mouseGrabbedIdx];
    p.oldX = p.x; p.oldY = p.y;
    p.x = mouseX; p.y = mouseY;
    if (!grabbedIndices.includes(mouseGrabbedIdx)) {
      grabbedIndices.push(mouseGrabbedIdx);
    }
  }

  // Physics step
  // Cancel auto-stack on grab — reset origX to flat so cloth doesn't remember stack
  if (grabbedIndices.length > 0 && cloth._autoStacking) {
    cloth._autoStacking = false;
    cloth._stackVel = null;
    for (let y = 0; y < cloth.rows; y++) {
      for (let x = 0; x < cloth.cols; x++) {
        const i = y * cloth.cols + x;
        cloth.points[i].origX = x * cloth.spacingX;
      }
    }
  }

  // On release: blue → slow restore, orange → auto-stack
  const wasGrabbing = cloth._wasGrabbing;
  cloth._wasGrabbing = grabbedIndices.length > 0;

  if (!grabbedIndices.length && wasGrabbing && !cloth._autoStacking) {
    const ratio = getClusteringRatio(cloth);
    if (ratio > 0.5) {
      // Orange: auto-stack
      const { cols, rows } = cloth;
    const top = cloth.points.slice(0, cloth.cols);
    const midX = cloth.width / 2;
    let leftCount = 0, rightCount = 0;
    for (const p of top) {
      if (p.x < midX) leftCount++;
      else rightCount++;
    }
    const stackRight = rightCount > leftCount;
    const edgeX = stackRight ? cloth.width - 5 : 5;

    // Move ALL cloth vertices' origX toward the stack edge
    for (let y = 0; y < rows; y++) {
      // Stack narrows slightly toward bottom (natural curtain drape)
      const rowT = y / (rows - 1); // 0 at top, 1 at bottom
      const spread = 180 - rowT * 80; // ~180px at rail, tapers to ~60px at bottom
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const colT = x / (cols - 1); // 0 at left, 1 at right
        const targetX = stackRight
          ? edgeX - (1 - colT) * spread
          : edgeX + colT * spread;
        cloth.points[i].origX = targetX;
      }
    }
    cloth._autoStacking = true;
    } else {
      // Blue: slowly restore to flat state — reset origX to base grid
      const { cols, rows } = cloth;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          cloth.points[i].origX = x * cloth.spacingX;
        }
      }
    }
  }

  // Auto-stack: spring animation with slight bounce
  if (cloth._autoStacking) {
    const SPRING = 0.12;   // spring stiffness
    const DAMPING = 0.55;  // slightly underdamped — one gentle bounce

    let maxDx = 0;
    if (!cloth._stackVel) cloth._stackVel = new Float32Array(cloth.points.length);
    const vel = cloth._stackVel;

    for (let i = 0; i < cloth.points.length; i++) {
      const p = cloth.points[i];
      const dx = p.origX - p.x;
      maxDx = Math.max(maxDx, Math.abs(dx));
      // Spring: accel = -k*dx - d*vel
      const accel = SPRING * dx - DAMPING * vel[i];
      vel[i] += accel;
      p.x += vel[i];
      p.oldX = p.x;
    }

    // Settled: all vertices within 1px and velocity near zero
    if (maxDx < 1) {
      let allSettled = true;
      for (let i = 0; i < cloth.points.length; i++) {
        if (Math.abs(vel[i]) > 0.3) { allSettled = false; break; }
      }
      if (allSettled) {
        cloth._autoStacking = false;
        cloth._stackVel = null;
      }
    }
    cloth.cfg.restoreForce = 0;
    cloth.cfg.iterations = 12;
  } else {
    cloth.cfg.restoreForce = grabbedIndices.length > 0 ? 0 : 0.0015;
    cloth.cfg.iterations = 6;
  }

  // --- Auto-reset: close veil after 10s with no hands detected ---
  if (hands.length > 0) {
    lastHandTime = performance.now();
    autoClosing = false;
  }

  if (autoResetEnabled && !autoClosing && !grabbedIndices.length) {
    const idleSec = (performance.now() - lastHandTime) / 1000;
    const ratio = getClusteringRatio(cloth);
    if (idleSec > 10 && ratio > 0.02) {
      // Cancel any auto-stack, trigger close
      cloth._autoStacking = false;
      cloth._stackVel = null;
      cloth.cfg.iterations = 6;
      autoClosing = true;
      const { cols, rows } = cloth;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          cloth.points[i].origX = x * cloth.spacingX;
        }
      }
    }
  }

  // During auto-close, use same gentle restore force as blue state
  if (autoClosing) {
    cloth.cfg.restoreForce = 0.0015;
    // Stop when cloth is nearly flat
    if (getClusteringRatio(cloth) < 0.01) {
      autoClosing = false;
    }
  }

  const t = performance.now() * 0.001;
  const windX = (Math.sin(t * 0.5) - 0.5) * 0.04;
  const windY = (Math.cos(t * 0.7) - 0.5) * 0.04;
  updatePhysics(cloth, grabbedIndices, windX, windY);

  // --- Diagnostics: log top-row positions once per second ---
  if (!cloth._diagTime || performance.now() - cloth._diagTime > 1000) {
    cloth._diagTime = performance.now();
    const top = cloth.points.slice(0, cloth.cols);
    const xs = top.map(p => p.x.toFixed(0)).join(',');
    const origXs = top.map(p => p.origX.toFixed(0)).join(',');
    const spacing = [];
    for (let i = 1; i < top.length; i++) {
      spacing.push((top[i].x - top[i-1].x).toFixed(0));
    }
    console.log('cluster=' + (getClusteringRatio(cloth)*100).toFixed(0) + '% grabs=' + grabbedIndices.length);
    console.log('  topX: [' + xs + ']');
    console.log('  origX: [' + origXs + ']');
    console.log('  gaps: [' + spacing.join(',') + ']');
  }

  // Update cloth data texture for shader
  updateClothDataTexture(cloth);

  // Draw
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

  // Hands within cloth bounds (for halo in glass + veil)
  const clothTop = cloth.baseY, clothBot = cloth.baseY + cloth.height;
  const inCloth = hands.filter(h => h.y >= clothTop && h.y <= clothBot);

  // Halo color: blue when <50% clustered, orange when ≥50%
  const clusterRatio = getClusteringRatio(cloth);
  if (clusterRatio > 0.1 && !hasEverOpened) {
    hasEverOpened = true;
    document.getElementById('btn-reset').classList.add('visible');
  }
  setGlassEnabled(showGlass);
  setVeilOpenRatio(clusterRatio);
  const haloColor = clusterRatio > 0.5 ? [0.95, 0.55, 0.1] : [0.35, 0.7, 1.0];

  // --- Pass 1: Glass (hidden content) scissored inside cloth bounds ---
  // Glass is slightly smaller than cloth, centered within it
  const glassMargin = 12; // px inset on each side
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(
    cloth.baseX + glassMargin,
    res.h - cloth.baseY - cloth.height + glassMargin,
    cloth.width - glassMargin * 2,
    cloth.height - glassMargin * 2
  );

  const mirror = handTracker.getCameraFacingMode() === 'user' ? 1.0 : 0.0;

  gl.useProgram(glassProg);
  gl.uniform2f(gl.getUniformLocation(glassProg, 'u_resolution'), res.w, res.h);
  gl.uniform1i(gl.getUniformLocation(glassProg, 'u_webcam'), 0);
  gl.uniform1f(gl.getUniformLocation(glassProg, 'u_mirror'), mirror);
  gl.uniform1f(gl.getUniformLocation(glassProg, 'u_showGlass'), showGlass ? 1.0 : 0.0);
  gl.uniform3f(gl.getUniformLocation(glassProg, 'u_haloColor'), haloColor[0], haloColor[1], haloColor[2]);
  gl.uniform1i(gl.getUniformLocation(glassProg, 'u_handCount'), Math.min(inCloth.length, 2));
  if (inCloth.length > 0) {
    gl.uniform2f(gl.getUniformLocation(glassProg, 'u_hand0'), inCloth[0].x / res.w, inCloth[0].y / res.h);
    gl.uniform1f(gl.getUniformLocation(glassProg, 'u_pinch0'), inCloth[0].isPinching ? 1.0 : 0.0);
  }
  if (inCloth.length > 1) {
    gl.uniform2f(gl.getUniformLocation(glassProg, 'u_hand1'), inCloth[1].x / res.w, inCloth[1].y / res.h);
    gl.uniform1f(gl.getUniformLocation(glassProg, 'u_pinch1'), inCloth[1].isPinching ? 1.0 : 0.0);
  }
  gl.uniform1f(gl.getUniformLocation(glassProg, 'u_time'), performance.now() * 0.001);
  gl.uniform1f(gl.getUniformLocation(glassProg, 'u_useVideo'), useVideo ? 1.0 : 0.0);
  gl.uniform1i(gl.getUniformLocation(glassProg, 'u_content'), 1);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, webcamTexture);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, contentTexture);
  gl.bindBuffer(gl.ARRAY_BUFFER, glassQuad.posBuf);
  gl.enableVertexAttribArray(gl.getAttribLocation(glassProg, 'a_position'));
  gl.vertexAttribPointer(gl.getAttribLocation(glassProg, 'a_position'), 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, glassQuad.texBuf);
  gl.enableVertexAttribArray(gl.getAttribLocation(glassProg, 'a_texCoord'));
  gl.vertexAttribPointer(gl.getAttribLocation(glassProg, 'a_texCoord'), 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.disable(gl.SCISSOR_TEST);

  // --- Pass 2 & 3: Stencil + Veil (skipped when veil is hidden) ---
  if (showVeil) {
    // Build triangle mesh from cloth grid quads (into pre-allocated stencilF32)
    const { cols, rows, points: pts } = cloth;
    let si = 0;
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const i = y * cols + x;
        stencilF32[si++] = pts[i].x; stencilF32[si++] = pts[i].y;
        stencilF32[si++] = pts[i + 1].x; stencilF32[si++] = pts[i + 1].y;
        stencilF32[si++] = pts[i + cols].x; stencilF32[si++] = pts[i + cols].y;
        stencilF32[si++] = pts[i + 1].x; stencilF32[si++] = pts[i + 1].y;
        stencilF32[si++] = pts[i + cols + 1].x; stencilF32[si++] = pts[i + cols + 1].y;
        stencilF32[si++] = pts[i + cols].x; stencilF32[si++] = pts[i + cols].y;
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, stencilBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, stencilF32);

    // Pass 2: Stencil fill
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.colorMask(false, false, false, false);

    gl.useProgram(stencilProg);
    gl.uniform2f(gl.getUniformLocation(stencilProg, 'u_resolution'), res.w, res.h);
    gl.bindBuffer(gl.ARRAY_BUFFER, stencilBuf);
    gl.enableVertexAttribArray(stencilPosLoc);
    gl.vertexAttribPointer(stencilPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, stencilCount / 2);

    // Pass 3: Veil shader (where stencil == 1, scissored to cloth bounds)
    gl.stencilFunc(gl.EQUAL, 1, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.colorMask(true, true, true, true);

    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      cloth.baseX,
      res.h - cloth.baseY - cloth.height,
      cloth.width,
      cloth.height
    );

    const mirror = handTracker.getCameraFacingMode() === 'user' ? 1.0 : 0.0;
    gl.useProgram(veilProg);
    gl.uniform1f(veilMirrorLoc, mirror);
    gl.uniform1i(veilWebcamLoc, 0);
    gl.uniform1i(gl.getUniformLocation(veilProg, 'u_clothData'), 1);
    gl.uniform2f(gl.getUniformLocation(veilProg, 'u_clothTexSize'), cloth.cols, cloth.rows);
    gl.uniform1f(gl.getUniformLocation(veilProg, 'u_time'), performance.now() * 0.001);
    gl.uniform1i(gl.getUniformLocation(veilProg, 'u_mode'), currentMode);

    gl.uniform3f(gl.getUniformLocation(veilProg, 'u_haloColor'), haloColor[0], haloColor[1], haloColor[2]);
    gl.uniform1i(gl.getUniformLocation(veilProg, 'u_handCount'), Math.min(inCloth.length, 2));
    if (inCloth.length > 0) {
      gl.uniform2f(gl.getUniformLocation(veilProg, 'u_hand0'),
        inCloth[0].x / res.w, inCloth[0].y / res.h);
      gl.uniform1f(gl.getUniformLocation(veilProg, 'u_pinch0'), inCloth[0].isPinching ? 1.0 : 0.0);
    }
    if (inCloth.length > 1) {
      gl.uniform2f(gl.getUniformLocation(veilProg, 'u_hand1'),
        inCloth[1].x / res.w, inCloth[1].y / res.h);
      gl.uniform1f(gl.getUniformLocation(veilProg, 'u_pinch1'), inCloth[1].isPinching ? 1.0 : 0.0);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, webcamTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, clothDataTexture);

    gl.bindBuffer(gl.ARRAY_BUFFER, quad.posBuf);
    gl.enableVertexAttribArray(quad.posLoc);
    gl.vertexAttribPointer(quad.posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad.texBuf);
    gl.enableVertexAttribArray(quad.texLoc);
    gl.vertexAttribPointer(quad.texLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
  }

  // --- Pass 4: Cloth perimeter binding (包边) ---
  gl.useProgram(stencilProg);
  gl.uniform3f(gl.getUniformLocation(stencilProg, 'u_color'), 0.9, 0.95, 1.0);
  const perim = getClothPerimeter(cloth);
  let ei = 0;
  for (const p of perim) { edgeF32[ei++] = p.x; edgeF32[ei++] = p.y; }
  if (perim.length > 0) { edgeF32[ei++] = perim[0].x; edgeF32[ei++] = perim[0].y; }
  const edgeVertCount = ei / 2;
  gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, edgeF32.subarray(0, ei));
  gl.uniform2f(gl.getUniformLocation(stencilProg, 'u_resolution'), res.w, res.h);
  gl.enableVertexAttribArray(stencilPosLoc);
  gl.vertexAttribPointer(stencilPosLoc, 2, gl.FLOAT, false, 0, 0);
  gl.lineWidth(2.0);
  gl.drawArrays(gl.LINE_STRIP, 0, edgeVertCount);

  gl.disable(gl.STENCIL_TEST);

  // Debug cloth wireframe (color = clustering ratio)
  if (showDebugGrid) {
    const lineData = updateLineBuffer(cloth);
    const ratio = getClusteringRatio(cloth);
    let wireColor;
    if (ratio > 0.5) wireColor = [1.0, 0.5, 0.0];
    else if (grabbedIndices.length > 0) wireColor = [0.3, 0.7, 1.0];
    else wireColor = [0.0, 1.0, 0.7];
    drawDebugLines(lineProg, linePosLoc, lineData, res, wireColor);
  }

  // Debug info
  const gridStatus = showDebugGrid ? 'ON' : 'OFF';
  document.getElementById('debug-info').innerText =
    `Cluster: ${(clusterRatio*100).toFixed(0)}% | Grid:${gridStatus} V:${showVeil?'on':'off'} F:${showGlass?'on':'off'} | [${modeNames[currentMode]}] 1-4 G V F R`;

  // Update key hints with current state
  const hints = document.querySelectorAll('#key-hints .hint kbd');
  if (hints.length >= 9) {
    // Grid hint
    hints[3].style.opacity = showDebugGrid ? '1' : '0.4';
    // V hint
    hints[4].style.opacity = showVeil ? '1' : '0.4';
    // F hint
    hints[6].style.opacity = showGlass ? '1' : '0.4';
  }

  // Debug: hand positions as dots
  if (showDebugGrid && hands.length > 0) {
    let di = 0;
    for (const h of hands) { dotF32[di++] = h.x; dotF32[di++] = h.y; }
    const handVertCount = di / 2;

    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dotF32.subarray(0, di));

    gl.useProgram(pointProg);
    gl.uniform2f(gl.getUniformLocation(pointProg, 'u_resolution'), res.w, res.h);
    gl.uniform1f(pointSizeLoc, 12.0);
    gl.enableVertexAttribArray(pointPosLoc);
    gl.vertexAttribPointer(pointPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3f(gl.getUniformLocation(pointProg, 'u_color'), 0.4, 0.8, 1.0);
    gl.drawArrays(gl.POINTS, 0, handVertCount);

    const pinchHands = hands.filter(h => h.isPinching);
    if (pinchHands.length > 0) {
      di = 0;
      for (const h of pinchHands) { dotF32[di++] = h.x; dotF32[di++] = h.y; }
      gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dotF32.subarray(0, di));
      gl.uniform1f(pointSizeLoc, 16.0);
      gl.uniform3f(gl.getUniformLocation(pointProg, 'u_color'), 1.0, 1.0, 1.0);
      gl.vertexAttribPointer(pointPosLoc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, pinchHands.length);
    }
  }

  // Dust particles: two-pass rendering for life-based alpha fade
  const dustCount = getParticleCount();
  if (dustCount > 0) {
    const dustPos = getParticlePositions();
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dustPos);

    gl.useProgram(dustProg);
    gl.uniform2f(gl.getUniformLocation(dustProg, 'u_resolution'), res.w, res.h);
    gl.uniform1f(gl.getUniformLocation(dustProg, 'u_pointSize'), 2.5);
    gl.uniform3f(gl.getUniformLocation(dustProg, 'u_color'), 1.0, 0.97, 0.85);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
    gl.enableVertexAttribArray(dustPosLoc);
    gl.vertexAttribPointer(dustPosLoc, 2, gl.FLOAT, false, 0, 0);

    // Pass 1: young particles (life > 1.5s) — brighter
    const youngCount = getYoungCount();
    if (youngCount > 0) {
      gl.uniform1f(dustAlphaLoc, 0.28);
      gl.drawArrays(gl.POINTS, 0, youngCount);
    }
    // Pass 2: old particles (life <= 1.5s) — fading out
    if (dustCount > youngCount) {
      gl.uniform1f(dustAlphaLoc, 0.10);
      gl.drawArrays(gl.POINTS, youngCount, dustCount - youngCount);
    }
    gl.disable(gl.BLEND);
  }

  animationId = requestAnimationFrame(render);
}

// --- Mouse ---

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
}

canvas.addEventListener('mousedown', (e) => {
  const { x, y } = getCanvasCoords(e);
  mouseX = x; mouseY = y; mouseDown = true;
  mouseGrabbedIdx = findClosestPoint(cloth, x, y, 150);
});
canvas.addEventListener('mousemove', (e) => {
  const { x, y } = getCanvasCoords(e);
  mouseX = x; mouseY = y;
});
canvas.addEventListener('mouseup', () => { mouseDown = false; mouseGrabbedIdx = null; });
canvas.addEventListener('mouseleave', () => { mouseDown = false; mouseGrabbedIdx = null; });

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const { x, y } = getCanvasCoords(e.touches[0]);
  mouseX = x; mouseY = y; mouseDown = true;
  mouseGrabbedIdx = findClosestPoint(cloth, x, y, 150);
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const { x, y } = getCanvasCoords(e.touches[0]);
  mouseX = x; mouseY = y;
}, { passive: false });
canvas.addEventListener('touchend', () => { mouseDown = false; mouseGrabbedIdx = null; });

// --- Lifecycle ---

function cleanup() {
  if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
  handTracker.destroy();
  destroyAudioEngine();
  destroyParticleSystem();
  if (dustBuf) { gl.deleteBuffer(dustBuf); dustBuf = null; }
  if (contentVideo) { contentVideo.pause(); contentVideo.src = ''; contentVideo = null; }
}

async function start() {
  document.getElementById('debug-info').innerText = 'Starting camera...';
  initRender();
  if (!audioInited) { createAudioEngine(); audioInited = true; }

  // Load default ocean video
  const defaultVideo = document.createElement('video');
  defaultVideo.src = 'default_ocean.mp4';
  defaultVideo.loop = true;
  defaultVideo.muted = true;
  defaultVideo.playsInline = true;
  contentVideo = defaultVideo;
  defaultVideo.play().then(() => {
    useVideo = true;
    console.log('Content: using default ocean video');
  }).catch(() => {});

  // Try remote content, override default if successful
  try {
    const result = await fetchDefaultContent();
    if (result && result.url) {
      const vid = document.createElement('video');
      vid.src = result.url;
      vid.loop = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.crossOrigin = 'anonymous';
      vid.play().then(() => {
        if (contentVideo) contentVideo.pause();
        contentVideo = vid;
        useVideo = true;
        console.log('Content: using remote video');
      }).catch(() => {});
    }
  } catch (_) {}

  let cameraOk = false;
  try {
    await handTracker.init();
    cameraOk = true;
  } catch (err) {
    console.warn('Camera unavailable, falling back to mouse-only mode:', err.message);
    document.getElementById('debug-info').innerText = 'Mouse-only mode (no camera)';
    // Create a fallback black texture so shaders don't sample garbage
    gl.bindTexture(gl.TEXTURE_2D, webcamTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 20, 30, 255]));
  }

  try {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sw = window.innerWidth * dpr;
    const sh = window.innerHeight * dpr;
    const clothW = sw;
    const clothH = sh * 0.8;
    const cx = 0;
    const cy = sh * 0.1;
    cloth = createCloth(clothW, clothH, {
      cols: 50,
      rows: 46,
      gravity: 0.08,
      friction: 0.94,
      stiffness: 0.6,
      restoreForce: 0.01,
      iterations: 12,
      railFriction: 0.98,
      railDamping: 0.05,
    });
    for (const p of cloth.points) {
      p.x += cx; p.y += cy;
      p.oldX = p.x; p.oldY = p.y;
      p.origX = p.x; p.origY = p.y;
    }
    cloth.baseX = cx;
    cloth.baseY = cy;
    cloth._cy = cy; // save for reset

    createClothDataTexture(cloth);

    createParticleSystem();
    dustBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 500 * 2 * 4, gl.DYNAMIC_DRAW);

    setMasterVolume(0.84);
    document.getElementById('debug-info').innerText = cameraOk ? 'System Active' : 'Mouse-only mode';
    lastFrameTime = performance.now();
    render();
  } catch (err) {
    console.error(err);
    document.getElementById('debug-info').innerText = 'Error: ' + err.message;
  }
}

document.getElementById('begin-btn').addEventListener('click', () => {
  document.getElementById('ui-overlay').classList.add('hidden');
  start();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') {
    resetCloth(cloth);
    hasEverOpened = false;
    document.getElementById('btn-reset').classList.remove('visible');
    document.getElementById('debug-info').innerText =
      'Cluster: 0% | Mode: ' + modeNames[currentMode] + ' | Reset done';
  }
  if (e.key === '1') currentMode = 0;
  if (e.key === '2') currentMode = 1;
  if (e.key === '3') currentMode = 2;
  if (e.key === '4') currentMode = 3;
  if (e.key === 'g' || e.key === 'G') {
    showDebugGrid = !showDebugGrid;
    document.getElementById('toggle-grid').classList.toggle('on', showDebugGrid);
  }
  if (e.key === 'v' || e.key === 'V') {
    showVeil = !showVeil;
    document.getElementById('toggle-veil').classList.toggle('on', showVeil);
  }
  if (e.key === 'f' || e.key === 'F') {
    showGlass = !showGlass;
    updateGlassUI();
  }
  if (e.key >= '1' && e.key <= '4') {
    document.querySelectorAll('.filter-chip').forEach(c => {
      c.classList.toggle('active', parseInt(c.dataset.mode) === currentMode);
    });
  }
});

// --- UI Controls ---

document.getElementById('btn-reset').addEventListener('click', () => {
  resetCloth(cloth);
  hasEverOpened = false;
  document.getElementById('btn-reset').classList.remove('visible');
});

// Glass filter quick toggle
const btnGlass = document.getElementById('btn-glass');
btnGlass.addEventListener('click', () => {
  showGlass = !showGlass;
  updateGlassUI();
});
function updateGlassUI() {
  btnGlass.classList.toggle('off', !showGlass);
  document.getElementById('toggle-glass').classList.toggle('on', showGlass);
}
const settingsPanel = document.getElementById('settings-panel');
const btnSettings = document.getElementById('btn-settings');
btnSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPanel.classList.toggle('hidden');
});
settingsPanel.addEventListener('click', (e) => {
  e.stopPropagation();
});
document.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

// Filter mode chips
document.getElementById('filter-options').addEventListener('click', (e) => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  currentMode = parseInt(chip.dataset.mode);
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
});

// Toggle switches
document.querySelectorAll('.toggle-switch').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('on');
    const key = btn.dataset.key;
    if (key === 'veil') showVeil = btn.classList.contains('on');
    if (key === 'glass') { showGlass = btn.classList.contains('on'); updateGlassUI(); }
    if (key === 'grid') showDebugGrid = btn.classList.contains('on');
    if (key === 'autoreset') autoResetEnabled = btn.classList.contains('on');
  });
});

// Content upload
const uploadInput = document.getElementById('content-upload');
document.getElementById('btn-upload').addEventListener('click', () => {
  uploadInput.click();
});
uploadInput.addEventListener('change', () => {
  const file = uploadInput.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video/');

  if (isVideo) {
    if (contentVideo) { contentVideo.pause(); }
    contentVideo = document.createElement('video');
    contentVideo.src = url;
    contentVideo.loop = true;
    contentVideo.muted = true;
    contentVideo.playsInline = true;
    contentVideo.play().then(() => {
      useVideo = true;
    }).catch(err => console.warn('Video play failed:', err));
  } else {
    // Image: draw to canvas once, upload to contentTexture
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, contentTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      useVideo = true;
      // Stop any video that was playing
      if (contentVideo) { contentVideo.pause(); contentVideo = null; }
    };
    img.src = url;
  }
});

// Volume slider: percentage multiplier over base levels (min 20%)
document.getElementById('volume-slider').addEventListener('input', (e) => {
  setMasterVolume(0.2 + (e.target.value / 100) * 0.8);
});

document.getElementById('btn-hide-ui').addEventListener('click', () => {
  uiHidden = !uiHidden;
  document.getElementById('controls').classList.toggle('hidden', uiHidden);
  document.getElementById('key-hints').style.opacity = uiHidden ? '0' : '1';
  const hideBtn = document.getElementById('btn-hide-ui');
  hideBtn.style.opacity = uiHidden ? '0.3' : '1';
});

let lastResizeAspect = 0;

function handleResize() {
  resizeCanvas();
  if (!cloth) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const sw = window.innerWidth * dpr;
  const sh = window.innerHeight * dpr;
  const newAspect = sw / sh;

  // Only recreate cloth if aspect ratio changed meaningfully
  if (Math.abs(newAspect - lastResizeAspect) < 0.01) return;
  lastResizeAspect = newAspect;

  const clothW = sw;
  const clothH = sh * 0.8;
  const cx = 0;
  const cy = sh * 0.1;

  // Rebuild cloth with new dimensions
  const newCloth = createCloth(clothW, clothH, {
    cols: cloth.cols,
    rows: cloth.rows,
    gravity: cloth.cfg.gravity,
    friction: cloth.cfg.friction,
    stiffness: cloth.cfg.stiffness,
    restoreForce: cloth.cfg.restoreForce,
    iterations: cloth.cfg.iterations,
    railFriction: cloth.cfg.railFriction,
    railDamping: cloth.cfg.railDamping,
  });
  for (const p of newCloth.points) {
    p.x += cx; p.y += cy;
    p.oldX = p.x; p.oldY = p.y;
    p.origX = p.x; p.origY = p.y;
  }
  newCloth.baseX = cx;
  newCloth.baseY = cy;
  newCloth._cy = cy;

  // Replace old cloth and recreate data texture + buffers
  cloth = newCloth;
  createClothDataTexture(cloth);
  hasEverOpened = false;
  document.getElementById('btn-reset').classList.remove('visible');
}

window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 300));
window.addEventListener('beforeunload', cleanup);
