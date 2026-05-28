// --- Phantom Veil — Dust Particles ---
// Subtle dust motes disturbed by hand movement near the veil.
// Rendered as tiny GL_POINTS with low opacity. No physics interaction with cloth.

const MAX_PARTICLES = 500;
const SPAWN_COUNT = 8;        // particles per trigger
const SPAWN_INTERVAL = 80;    // ms between spawn triggers
const LIFE_SPAN = 3.0;        // seconds
const INITIAL_ALPHA = 0.2;
const BROWNIAN_STEP = 0.15;   // max px per frame random walk
const VELOCITY_THRESHOLD = 1.0; // px/frame to trigger spawn

// Flat arrays for cache-friendly access
let positions = null;   // Float32Array(max * 2)
let velocities = null;  // Float32Array(max * 2)
let life = null;        // Float32Array(max)
let count = 0;
let lastSpawnTime = 0;

export function createParticleSystem() {
  positions = new Float32Array(MAX_PARTICLES * 2);
  velocities = new Float32Array(MAX_PARTICLES * 2);
  life = new Float32Array(MAX_PARTICLES);
  count = 0;
  lastSpawnTime = 0;
}

export function getParticleCount() {
  return count;
}

export function getParticlePositions() {
  return positions.subarray(0, count * 2);
}

// Returns how many particles have life > 1.5s (young).
// As a side effect, partitions the arrays so young particles come first.
export function getYoungCount() {
  let young = 0;
  let old = count - 1;
  while (young <= old) {
    if (life[young] > 1.5) {
      young++;
    } else {
      // Swap young+1's data with old
      const sy = young * 2;
      const so = old * 2;
      [positions[sy], positions[so]] = [positions[so], positions[sy]];
      [positions[sy + 1], positions[so + 1]] = [positions[so + 1], positions[sy + 1]];
      [velocities[sy], velocities[so]] = [velocities[so], velocities[sy]];
      [velocities[sy + 1], velocities[so + 1]] = [velocities[so + 1], velocities[sy + 1]];
      [life[young], life[old]] = [life[old], life[young]];
      old--;
    }
  }
  return young;
}

// Call once per frame. Spawns particles near hand position when hand moves.
// handX, handY: screen coords of hand (or null if no hand)
// handVel: px/frame hand velocity (0 if no hand)
// dt: delta time in seconds
export function updateParticles(handX, handY, handVel, dt) {
  const now = performance.now();

  // --- Spawn ---
  if (handVel > VELOCITY_THRESHOLD && now - lastSpawnTime > SPAWN_INTERVAL && count < MAX_PARTICLES) {
    lastSpawnTime = now;
    const toSpawn = Math.min(SPAWN_COUNT, MAX_PARTICLES - count);
    for (let i = 0; i < toSpawn; i++) {
      const idx = count + i;
      const base = idx * 2;
      // Spread particles in a small radius around hand
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 30;
      positions[base]     = handX + Math.cos(angle) * dist;
      positions[base + 1] = handY + Math.sin(angle) * dist;
      // Small initial velocity in random direction
      velocities[base]     = (Math.random() - 0.5) * 0.8;
      velocities[base + 1] = (Math.random() - 0.5) * 0.8 - 0.3; // slight upward bias
      life[idx] = LIFE_SPAN;
    }
    count += toSpawn;
  }

  // --- Update: Brownian motion + life decay ---
  for (let i = 0; i < count; i++) {
    const base = i * 2;

    // Brownian motion: random perturbation
    velocities[base]     += (Math.random() - 0.5) * BROWNIAN_STEP * 2;
    velocities[base + 1] += (Math.random() - 0.5) * BROWNIAN_STEP * 2;

    // Damping so they don't accelerate forever
    velocities[base]     *= 0.92;
    velocities[base + 1] *= 0.92;

    // Slight upward drift (warm air)
    velocities[base + 1] -= 0.03 * dt;

    positions[base]     += velocities[base];
    positions[base + 1] += velocities[base + 1];

    life[i] -= dt;
  }

  // --- Remove dead particles (swap-with-last) ---
  let i = 0;
  while (i < count) {
    if (life[i] <= 0) {
      const last = count - 1;
      if (i !== last) {
        const src = last * 2;
        const dst = i * 2;
        positions[dst]     = positions[src];
        positions[dst + 1] = positions[src + 1];
        velocities[dst]     = velocities[src];
        velocities[dst + 1] = velocities[src + 1];
        life[i] = life[last];
      }
      count--;
    } else {
      i++;
    }
  }
}

export function destroyParticleSystem() {
  positions = null;
  velocities = null;
  life = null;
  count = 0;
}
