// --- Phantom Veil — Main Entry ---

import { createCloth, updatePhysics, findClosestPoint, getClothPerimeter, resetCloth, getClusteringRatio } from './physics.js';
import { createHandTracker } from './hand-tracking.js';

const canvas = document.getElementById('veil-canvas');
const gl = canvas.getContext('webgl', {
  alpha: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
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
let currentMode = 2; // 0=stress 1=wire 2=edge 3=hue (default: edge glow)
const modeNames = ['Stress', 'Wireframe', 'Edge Glow', 'Hue Shift'];
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
uniform int u_mode; // 0=stress 1=wire 2=edge 3=hue

vec2 getDisp(vec2 uv) {
  vec4 s = texture2D(u_clothData, uv);
  return (s.rg - 0.5) * 2.0;
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

void main() {
  vec2 uv = v_texCoord;
  if (u_mirror > 0.5) uv.x = 1.0 - uv.x;

  vec4 color = texture2D(u_webcam, uv);
  float stress = getStress(uv);
  float edge = isEdge(uv);

  if (u_mode == 0) {
    // A: Stress heatmap — bright on stretch, dark on compression
    color.rgb = mix(color.rgb, color.rgb * 0.6, stress * 0.4);
    color.rgb += vec3(0.12, 0.14, 0.2) * stress;
  } else if (u_mode == 1) {
    // B: Wireframe — grid lines visible on interaction
    vec2 grid = fract(uv * u_clothTexSize);
    float line = 1.0 - step(0.04, grid.x) * step(0.04, grid.y);
    float glow = line * (0.03 + stress * 0.2);
    color.rgb += glow * 0.7;
  } else if (u_mode == 2) {
    // C: Edge glow — bright halo along cloth perimeter
    float halo = edge * (0.06 + stress * 0.25);
    color.rgb += vec3(0.5, 0.7, 1.0) * halo;
  } else {
    // D: Hue shift — blue-green tint under cloth
    float tint = 0.02 + stress * 0.06;
    color.r = mix(color.r, color.r * 0.9, tint);
    color.g = mix(color.g, color.g * 0.93, tint * 0.7);
    color.b = mix(color.b, color.b * 1.1, tint);
  }

  gl_FragColor = color;
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

function buildLineBuffer(cloth) {
  const pos = [];
  for (const s of cloth.sticks) {
    pos.push(cloth.points[s.p0].x, cloth.points[s.p0].y);
    pos.push(cloth.points[s.p1].x, cloth.points[s.p1].y);
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
  return { buf, count: pos.length / 2 };
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
let clothDataTexture, clothDataBuf;
let lineProg, linePosLoc;
let pointProg, pointPosLoc, pointSizeLoc;

function initRender() {
  veilProg = createProgram(quadVert, veilFrag);
  quad = createQuad(veilProg);
  veilMirrorLoc = gl.getUniformLocation(veilProg, 'u_mirror');
  veilWebcamLoc = gl.getUniformLocation(veilProg, 'u_webcam');
  lineProg = createProgram(debugLineVert, debugColorFrag);
  linePosLoc = gl.getAttribLocation(lineProg, 'a_position');
  pointProg = createProgram(debugPointVert, debugColorFrag);
  pointPosLoc = gl.getAttribLocation(pointProg, 'a_position');
  pointSizeLoc = gl.getUniformLocation(pointProg, 'u_pointSize');
  webcamTexture = createTexture();
  clothDataBuf = new Float32Array(38 * 35 * 4); // will resize on cloth creation
}

function createClothDataTexture(cloth) {
  const w = cloth.cols;
  const h = cloth.rows;
  const data = new Uint8Array(w * h * 4);

  for (let i = 0; i < cloth.points.length; i++) {
    const p = cloth.points[i];
    // Encode displacement as 0-255: ((dx / clothWidth) + 0.5) * 255
    data[i * 4]     = Math.round(((p.x - p.origX) / cloth.width + 0.5) * 255);
    data[i * 4 + 1] = Math.round(((p.y - p.origY) / cloth.height + 0.5) * 255);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }

  clothDataTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, clothDataTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function updateClothDataTexture(cloth) {
  const w = cloth.cols;
  const h = cloth.rows;
  const data = new Uint8Array(w * h * 4);

  for (let i = 0; i < cloth.points.length; i++) {
    const p = cloth.points[i];
    data[i * 4]     = Math.round(((p.x - p.origX) / cloth.width + 0.5) * 255);
    data[i * 4 + 1] = Math.round(((p.y - p.origY) / cloth.height + 0.5) * 255);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }

  gl.bindTexture(gl.TEXTURE_2D, clothDataTexture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
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
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Veil pass (webcam + refraction + moiré)
  const mirror = handTracker.getCameraFacingMode() === 'user' ? 1.0 : 0.0;
  gl.useProgram(veilProg);
  gl.uniform1f(veilMirrorLoc, mirror);
  gl.uniform1i(veilWebcamLoc, 0);
  gl.uniform1i(gl.getUniformLocation(veilProg, 'u_clothData'), 1);
  gl.uniform2f(gl.getUniformLocation(veilProg, 'u_clothTexSize'), cloth.cols, cloth.rows);
  gl.uniform1f(gl.getUniformLocation(veilProg, 'u_time'), performance.now() * 0.001);
  gl.uniform1i(gl.getUniformLocation(veilProg, 'u_mode'), currentMode);

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

  // Debug cloth wireframe (color = clustering ratio)
  const lineData = buildLineBuffer(cloth);
  const ratio = getClusteringRatio(cloth);
  let wireColor;
  if (ratio > 0.5) wireColor = [1.0, 0.5, 0.0];        // orange = mostly clustered
  else if (grabbedIndices.length > 0) wireColor = [0.3, 0.7, 1.0]; // blue = being grabbed
  else wireColor = [0.0, 1.0, 0.7];                    // green = default
  drawDebugLines(lineProg, linePosLoc, lineData, res, wireColor);

  // Debug info
  document.getElementById('debug-info').innerText =
    `Cluster: ${(ratio*100).toFixed(0)}% | Grabs: ${grabbedIndices.length} | [${modeNames[currentMode]}] 1-4 R`;

  // Debug: hand positions as dots with proper point size
  if (hands.length > 0) {
    const handPositions = new Float32Array(hands.flatMap(h => [h.x, h.y]));
    const dotBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
    gl.bufferData(gl.ARRAY_BUFFER, handPositions, gl.DYNAMIC_DRAW);

    gl.useProgram(pointProg);
    gl.uniform2f(gl.getUniformLocation(pointProg, 'u_resolution'), res.w, res.h);
    gl.uniform1f(pointSizeLoc, 12.0);

    // All hands in one draw call
    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
    gl.enableVertexAttribArray(pointPosLoc);
    gl.vertexAttribPointer(pointPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3f(gl.getUniformLocation(pointProg, 'u_color'), 0.4, 0.8, 1.0);
    gl.drawArrays(gl.POINTS, 0, hands.length);

    // Pinching hands: larger white dots on top
    const pinchPositions = hands.filter(h => h.isPinching);
    if (pinchPositions.length > 0) {
      const pinchData = new Float32Array(pinchPositions.flatMap(h => [h.x, h.y]));
      const pinchBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pinchBuf);
      gl.bufferData(gl.ARRAY_BUFFER, pinchData, gl.DYNAMIC_DRAW);
      gl.uniform1f(pointSizeLoc, 16.0);
      gl.uniform3f(gl.getUniformLocation(pointProg, 'u_color'), 1.0, 1.0, 1.0);
      gl.bindBuffer(gl.ARRAY_BUFFER, pinchBuf);
      gl.vertexAttribPointer(pointPosLoc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, pinchPositions.length);
      gl.deleteBuffer(pinchBuf);
    }
    gl.deleteBuffer(dotBuf);
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
    const clothH = sh;
    const cx = 0;
    const cy = 0;
    cloth = createCloth(clothW, clothH, {
      cols: 38,
      rows: 35,
      gravity: 0.25,
      friction: 0.94,
      stiffness: 0.35,
      restoreForce: 0,
      railDamping: 0.03,
      openThreshold: 200,
    });
    for (const p of cloth.points) {
      p.x += cx; p.y += cy;
      p.oldX = p.x; p.oldY = p.y;
      p.origX = p.x; p.origY = p.y;
    }
    cloth.baseX = cx;
    cloth.baseY = cy;

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
  if (e.key >= '1' && e.key <= '4') {
    document.getElementById('debug-info').innerText =
      'Mode: ' + modeNames[currentMode] + ' (1-4 to switch)';
  }
});

window.addEventListener('resize', resizeCanvas);
window.addEventListener('beforeunload', cleanup);
