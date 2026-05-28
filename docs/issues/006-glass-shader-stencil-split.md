# 006 — Glass shader + stencil region split

**Type**: AFK
**Blocked by**: #004 (Top-rail physics), #005 (Veil shader)

## What to build

Implement the stencil-based region splitting using the cloth perimeter as the boundary. Pixels inside the cloth perimeter render with the veil shader (#005). Pixels outside render with the glass shader:

- **Glass refraction**: Uniform 2-3px UV offset across the entire revealed area — simulating looking through a standard window pane.
- **Glass reflection**: Webcam feed blended at 10-15% opacity over the hidden content, creating the "see your own reflection in the glass" effect.

The hidden content layer (ocean video placeholder for now) sits between the webcam background and the glass filter.

## Acceptance criteria

- [ ] Cloth perimeter vertices define a stencil mask updated each frame
- [ ] Veil region: veil shader applied (refraction + moiré from #005)
- [ ] Revealed region: glass shader applied (refraction + reflection)
- [ ] Glass reflection webcam feed blends at 10-15% over hidden content
- [ ] Hidden content placeholder (solid color or test image) visible in revealed area
- [ ] Transition at the boundary is clean (no visible seam or bleed)
- [ ] Stencil mask updates smoothly as cloth deforms (no flicker)
- [ ] Tests pass: stencil renders correct region count, glass shader compiles and links

## User stories

- #7 — Wind-like ripple patterns (region boundary enables this)
- #9 — Grab from any point on surface
- #14 — White crease highlights along stress lines
- #16 — Hidden content behind glass pane
- #17 — Glass reflection shows own silhouette
