# 011 — Device adaptation + mobile + auto-reset + mouse fallback

**Type**: AFK
**Blocked by**: #003 (HandTracker), #004 (Top-rail physics)

## What to build

Cross-device polish that ensures Phantom Veil works seamlessly across phones, tablets, and desktops without user configuration:

1. **Device adaptation**: Read `MediaStreamTrack.getSettings().fieldOfView` when available. Fall back to device-type classification (phone/tablet/laptop via `navigator.maxTouchPoints` + screen width) and camera-facing mode + resolution aspect ratio. Map to the hand-to-screen-size ratio threshold for interactively detecting "hand near veil."

2. **Screen rotation**: Listen to `resize` and `orientationchange` events. Recalculate canvas size, cloth grid dimensions, and aspect ratios. No forced orientation lock.

3. **Auto-reset**: Track time since last hand detection. After 30 continuous seconds with no hands, animate the veil sliding back to fully closed position.

4. **Mouse fallback**: When no camera is available or MediaPipe fails to load, left-click drag on the canvas grabs the nearest cloth vertex and drags it (2D only — no peek depth). Right-click or double-click resets.

## Acceptance criteria

- [ ] FOV auto-detected from camera track when available
- [ ] Device type correctly classified (phone/tablet/laptop) from available signals
- [ ] Interaction threshold auto-set and logged to console (for debugging)
- [ ] Canvas and cloth grid resize correctly on orientation change without visual glitch
- [ ] No forced orientation — both portrait and landscape work
- [ ] Auto-reset timer starts when last hand disappears from frame
- [ ] After 10 seconds with no hands, veil smoothly animates back to closed
- [ ] Timer resets if a hand reappears before the 30-second mark
- [ ] Mouse left-click drag functions as pinch-grab when no hand tracking
- [ ] Mouse drag is horizontal-only (simulates lateral pull, no peek)
- [ ] Reset button and auto-reset both work with mouse-only mode

## User stories

- #22 — Veil auto-closes after 10 seconds when user leaves
- #23 — Works in portrait and landscape
- #24 — Mouse drag on desktop without webcam
- #29 — Smooth on both desktop and phone
