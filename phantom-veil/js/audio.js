// --- Phantom Veil — Audio Engine ---
// Cloth rustle synthesis + glass low-pass filter on hidden content audio

let ctx = null;
let rustleSource = null;    // persistent looping noise source
let rustleGain = null;      // velocity-controlled gain
let rustleFilter = null;

// Ocean ambience nodes (placeholder until #012 provides real audio)
let oceanSource = null;
let oceanGain = null;
let oceanPreFilter = null;    // shapes brown noise into ocean waves
let oceanLFO = null;
let oceanLFOGain = null;

// Glass low-pass chain: source → glassFilter → glassGain → masterGain → analyser → destination
let glassFilter = null;
let glassGain = null;

// Master output
let masterGain = null;
let analyser = null;

export function createAudioEngine() {
  if (ctx) return; // already created

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { console.warn('Web Audio API not supported'); return; }

  ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();

  // --- Master output ---
  masterGain = ctx.createGain();
  masterGain.gain.value = 1.0;

  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.7;

  // masterGain → analyser → destination (analyser taps the signal, passes through)
  masterGain.connect(analyser);
  analyser.connect(ctx.destination);

  // --- Rustle: continuous looping noise, volume modulated by hand velocity ---
  rustleFilter = ctx.createBiquadFilter();
  rustleFilter.type = 'lowpass';
  rustleFilter.frequency.value = 1800;
  rustleFilter.Q.value = 0.5;
  rustleFilter.connect(masterGain);

  rustleGain = ctx.createGain();
  rustleGain.gain.value = 0;  // silent until hand moves
  rustleGain.connect(rustleFilter);

  // 2-second looping noise buffer for continuous rustle texture
  const rustleLen = ctx.sampleRate * 2;
  const rustleBuf = ctx.createBuffer(1, rustleLen, ctx.sampleRate);
  const data = rustleBuf.getChannelData(0);
  for (let i = 0; i < rustleLen; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.5;
  }

  rustleSource = ctx.createBufferSource();
  rustleSource.buffer = rustleBuf;
  rustleSource.loop = true;
  rustleSource.connect(rustleGain);
  rustleSource.start();

  // --- Ocean ambience: shaped brown noise (placeholder for ocean video audio) ---
  // Generated as a looping 4-second buffer of filtered noise
  const oceanLen = ctx.sampleRate * 4;
  const oceanBuf = ctx.createBuffer(1, oceanLen, ctx.sampleRate);
  const oceanData = oceanBuf.getChannelData(0);
  // Brown noise: integrate white noise (simple random walk)
  let brown = 0;
  for (let i = 0; i < oceanLen; i++) {
    brown += (Math.random() * 2 - 1) * 0.02;
    brown *= 0.999; // slow decay to prevent drift
    oceanData[i] = brown * 0.7;
  }

  oceanSource = ctx.createBufferSource();
  oceanSource.buffer = oceanBuf;
  oceanSource.loop = true;

  // Shape brown noise to sound like waves: gentle low-pass for natural ocean tone
  // Keep enough high-end so the glass low-pass sweep (800Hz→20000Hz) is audible
  oceanPreFilter = ctx.createBiquadFilter();
  oceanPreFilter.type = 'lowpass';
  oceanPreFilter.frequency.value = 3000;
  oceanPreFilter.Q.value = 0.5;

  oceanLFO = ctx.createOscillator();
  oceanLFO.frequency.value = 0.08; // slow wave rhythm
  oceanLFOGain = ctx.createGain();
  oceanLFOGain.gain.value = 0.15;

  oceanGain = ctx.createGain();
  oceanGain.gain.value = 0.25;

  // Glass low-pass: the "behind glass" filter
  glassFilter = ctx.createBiquadFilter();
  glassFilter.type = 'lowpass';
  glassFilter.frequency.value = 800; // start heavily muffled
  glassFilter.Q.value = 0.7;

  glassGain = ctx.createGain();
  glassGain.gain.value = 0.5; // -6dB at closed

  // Wire ocean chain: source → preFilter → oceanGain → glassFilter → glassGain → masterGain → analyser → destination
  oceanSource.connect(oceanPreFilter);
  oceanPreFilter.connect(oceanGain);
  oceanGain.connect(glassFilter);
  glassFilter.connect(glassGain);
  glassGain.connect(masterGain);

  // Wire LFO to oceanGain for wave-like volume modulation
  oceanLFO.connect(oceanLFOGain);
  oceanLFOGain.connect(oceanGain.gain);

  oceanSource.start();
  oceanLFO.start();
}

