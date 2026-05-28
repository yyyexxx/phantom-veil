# 002 — PhysicsEngine: cloth simulation + mouse grab

**Type**: AFK
**Blocked by**: None — can start immediately (parallel with #003)

## What to build

Implement the Verlet-integration cloth physics engine as an isolated module with no DOM or rendering dependencies. It produces a deformable mesh of vertices connected by stick constraints. Mouse drag serves as the initial grab input before hand tracking is wired in.

The module exposes: create a grid, step physics one frame, grab/release a vertex near a screen coordinate, get all vertex positions and stress data for the renderer.

## Acceptance criteria

- [ ] Creates a grid (default 38×35) with top-row vertices pinned
- [ ] Gravity, friction, and restore force apply correctly each frame
- [ ] Stick constraints resolve within the configured iteration count
- [ ] Mouse click-drag within interaction radius grabs the nearest vertex
- [ ] Grabbed vertex follows cursor; released vertex resumes physics
- [ ] Grabbing does not affect pinned (top-row) vertices
- [ ] Physics step time < 3ms on a mid-range laptop for 38×35 grid
- [ ] Tests pass: stick constraint convergence, pinned vertex immobility, gravity accumulation, restore force direction

## User stories

- #15 — Veil feels heavy and substantial

## Tests

Unit tests for PhysicsEngine:
- Single stick constraint resolves to correct rest length
- Multiple iterations converge closer to rest state than single iteration
- Pinned vertex position is unchanged after physics step with external force
- Restore force points toward original position
- Gravity moves unpinned vertices downward each frame
- Grab returns the closest vertex within radius, null when none
