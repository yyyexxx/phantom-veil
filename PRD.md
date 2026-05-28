# Phantom Veil — Product Requirements Document

## Problem Statement

Digital art installations typically show their content immediately. The user wants a piece where the content is hidden behind an invisible, interactive barrier — pushing visitors to discover the hidden world through physical hand gestures, creating a moment of revelation rather than passive viewing.

## Solution

Phantom Veil is a browser-based interactive digital art piece. A full-screen webcam feed shows "reality" (the user themselves). A hidden media layer (default: an ocean video) sits behind an invisible, physics-simulated veil. The user pinches and pulls the veil with their hand — like drawing open a curtain — to reveal the ocean beneath. The veil is invisible (Predator-style optical camouflage), detectable only through subtle screen refraction and moiré patterns. When pulled aside, the hidden content appears behind a glass filter that reflects the camera feed, creating a natural "looking through a window" experience.

## User Stories

1. As a visitor, I want to see myself on screen (webcam feed), so that I know the installation is working and I am the subject.
2. As a visitor, I want the screen to look like a normal mirror/camera at first glance, so that the hidden content is a surprise discovery.
3. As a visitor, I want subtle visual hints (refraction distortion, moiré patterns) when I move close to the screen, so that I sense "there is something here" and begin exploring.
4. As a visitor, I want to naturally pinch the air with my fingers and pull, to interact with the invisible veil.
5. As a visitor, I want to see a glowing halo on my fingertip when my hand is near the veil, so that I know where my hand is relative to the interaction surface.
6. As a visitor, I want the fingertip halo to change between two states (dim when open hand, bright when pinching), so that I get clear feedback on whether I'm "grabbing" or not.
7. As a visitor, I want to see wind-like ripple patterns emanate from my fingertip when I'm close to the veil, so that I perceive the veil as a tangible surface.
8. As a visitor, I want to pull the veil sideways to slide it open along its top rail, revealing the hidden ocean beneath — like drawing a real curtain.
9. As a visitor, I want to grab the veil from any point on its surface (not just the edges), so that the interaction is forgiving and natural.
10. As a visitor, I want to peek under the veil by pulling a corner outward/upward, revealing a small triangular opening without fully opening the curtain.
11. As a visitor, I want the peeked corner to fall back into place when I let go, so that the behavior matches real fabric.
12. As a visitor, I want the fully opened veil to stay in place when I let go, so that I can admire the revealed content without holding my hand there.
13. As a visitor, I want to grab the stacked fabric on one side and pull it back across to close the veil, so that I can interact symmetrically.
14. As a visitor, I want to see subtle white crease highlights along stress lines when I pull the veil, so that I get visual confirmation of "where the fabric is bending" — like the Predator's cloak flashing on impact.
15. As a visitor, I want the veil to feel heavy and substantial, like a thick stage curtain, not like a silk scarf — so that the interaction has weight and drama.
16. As a visitor, I want the hidden ocean to appear behind a glass pane effect when revealed: slight refraction distortion plus a subtle reflection of the camera feed (10-15% opacity), so that it feels like I'm looking through a window.
17. As a visitor, I want the glass reflection to show my own silhouette, so that I remain aware of my hand position even when the veil is fully open.
18. As a visitor, I want to hear a subtle fabric rustle when I pull the veil, reinforcing the tactile illusion.
19. As a visitor, I want the ocean video's audio to sound muffled (low-pass filtered) as if heard through glass, becoming clearer as more of the veil is opened.
20. As a visitor, I want to see tiny dust particles float up when my hand moves near the veil, like sunlit dust disturbed by movement — subtle and not distracting.
21. As a visitor, I want both hands to work simultaneously, so that I can pull the veil open from both sides like a stage curtain if I choose.
22. As a visitor, I want the veil to automatically close after 30 seconds if I walk away (hands disappear from camera), so that the next visitor gets the full experience.
23. As a visitor using a phone, I want the experience to work smoothly whether I hold my phone in portrait or landscape, so that I'm not forced into a specific grip.
24. As a visitor on desktop without a webcam, I want to use my mouse to drag the veil open/closed, so that I can still experience the core interaction.
25. As a visitor, I want a beautiful Apple Liquid Glass style start screen with a single button to begin, so that the experience feels polished from the first impression.
26. As a visitor, I want the option to flip between front and rear cameras, so that I can choose what "reality" is shown on the screen.
27. As a visitor, I want to reset the veil to its closed state with a single tap (reset button), so that I can re-experience the reveal.
28. As a developer, I want the API to support a /api/content/default endpoint in the future, so that the hidden content can be changed remotely without redeploying the frontend.
29. As an exhibition organizer, I want the piece to run smoothly on both a high-end desktop in a gallery and a mid-range smartphone, so that it's accessible regardless of the venue's hardware.
30. As the artist, I want the "green screen" metaphor preserved — the veil is invisible like a chroma-keyed green cloth in post-production — as a future update to add a toggleable green fabric visualization during interaction.

