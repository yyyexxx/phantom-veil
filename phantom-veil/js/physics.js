// --- Phantom Veil — Physics Engine ---
// Pure physics model: no mode switching. Rail vertices slide with high friction,
// can cluster freely, resist movement from cloth tension.

export const DEFAULT_CONFIG = {
  cols: 50,
  rows: 46,
  gravity: 0.10,
  friction: 0.92,
  stiffness: 0.35,
  restoreForce: 0.0005,
  railFriction: 0.96,     // rail vertices: higher friction = stay where put
  railDamping: 0.15,       // rail vertices in constraints: only absorb 15% of force
  iterations: 6,
  interactionRadius: 150,
};

export function createCloth(width, height, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const cols = cfg.cols;
  const rows = cfg.rows;
  const spacingX = width / (cols - 1);
  const spacingY = height / (rows - 1);

  const points = [];
  const sticks = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * spacingX;
      const py = y * spacingY;
      points.push({
        x: px, y: py,
        oldX: px, oldY: py,
        origX: px, origY: py,
        railPinned: y === 0,
      });
    }
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      if (x < cols - 1 && y > 0) {
        sticks.push({ p0: idx, p1: idx + 1, len: spacingX, stiffness: cfg.stiffness });
      }
      if (y < rows - 1) {
        sticks.push({ p0: idx, p1: idx + cols, len: spacingY, stiffness: cfg.stiffness });
      }
    }
  }

  return { points, sticks, cols, rows, spacingX, spacingY, width, height, cfg };
}

export function getClothPerimeter(cloth) {
  const { points, cols, rows } = cloth;
  const p = [];
  for (let x = 0; x < cols; x++) p.push(points[x]);
  for (let y = 1; y < rows; y++) p.push(points[y * cols + (cols - 1)]);
  for (let x = cols - 2; x >= 0; x--) p.push(points[(rows - 1) * cols + x]);
  for (let y = rows - 2; y > 0; y--) p.push(points[y * cols]);
  return p;
}

export function findClosestPoint(cloth, sx, sy, radius) {
  let closest = null;
  let minDistSq = radius * radius;
  for (let i = 0; i < cloth.points.length; i++) {
    const p = cloth.points[i];
    if (p.railPinned) continue;
    const dx = p.x - sx, dy = p.y - sy;
    const dSq = dx * dx + dy * dy;
    if (dSq < minDistSq) { minDistSq = dSq; closest = i; }
  }
  return closest;
}

export function getClusteringRatio(cloth) {
  // Fraction of top-row vertices that are clustered (gap < 10px)
  let clustered = 0;
  for (let i = 1; i < cloth.cols; i++) {
    if (cloth.points[i].x - cloth.points[i - 1].x < 10) clustered++;
  }
  return clustered / (cloth.cols - 1);
}

export function updatePhysics(cloth, grabbedIndices, windX = 0, windY = 0) {
  const { points, sticks, cfg } = cloth;
  const grabbed = new Set(grabbedIndices);

  // --- Verlet integration ---
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.railPinned) {
      if (grabbed.has(i)) { p.oldX = p.x; p.oldY = p.y; continue; }
      const vx = (p.x - p.oldX) * cfg.railFriction;
      p.oldX = p.x; p.oldY = p.y;
      p.x += vx + (p.origX - p.x) * cfg.restoreForce + windX * 0.1;
      continue;
    }

    if (grabbed.has(i)) { p.oldX = p.x; p.oldY = p.y; continue; }

    const vx = (p.x - p.oldX) * cfg.friction;
    const vy = (p.y - p.oldY) * cfg.friction;
    const rx = (p.origX - p.x) * cfg.restoreForce;
    const ry = (p.origY - p.y) * cfg.restoreForce;
    p.oldX = p.x; p.oldY = p.y;
    p.x += vx + windX + rx;
    p.y += vy + windY + ry + cfg.gravity;
  }

  // --- Rail order enforcement (cluster allowed, no crossing) ---
  for (let i = 1; i < cloth.cols; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (curr.x < prev.x + 2) {
      const mid = (prev.x + curr.x) / 2;
      prev.x = mid - 1;
      curr.x = mid + 1;
    }
  }

  // --- Stick constraint relaxation ---
  for (let iter = 0; iter < cfg.iterations; iter++) {
    for (const s of sticks) {
      const p0 = points[s.p0];
      const p1 = points[s.p1];

      let dx = p1.x - p0.x;
      let dy = p1.y - p0.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0) continue;

      const diff = (s.len - dist) / dist / 2;
      const ox = dx * diff * s.stiffness;
      const oy = dy * diff * s.stiffness;

      // Rail vertices are "heavy" — they resist constraint forces
      if (!grabbed.has(s.p0)) {
        p0.x -= ox * (p0.railPinned ? cfg.railDamping : 1);
        if (!p0.railPinned) p0.y -= oy;
      }
      if (!grabbed.has(s.p1)) {
        p1.x += ox * (p1.railPinned ? cfg.railDamping : 1);
        if (!p1.railPinned) p1.y += oy;
      }
    }
  }
}

export function resetCloth(cloth) {
  const offsetY = cloth._cy || 0;
  for (let y = 0; y < cloth.rows; y++) {
    for (let x = 0; x < cloth.cols; x++) {
      const i = y * cloth.cols + x;
      const p = cloth.points[i];
      const px = x * cloth.spacingX;
      const py = y * cloth.spacingY + offsetY;
      p.x = px; p.y = py;
      p.oldX = px; p.oldY = py;
      p.origX = px; p.origY = py;
    }
  }
}

export function computeStressData(cloth) {
  const { points, sticks } = cloth;
  const stress = new Float32Array(sticks.length);
  for (let i = 0; i < sticks.length; i++) {
    const s = sticks[i];
    const dx = points[s.p1].x - points[s.p0].x;
    const dy = points[s.p1].y - points[s.p0].y;
    stress[i] = Math.sqrt(dx * dx + dy * dy) / s.len;
  }
  return { stress };
}
