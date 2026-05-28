// --- Phantom Veil — Physics Engine ---
// Ring-driven rail + Verlet cloth for silk-like fabric

export const DEFAULT_CONFIG = {
  cols: 38,
  rows: 35,
  gravity: 0.10,
  friction: 0.92,
  stiffness: 0.65,        // silk: resists stretch
  restoreForce: 0.0,       // silk: no memory of original shape
  iterations: 6,
  interactionRadius: 150,
  openThreshold: 40,
  ringCount: 8,            // number of curtain rings on the rod
  ringRadius: 18,          // ring size (min spacing between rings)
  ringDriveForce: 1.0,     // how strongly hand pull drives the rings
};

export function createCloth(width, height, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const cols = cfg.cols;
  const rows = cfg.rows;
  const spacingX = width / (cols - 1);
  const spacingY = height / (rows - 1);

  // --- Rings (curtain rod) ---
  const ringCount = cfg.ringCount;
  const ringSpacing = width / (ringCount - 1);
  const rings = [];
  for (let i = 0; i < ringCount; i++) {
    rings.push({
      x: i * ringSpacing,      // current X on the rod
      origX: i * ringSpacing,  // original X (for reset)
      y: 0,                    // rod height
    });
  }

  // --- Cloth points ---
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
        pinned: false,
        ringIdx: -1,
      });
    }
  }

  // --- Sticks (cloth grid) ---
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      // Skip horizontal sticks on top row — it's ring-driven, not constraint-driven
      if (x < cols - 1 && y > 0) {
        sticks.push({ p0: idx, p1: idx + 1, len: spacingX });
      }
      if (y < rows - 1) {
        sticks.push({ p0: idx, p1: idx + cols, len: spacingY });
      }
    }
  }

  // --- Map top-row vertices to nearest ring ---
  for (let x = 0; x < cols; x++) {
    const clothIdx = x;
    const px = x * spacingX;
    let bestRing = 0;
    let bestDist = Infinity;
    for (let r = 0; r < ringCount; r++) {
      const d = Math.abs(px - rings[r].x);
      if (d < bestDist) { bestDist = d; bestRing = r; }
    }
    points[clothIdx].ringIdx = bestRing;
  }

  return {
    points, sticks, rings,
    cols, rows,
    spacingX, spacingY,
    baseX: 0, baseY: 0,
    width, height,
    mode: 'closed',
    cfg,
  };
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
    if (p.pinned) continue;
    const dx = p.x - sx, dy = p.y - sy;
    const dSq = dx * dx + dy * dy;
    if (dSq < minDistSq) { minDistSq = dSq; closest = i; }
  }
  return closest;
}

export function updatePhysics(cloth, grabbedIndices, windX = 0, windY = 0) {
  const { points, sticks, rings, cols, cfg } = cloth;
  const grabbed = new Set(grabbedIndices);
  const hasGrabs = grabbedIndices.length > 0;

  // --- Ring drive ---
  // When a vertex is grabbed, compute its horizontal pull and drive nearby rings
  if (hasGrabs) {
    // Compute average horizontal displacement of grabbed vertices
    let sumDx = 0, count = 0;
    for (const gi of grabbedIndices) {
      const p = points[gi];
      const dx = p.x - p.origX;
      sumDx += dx;
      count++;
    }
    const avgDx = count > 0 ? sumDx / count : 0;

    // Drive each ring based on how close the grabbed vertex is
    // A grabbed vertex affects all rings, with influence based on horizontal proximity
    for (const gi of grabbedIndices) {
      const gp = points[gi];
      const grabScreenX = gp.x;

      for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];
        const dist = Math.abs(ring.x - grabScreenX);
        // Gaussian falloff: closer rings get more drive
        const influence = Math.exp(-(dist * dist) / (2 * 150 * 150));
        ring.x += (gp.x - gp.oldX) * influence * cfg.ringDriveForce;
      }
    }
  }

  // --- Ring constraints ---
  // Rings can't pass each other → enforce minimum spacing
  for (let r = 1; r < rings.length; r++) {
    const gap = rings[r].x - rings[r - 1].x;
    if (gap < cfg.ringRadius) {
      const push = (cfg.ringRadius - gap) / 2;
      rings[r].x += push;
      rings[r - 1].x -= push;
    }
  }
  // Clamp rings within screen bounds
  for (const ring of rings) {
    ring.x = Math.max(0, Math.min(cloth.width, ring.x));
  }

  // --- Weak ring restore (when no grabs) ---
  if (!hasGrabs && cloth.mode !== 'open') {
    for (const ring of rings) {
      ring.x += (ring.origX - ring.x) * 0.001; // very slow drift back
    }
  }

  // --- Mode detection ---
  if (cloth.mode === 'closed' && hasGrabs) {
    cloth.mode = 'peek';
  }
  if (cloth.mode !== 'open') {
    for (const gi of grabbedIndices) {
      if (Math.abs(points[gi].x - points[gi].origX) > cfg.openThreshold) {
        cloth.mode = 'open';
        // Lock rings at current position
        for (const ring of rings) {
          ring.origX = ring.x;
        }
        break;
      }
    }
  }
  if (!hasGrabs && cloth.mode === 'peek') {
    cloth.mode = 'closed';
  }

  // --- Update cloth top row from rings (interpolated) ---
  // Each top-row vertex is placed smoothly between its two nearest rings.
  // Skip vertices currently being grabbed — hand position takes priority.
  for (let x = 0; x < cols; x++) {
    const idx = x;
    if (grabbed.has(idx)) continue;
    const p = points[idx];
    const px = x * cloth.spacingX;

    // Find two nearest rings and interpolate
    let leftRing = rings[0], rightRing = rings[rings.length - 1];
    for (let r = 0; r < rings.length - 1; r++) {
      if (px >= rings[r].x && px <= rings[r + 1].x) {
        leftRing = rings[r];
        rightRing = rings[r + 1];
        break;
      }
    }
    // Linear interpolation between the two rings
    const range = rightRing.x - leftRing.x;
    const t = range > 0 ? (px - leftRing.x) / range : 0;
    p.x = leftRing.x + t * (rightRing.x - leftRing.x);
    p.y = 0;
    p.oldX = p.x;
    p.oldY = p.y;
  }

  // --- Verlet integration (free vertices) ---
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.pinned || grabbed.has(i) || p.ringIdx >= 0) continue; // skip grabbed + ring-driven

    const vx = (p.x - p.oldX) * cfg.friction;
    const vy = (p.y - p.oldY) * cfg.friction;

    p.oldX = p.x;
    p.oldY = p.y;
    p.x += vx + windX;
    p.y += vy + windY + cfg.gravity;
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
      const ox = dx * diff * cfg.stiffness;
      const oy = dy * diff * cfg.stiffness;

      if (!p0.pinned && !grabbed.has(s.p0)) {
        p0.x -= ox;
        p0.y -= oy;
      }
      if (!p1.pinned && !grabbed.has(s.p1)) {
        p1.x += ox;
        p1.y += oy;
      }
    }
  }
}

export function resetCloth(cloth) {
  cloth.mode = 'closed';
  const ringSpacing = cloth.width / (cloth.rings.length - 1);
  for (let i = 0; i < cloth.rings.length; i++) {
    cloth.rings[i].x = i * ringSpacing;
    cloth.rings[i].origX = i * ringSpacing;
  }
  for (let y = 0; y < cloth.rows; y++) {
    for (let x = 0; x < cloth.cols; x++) {
      const i = y * cloth.cols + x;
      const p = cloth.points[i];
      const px = x * cloth.spacingX;
      const py = y * cloth.spacingY;
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
