# 001 — Scaffold: WebGL render loop + webcam on screen

**Type**: AFK
**Blocked by**: None — can start immediately

## What to build

Set up the minimum viable HTML page that initializes a WebGL context and renders the webcam feed as a full-screen texture. This is the skeleton onto which every other slice attaches.

The page loads, requests camera permission, creates a WebGL context, and continuously draws the camera frame to a full-screen quad. No physics, no hand tracking, no shaders beyond a basic passthrough.

## Acceptance criteria

- [ ] Page opens in Chrome 110+
- [ ] Camera permission prompt appears and works
- [ ] Live webcam feed fills the entire viewport, maintaining aspect ratio (object-fit: cover behavior)
- [ ] Front camera is mirrored horizontally
- [ ] Window resize adapts the canvas and video feed without distortion
- [ ] No errors in console, no memory leaks on page unload

## User stories

- #1 — See myself on screen
- #23 — Works in portrait and landscape