## Implementation Decisions

### Technology Stack

- **Core rendering**: WebGL 1.0 (via p5.js 1.9 bootstrapping, direct WebGL for shader pipeline)
- **Hand tracking**: MediaPipe Hands 0.4, webcam input
- **Physics**: Custom Verlet integration with stick constraints (spring-mass cloth model), no external physics library
- **Audio**: Web Audio API — BiquadFilterNode for glass low-pass, sample-based rustle playback
- **UI**: Vanilla HTML/CSS, Apple Liquid Glass visual style
- **No framework**: No React/Vue. Single-page application with modular vanilla JS.

### Module Architecture

**Deep Modules (testable in isolation):**

1. **PhysicsEngine** — The cloth simulation. Pure computation: takes vertex positions + external forces, outputs new positions + stress data. Verlet integration, stick constraints, top-rail sliding, fabric stacking, restore forces, gravity, friction, and wind. No rendering or DOM dependencies.

2. **HandTracker** — MediaPipe wrapper. Manages camera lifecycle, runs hand detection, detects pinch/release gestures, normalizes screen coordinates, auto-adapts interaction thresholds based on device type and camera FOV. Exposes a callback-based interface.

3. **Renderer** — WebGL rendering pipeline. Compiles and manages shader programs (veil, glass, ripple), handles vertex/UV/framebuffer state, applies the veil clipping mask (stencil-based region split), composites camera feed + hidden content + glass reflections. GPU resource lifecycle (create/delete).

**Shallow Modules:**

4. **Particles** — Dust particle system: spawn on hand velocity, Brownian motion, fade out. Input: hand velocity vector, output: particle positions/opacity array.
5. **AudioEngine** — Web Audio graph manager: connects source nodes through BiquadFilterNode to destination, links filter cutoff to veil-open percentage.
6. **UIManager** — DOM-based UI: start button, reset, flip camera, hide UI toggle. Apple Liquid Glass CSS styling.
7. **ApiClient** — Fetch wrapper for content API. Falls back to built-in default ocean video when endpoint is unreachable. Reserved for future backend.

### Physical Interaction Model

The veil behaves as a heavy stage curtain with a fixed top rail:
- Top-row vertices can slide horizontally along the rail but cannot move vertically
- Non-top vertices are free (not pinned)
- Horizontal pulling force → top vertices slide, fabric stacks/compresses on one side
- Upward/outward pulling force → local deformation without top-rail movement (peek)
- Released peek → vertices restore to original positions (gravity + restore force)
- Released full-open → fabric stays at current position
- Mouse fallback: left-click drag = pinch grab + move (2D only, no peek depth)

### Visual States

The veil is invisible in its resting state (like Predator optical camouflage). Three visual cues replace explicit fabric rendering:

| State | Refraction (UV offset) | Moiré pattern | Edge highlight |
|---|---|---|---|
| Resting (no hand near) | 1-2px, uniform | Very faint, static | None |
| Hand approaching | 2-3px | Faint, subtle movement | None |
| Being pulled | 5-8px, follows stress | Dynamic, follows deformation | White crease along stress lines |
| Stacked/compressed | 10-15px, dense | Intensified, flickering | Brighter edge glow |

