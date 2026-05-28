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
let showDebugGrid = true; // G to toggle
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

void main() {
  vec2 uv = v_texCoord;
  vec4 clothSample = texture2D(u_clothData, uv);

  // Mirror for webcam
  vec2 webcamUV = uv;
  if (u_mirror > 0.5) webcamUV.x = 1.0 - webcamUV.x;

  float isBack = clothSample.b; // B channel = flip flag from JS

  if (isBack > 0.5) {
    // Back face: dark red velvet
    float noise = fract(sin(dot(uv * 50.0, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 dark  = vec3(0.35, 0.02, 0.03);
    vec3 rich  = vec3(0.50, 0.04, 0.05);
    gl_FragColor = vec4(mix(dark, rich, noise), 1.0);
  } else {
    // Front face: webcam with subtle linen weave
    vec4 color = texture2D(u_webcam, webcamUV);
    float warp = abs(sin(uv.x * 300.0 + uv.y * 3.0));
    float weft = abs(sin(uv.y * 280.0 + uv.x * 2.0));
    float weave = smoothstep(0.3, 0.7, warp * 0.6 + weft * 0.4) * 0.06;
    color.rgb = mix(color.rgb, color.rgb * 0.94, weave);
    color.rgb += weave * 0.04;
    gl_FragColor = color;
  }
}`;

// Glass frag: revealed area placeholder
const glassFrag = /* glsl */ `
precision mediump float;
uniform vec2 u_resolution;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 ocean = mix(vec3(0.0, 0.08, 0.2), vec3(0.0, 0.15, 0.35), uv.y);
  gl_FragColor = vec4(ocean, 1.0);
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
let glassProg, glassQuad;
let stencilProg, stencilPosLoc;
let clothDataTexture, clothDataBuf;
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
  clothDataBuf = new Float32Array(38 * 35 * 4);
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

  // Encode displacement in R,G channels
  for (let i = 0; i < cloth.points.length; i++) {
    const p = cloth.points[i];
    data[i * 4]     = Math.round(((p.x - p.origX) / cloth.width + 0.5) * 255);
    data[i * 4 + 1] = Math.round(((p.y - p.origY) / cloth.height + 0.5) * 255);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }

  // Detect flipped quads → store in B channel of all 4 vertices
  const { cols, rows, points } = cloth;
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const tl = points[y * cols + x];
      const tr = points[y * cols + x + 1];
      const bl = points[(y + 1) * cols + x];
      // Cross product of diagonals: negative = flipped (back face)
      const cross = (tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x);
      if (cross < 0) {
        // Mark all 4 vertices of this quad as back face
        data[(y * cols + x) * 4 + 2] = 255;
        data[(y * cols + x + 1) * 4 + 2] = 255;
        data[((y + 1) * cols + x) * 4 + 2] = 255;
        data[((y + 1) * cols + x + 1) * 4 + 2] = 255;
      }
    }
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
  gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

  // --- Pass 1: Revealed area (placeholder glass) ---
  gl.useProgram(glassProg);
  gl.uniform2f(gl.getUniformLocation(glassProg, 'u_resolution'), res.w, res.h);
  gl.bindBuffer(gl.ARRAY_BUFFER, glassQuad.posBuf);
  gl.enableVertexAttribArray(gl.getAttribLocation(glassProg, 'a_position'));
  gl.vertexAttribPointer(gl.getAttribLocation(glassProg, 'a_position'), 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, glassQuad.texBuf);
  gl.enableVertexAttribArray(gl.getAttribLocation(glassProg, 'a_texCoord'));
  gl.vertexAttribPointer(gl.getAttribLocation(glassProg, 'a_texCoord'), 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // --- Pass 2: Stencil — draw cloth grid ---
  gl.enable(gl.STENCIL_TEST);
  gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
  gl.colorMask(false, false, false, false);

  // Build triangle mesh from cloth grid quads
  const { cols, rows, points: pts } = cloth;
  const triVerts = [];
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const i = y * cols + x;
      // Two triangles per quad
      triVerts.push(pts[i].x, pts[i].y);
      triVerts.push(pts[i + 1].x, pts[i + 1].y);
      triVerts.push(pts[i + cols].x, pts[i + cols].y);

      triVerts.push(pts[i + 1].x, pts[i + 1].y);
      triVerts.push(pts[i + cols + 1].x, pts[i + cols + 1].y);
      triVerts.push(pts[i + cols].x, pts[i + cols].y);
    }
  }
  const triBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triVerts), gl.DYNAMIC_DRAW);

  gl.useProgram(stencilProg);
  gl.uniform2f(gl.getUniformLocation(stencilProg, 'u_resolution'), res.w, res.h);
  gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
  gl.enableVertexAttribArray(stencilPosLoc);
  gl.vertexAttribPointer(stencilPosLoc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, triVerts.length / 2);
  gl.deleteBuffer(triBuf);

  // --- Pass 3: Veil shader (only where stencil == 1) ---
  gl.stencilFunc(gl.EQUAL, 1, 0xFF);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
  gl.colorMask(true, true, true, true);

  const mirror = handTracker.getCameraFacingMode() === 'user' ? 1.0 : 0.0;
  gl.useProgram(veilProg);
  gl.uniform1f(veilMirrorLoc, mirror);
  gl.uniform1i(veilWebcamLoc, 0);
  gl.uniform1i(gl.getUniformLocation(veilProg, 'u_clothData'), 1);
  gl.uniform2f(gl.getUniformLocation(veilProg, 'u_clothTexSize'), cloth.cols, cloth.rows);
  gl.uniform1f(gl.getUniformLocation(veilProg, 'u_time'), performance.now() * 0.001);
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

  // --- Pass 4: Cloth perimeter binding (包边) ---
  gl.useProgram(stencilProg);
  gl.uniform3f(gl.getUniformLocation(stencilProg, 'u_color'), 0.9, 0.95, 1.0);
  const perim = getClothPerimeter(cloth);
  const edgeVerts = [];
  for (const p of perim) edgeVerts.push(p.x, p.y);
  // Close the loop
  if (perim.length > 0) {
    edgeVerts.push(perim[0].x, perim[0].y);
  }
  const edgeBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(edgeVerts), gl.DYNAMIC_DRAW);
  gl.uniform2f(gl.getUniformLocation(stencilProg, 'u_resolution'), res.w, res.h);
  gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuf);
  gl.enableVertexAttribArray(stencilPosLoc);
  gl.vertexAttribPointer(stencilPosLoc, 2, gl.FLOAT, false, 0, 0);
  gl.lineWidth(2.0);
  gl.drawArrays(gl.LINE_STRIP, 0, edgeVerts.length / 2);
  gl.deleteBuffer(edgeBuf);

  gl.disable(gl.STENCIL_TEST);

  // Debug cloth wireframe (color = clustering ratio)
  if (showDebugGrid) {
    const lineData = buildLineBuffer(cloth);
    const ratio = getClusteringRatio(cloth);
    let wireColor;
    if (ratio > 0.5) wireColor = [1.0, 0.5, 0.0];
    else if (grabbedIndices.length > 0) wireColor = [0.3, 0.7, 1.0];
    else wireColor = [0.0, 1.0, 0.7];
    drawDebugLines(lineProg, linePosLoc, lineData, res, wireColor);
  }

  // Debug info
  const ratio = getClusteringRatio(cloth);
  const gridStatus = showDebugGrid ? 'ON' : 'OFF';
  document.getElementById('debug-info').innerText =

  // Debug: hand positions as dots
  if (showDebugGrid && hands.length > 0) {
    const handPositions = new Float32Array(hands.flatMap(h => [h.x, h.y]));
    const dotBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
    gl.bufferData(gl.ARRAY_BUFFER, handPositions, gl.DYNAMIC_DRAW);

    gl.useProgram(pointProg);
    gl.uniform2f(gl.getUniformLocation(pointProg, 'u_resolution'), res.w, res.h);
    gl.uniform1f(pointSizeLoc, 12.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
    gl.enableVertexAttribArray(pointPosLoc);
    gl.vertexAttribPointer(pointPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3f(gl.getUniformLocation(pointProg, 'u_color'), 0.4, 0.8, 1.0);
    gl.drawArrays(gl.POINTS, 0, hands.length);

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
      gravity: 0.08,
      friction: 0.94,
      stiffness: 0.4,
      restoreForce: 0.0015,
      iterations: 12,
      railFriction: 0.94,
      railDamping: 1.0,
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
  }
  if (e.key === 'g' || e.key === 'G') {
    showDebugGrid = !showDebugGrid;
  }
});

window.addEventListener('resize', resizeCanvas);
window.addEventListener('beforeunload', cleanup);
