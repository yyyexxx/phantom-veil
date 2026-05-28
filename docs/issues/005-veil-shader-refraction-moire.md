# 005 — Veil shader: refraction + moiré

**Type**: AFK
**Blocked by**: #001 (WebGL render loop)

## What to build

Write the fragment shader that renders the veil-covered region. Two effects overlay the webcam feed:

1. **Refraction**: UV displacement based on cloth vertex positions — vertices pushed by physics → local screen-space distortion like looking through uneven glass. 1-2px offset at rest, scaling up based on vertex displacement.

2. **Moiré pattern**: Fine diagonal line pattern superimposed with subtle intensity. Static and near-invisible at rest. The pattern subtly shifts as cloth vertices move, creating the perception of a surface without rendering one.

The shader operates on the full-screen quad. The region split (veil vs revealed) is handled later in #006 via stencil.

## Acceptance criteria

- [ ] Fragment shader compiles and links without errors
- [ ] Refraction displaces UV by configurable pixel amount based on cloth vertex displacement
- [ ] Moiré pattern visible as fine diagonal line overlay, configurable intensity
- [ ] At rest: refraction 1-2px, moiré very faint
- [ ] During pull: refraction 5-8px, following stress direction
- [ ] No visual artifacts at screen edges
- [ ] Shader performance: < 2ms GPU time on integrated GPU at 1080p
- [ ] Tests pass: shader compilation, shader link, uniform binding validation

## User stories

- #2 — Screen looks like normal mirror at first
- #3 — Subtle visual hints when moving close
