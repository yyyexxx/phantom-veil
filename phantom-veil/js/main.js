// --- Phantom Veil — Main Entry ---

import { createCloth, updatePhysics, findClosestPoint, getClothPerimeter, resetCloth, getClusteringRatio } from './physics.js';
import { createHandTracker } from './hand-tracking.js';

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
let showDebugGrid = true; // G to toggle
let showVeil = true;       // V to toggle cloth/veil
let showGlass = true;      // F to toggle glass filter
const modeNames = ['Stress', 'Wireframe', 'Edge Glow', 'Velvet'];
const handTracker = createHandTracker(canvas);

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
    color.rgb += vec3(0.7, 0.85, 1.0) * fingertipHalo(uv, u_hand0, u_pinch0);
  }
  if (u_handCount > 1) {
    color.rgb += vec3(0.7, 0.85, 1.0) * fingertipHalo(uv, u_hand1, u_pinch1);
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

// Glass frag: hidden content with refraction + reflection
const glassFrag = /* glsl */ `
precision mediump float;
varying vec2 v_texCoord;
uniform vec2 u_resolution;
uniform sampler2D u_webcam;
uniform float u_mirror;
uniform float u_showGlass;
uniform vec2 u_hand0;
uniform vec2 u_hand1;
uniform float u_pinch0;
uniform float u_pinch1;
uniform int u_handCount;
uniform float u_time;

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

void main() {
  vec2 uv = v_texCoord;

  vec3 top    = vec3(0.04, 0.22, 0.50);
  vec3 bottom = vec3(0.01, 0.12, 0.30);
  vec3 ocean = mix(top, bottom, uv.y);
  float ray = sin(uv.x * 40.0 + uv.y * 15.0) * sin(uv.y * 35.0 - uv.x * 10.0);
  ocean += ray * 0.04;

  if (u_showGlass < 0.5) {
    gl_FragColor = vec4(ocean, 1.0);
    return;
  }

  float rx = sin(uv.y * 200.0) * 0.0006;
  float ry = cos(uv.x * 180.0) * 0.0004;
  vec2 refrUV = uv + vec2(rx, ry);

  vec3 refrOcean = mix(top, bottom, refrUV.y);
  float ray2 = sin(refrUV.x * 40.0 + refrUV.y * 15.0) * sin(refrUV.y * 35.0 - refrUV.x * 10.0);
  refrOcean += ray2 * 0.04;

  vec2 camUV = uv;
  if (u_mirror > 0.5) camUV.x = 1.0 - camUV.x;
  vec3 cam = texture2D(u_webcam, camUV).rgb;

  vec3 color = mix(refrOcean, cam, 0.12);

  // Fingertip halos on glass too
  if (u_handCount > 0) {
    color.rgb += vec3(0.7, 0.85, 1.0) * fingertipHalo(uv, u_hand0, u_pinch0);
  }
  if (u_handCount > 1) {
    color.rgb += vec3(0.7, 0.85, 1.0) * fingertipHalo(uv, u_hand1, u_pinch1);
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
  webcamTexture = createTexture();
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

  // Collect grabbed indices from hands + mouse
  const hands = handTracker.getHands();
  const grabRadius = handTracker.getInteractionRadius();
  const grabbedIndices = [];

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
  // Hand halos on glass
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
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, webcamTexture);
  gl.bindBuffer(gl.ARRAY_BUFFER, glassQuad.posBuf);
  gl.enableVertexAttribArray(gl.getAttribLocation(glassProg, 'a_position'));
  gl.vertexAttribPointer(gl.getAttribLocation(glassProg, 'a_position'), 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, glassQuad.texBuf);
  gl.enableVertexAttribArray(gl.getAttribLocation(glassProg, 'a_texCoord'));
  gl.vertexAttribPointer(gl.getAttribLocation(glassProg, 'a_texCoord'), 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.disable(gl.SCISSOR_TEST);

  // Hands within cloth bounds (for halo rendering in both glass & veil)
  const clothTop = cloth.baseY, clothBot = cloth.baseY + cloth.height;
  const inCloth = hands.filter(h => h.y >= clothTop && h.y <= clothBot);

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

    // Pass hand positions (screen px → UV)
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
  const clusterRatio = getClusteringRatio(cloth);
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
}

async function start() {
  try {
    document.getElementById('debug-info').innerText = 'Starting camera...';
    initRender();
    await handTracker.init();

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

    document.getElementById('debug-info').innerText = 'System Active';
    render();
  } catch (err) {
    console.error(err);
    document.getElementById('debug-info').innerText = 'Camera Error: ' + err.message;
  }
}

document.getElementById('begin-btn').addEventListener('click', () => {
  document.getElementById('ui-overlay').classList.add('hidden');
  start();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') {
    resetCloth(cloth);
    document.getElementById('debug-info').innerText =
      'Cluster: 0% | Mode: ' + modeNames[currentMode] + ' | Reset done';
  }
  if (e.key === '1') currentMode = 0;
  if (e.key === '2') currentMode = 1;
  if (e.key === '3') currentMode = 2;
  if (e.key === '4') currentMode = 3;
  if (e.key === 'g' || e.key === 'G') {
    showDebugGrid = !showDebugGrid;
  }
  if (e.key === 'v' || e.key === 'V') {
    showVeil = !showVeil;
  }
  if (e.key === 'f' || e.key === 'F') {
    showGlass = !showGlass;
  }
  if (e.key >= '1' && e.key <= '4') {
    document.getElementById('debug-info').innerText =
      'Mode: ' + modeNames[currentMode] + ' (1-4 switch, G grid)';
  }
});

window.addEventListener('resize', resizeCanvas);
window.addEventListener('beforeunload', cleanup);
