# 007 — Visual polish: stress crease / fingertip halo / ripples

**Type**: AFK
**Blocked by**: #004 (Top-rail physics), #006 (Glass shader + stencil)

## What to build

Add the three visual overlays that make the invisible veil feel tangible:

1. **Stress crease highlights**: Along edges of the cloth where vertices are under tension (stretched sticks), render a faint white highlight. Like the Predator's cloak flashing when hit — the only visual evidence of the veil's existence. More intense in stacked/compressed regions.

2. **Fingertip halo**: A small glowing circle rendered at each tracked fingertip position. Two states:
   - Hand near veil, not pinching → small, dim halo (radius ~8px, alpha ~0.4)
   - Hand pinching (grabbing) → larger, bright halo (radius ~14px, alpha ~0.8)
   - Color: cool white (#e8f0ff)

3. **Ripple effect**: When a hand is within the interaction zone (close to the veil surface), linear ripple patterns emanate from the fingertip position across the veil surface — like wind disturbing still water, not circular ripples. Intensity fades with distance from fingertip.

## Acceptance criteria

- [ ] Stress creases visible as white highlights along stretched stick edges
- [ ] Crease intensity scales with stretch ratio: more stretch = brighter highlight
- [ ] Stacked/compressed regions show denser, brighter crease patterns
- [ ] Fingertip halo renders at each tracked hand's index fingertip position
- [ ] Halo smoothly transitions between dim (open hand) and bright (pinching) states
- [ ] Ripple effect activates when hand distance to veil < interaction threshold
- [ ] Ripples are linear (wind-like), not circular
- [ ] Ripples fade with distance from fingertip origin
- [ ] All three effects render on top of the veil/glass layers without breaking the stencil split
- [ ] GPU overhead of all three combined < 1ms on integrated GPU

## User stories

- #5 — Fingertip halo when hand near veil
- #6 — Halo two states (dim/bright)
- #7 — Wind-like ripple patterns
- #14 — White crease highlights along stress lines