Fingertip halo rendering:
- Hand near veil, not pinching → small dim halo (suggests "you can grab here")
- Hand pinching (grabbing veil) → larger bright halo (confirms "grabbed")
- Ripple effect: when hand is close to veil surface, wind-like linear ripples emanate from fingertips across the veil surface

### Glass Filter

The revealed hidden content appears behind a glass pane:
- Refraction: uniform 2-3px UV offset across the entire revealed area
- Reflection: camera feed blended at 10-15% opacity over the hidden content
- Audio: hidden content audio passes through a low-pass filter (~2000-3000Hz cutoff), linked to veil-open percentage — more open = higher cutoff = clearer sound

### Device Adaptation

Interaction thresholds auto-adapt without user configuration:
1. Read `MediaStreamTrack.getSettings().fieldOfView` if available
2. Fallback: classify device (phone/tablet/laptop) via `navigator.maxTouchPoints` + screen width
3. Map to hand-size-to-screen ratio threshold for activation zone
4. Camera-facing mode and resolution aspect ratio refine the estimate

### Audio Design

- Cloth rustle sample triggered on grab + during drag, volume proportional to hand velocity
- Hidden content audio (ocean video soundtrack) routed through BiquadFilterNode (low-pass)
- Filter cutoff maps linearly from 800Hz (veil 0% open) to 20000Hz (veil 100% open, effectively bypassed)
- Gain attenuation: -6dB at closed, 0dB at fully open

### Auto-Reset

When no hands are detected for 30 continuous seconds, the veil automatically slides back to its fully closed position. A reset button is also available for manual reset.

## Testing Decisions

### What makes a good test

Tests verify external behavior (inputs → outputs), not internal state. For the physics engine, this means: given these vertex positions and these forces, the output positions match expected values within a tolerance. For the renderer: shaders compile and link without errors, GPU resources are released on teardown without leaks. Tests should run without a browser (Node.js for physics, headless for renderer smoke tests).

### Modules to test

1. **PhysicsEngine** — Full unit test suite. Test cases: single stick constraint resolution, multiple iteration convergence, pinned vertex immobility, top-rail sliding restriction, restore force direction, stacking compression, gravity accumulation. Prior art: any Verlet cloth simulation test suite.

2. **Renderer (shader compilation)** — Smoke tests: each shader pair compiles + links successfully on WebGL context creation. Teardown test: after destroy(), all GPU objects are deleted (no memory leak).

3. **AudioEngine (node graph)** — Integration test: AudioContext → BiquadFilterNode → destination chain builds without error. Filter cutoff responds to parameter changes. Prior art: Web Audio API conformance tests.

### Modules NOT tested

- HandTracker (MediaPipe is an external black box; thresholds are subjective feel parameters)
- Particles (visual-only, validated by eye)
- UIManager (DOM interaction, validated by manual testing)
- ApiClient (trivial fetch wrapper)

## Out of Scope

- Multi-veil (multiple simultaneous curtains) — scope reduced to single full-screen veil
- Zoom control for hidden content — removed for simplicity
- Green-screen fabric visualization toggle — reserved for future update
- Backend content management system — API endpoints only reserved, frontend uses built-in defaults
- Touch gesture support (mobile touch is limited to mouse fallback on desktop)
- User-uploaded content in this iteration — only the built-in default ocean video is used
- Full 3D cloth rendering (the veil is a 2D mesh deformed in screen space, not a true 3D cloth)
- Safari/Firefox support — targeted at Chrome/Edge 110+, with Chromium-based mobile browsers

## Further Notes

- The reference implementation at `index.html` (from Loot AI work `c3emubelct5znyp5` by 希彼赫) serves as a starting point for the physics engine and MediaPipe integration. The Phantom Veil project is a ground-up rewrite with a WebGL shader pipeline replacing the Canvas 2D rendering.
- The "Predator cloak" visual metaphor and the "green screen" metaphor are both documented here — the former is implemented now, the latter reserved as a future visual toggle.
- The project name "Phantom Veil" refers to the veil's paradoxical nature: physically present and interactive, yet visually absent.