export function startRustle(velocity) {
  if (!ctx || ctx.state === 'closed' || !rustleGain) return;

  // Map velocity to gain: faster movement = louder rustle
  const target = Math.min(velocity / 25, 0.06);
  rustleGain.gain.setTargetAtTime(target, ctx.currentTime, 0.03);
}

export function stopRustle() {
  if (!ctx || ctx.state === 'closed' || !rustleGain) return;
  rustleGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
}

let glassEnabled = true;

export function setGlassEnabled(enabled) {
  glassEnabled = enabled;
  if (!ctx || ctx.state === 'closed') return;
  if (!enabled) {
    // Bypass: full cutoff + 0dB — audio passes through unfiltered
    glassFilter.frequency.setTargetAtTime(20000, ctx.currentTime, 0.05);
    glassGain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.05);
  }
  // When re-enabled, setVeilOpenRatio will restore correct values next frame
}

export function setVeilOpenRatio(ratio) {
  if (!ctx || ctx.state === 'closed') return;
  if (!glassEnabled) return; // bypass active, don't override

  // ratio: 0 = fully closed, 1 = fully open
  const clamped = Math.max(0, Math.min(1, ratio));

  // Filter cutoff: 800Hz (closed) → 20000Hz (open)
  const cutoff = 800 + clamped * (20000 - 800);
  glassFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.05);

  // Gain: -6dB (closed) → 0dB (open)
  // -6dB = 0.5 linear, 0dB = 1.0 linear
  const gain = 0.5 + clamped * 0.5;
  glassGain.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
}

// --- Reserved interfaces ---

// Volume slider hook: 0.0 (silent) → 1.0 (full)
export function setMasterVolume(value) {
  if (!masterGain) return;
  const v = Math.max(0, Math.min(1, value));
  masterGain.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
}

// RGB 拾音灯 hook: returns { bass, mid, treble } each 0..1
// Call once per frame; analyser captures mixed output of both rustle + ocean
export function getAudioSpectrum() {
  if (!analyser) return { bass: 0, mid: 0, treble: 0 };

  const bins = analyser.frequencyBinCount; // fftSize / 2 = 128
  const data = new Uint8Array(bins);
  analyser.getByteFrequencyData(data);

  // Divide spectrum into 3 bands (log-scale-ish)
  // bass:   bins 0..15   (roughly 0–340Hz at 44.1kHz)
  // mid:    bins 16..55  (roughly 340Hz–3kHz)
  // treble: bins 56..127 (roughly 3kHz–22kHz)
  let bass = 0, mid = 0, treble = 0;
  for (let i = 0; i < 16; i++) bass += data[i];
  for (let i = 16; i < 56; i++) mid += data[i];
  for (let i = 56; i < bins; i++) treble += data[i];

  bass   /= 16 * 255;
  mid    /= 40 * 255;
  treble /= (bins - 56) * 255;

  return { bass, mid, treble };
}

export function destroyAudioEngine() {
  try { rustleSource.stop(); } catch (_) { /* already stopped */ }
  try { oceanSource.stop(); } catch (_) { /* already stopped */ }
  try { oceanLFO.stop(); } catch (_) { /* already stopped */ }

  if (ctx && ctx.state !== 'closed') {
    ctx.close();
  }
  ctx = null;
  rustleSource = null;
  rustleGain = null;
  rustleFilter = null;
  glassFilter = null;
  glassGain = null;
  masterGain = null;
  analyser = null;
}
