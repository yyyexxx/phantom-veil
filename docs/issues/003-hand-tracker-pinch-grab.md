# 003 — HandTracker: pinch-to-grab

**Type**: HITL
**Blocked by**: None — can start immediately (parallel with #002)

## What to build

Wrap MediaPipe Hands into a reusable module that manages the camera lifecycle, detects hands, and emits pinch/grab events. Wire grab events into the PhysicsEngine so hand pinch gestures can pull the cloth.

Auto-adaptation of interaction thresholds based on device type and camera FOV is included so the experience feels natural out of the box on both phones and laptops.

**HITL reason**: Pinch threshold, interaction radius, and hand-to-screen spatial mapping must be validated by a real human standing in front of a camera. The parameters are subjective feel, not algorithmically provable.

## Acceptance criteria

- [ ] Camera starts and MediaPipe Hands initializes on user action (not auto-play)
- [ ] Pinch detected when thumb-index distance < threshold (0.05 normalized, 0.08 for hysteresis release)
- [ ] Hand screen coordinate maps correctly to the canvas coordinate system
- [ ] Pinching near a cloth vertex grabs it and moves it with the hand
- [ ] Releasing pinch drops the vertex
- [ ] Both hands work simultaneously (maxNumHands: 2)
- [ ] Hand state maintained across frames (no hand-swap drop within 200px tracking radius)
- [ ] Device adaptation reads camera FOV or falls back to device-type lookup table
- [ ] Interaction threshold auto-set without user configuration
- [ ] **HITL gate**: Human tester confirms pinch feels responsive and grab radius feels natural on both laptop and phone

## User stories

- #3 — Subtle visual hints when moving close
- #4 — Pinch and pull naturally
- #5 — Fingertip halo when hand near veil
- #6 — Halo changes between dim (open) and bright (pinch)
- #21 — Both hands work simultaneously
- #29 — Smooth on both desktop and phone
