# 009 — Dust particles

**Type**: AFK
**Blocked by**: #003 (HandTracker)

## What to build

A subtle dust particle system. When a hand moves near the veil surface, a small number of particles spawn at the hand position and drift with slow Brownian motion before fading out. The visual reference is sunlit dust motes disturbed by movement — barely there, not a spectacle.

Particles are rendered as tiny (1-2px) WebGL instanced points with low opacity. No physics interaction with the cloth — purely visual overlay.

## Acceptance criteria

- [ ] Particles spawn at hand position when hand velocity > minimum threshold
- [ ] 5-10 particles spawned per trigger event (not per frame)
- [ ] Maximum ~500 particles alive at any time
- [ ] Particles move with slow Brownian motion (random walk with very small step)
- [ ] Particles fade out over ~3 second lifespan (alpha 0.3 → 0)
- [ ] Particles rendered as 1-2px points via WebGL instanced draw
- [ ] Particle system CPU time < 0.2ms per frame at 500 particles
- [ ] Particles not distracting — visible if looking for them, but don't draw attention

## User stories

- #20 — Tiny dust particles float up when hand moves near veil
