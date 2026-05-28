# 010 — UI: Liquid Glass start screen + controls

**Type**: AFK
**Blocked by**: #001 (WebGL render loop)

## What to build

Apple Liquid Glass style UI layer over the WebGL canvas:

- **Start screen**: Full-screen overlay with frosted glass effect (backdrop-filter blur), a centered title ("Phantom Veil"), a subtitle hint, and a single "Begin" button that triggers camera permission + starts the experience.
- **Controls**: Positioned at bottom-right, Apple-style rounded glass-morphism buttons:
  - Reset curtain (visible after first reveal)
  - Flip camera (front/rear toggle)
  - Hide UI toggle (eye icon, top-right corner)
- All UI elements use CSS backdrop-filter for the liquid glass aesthetic.
- UI fades when hidden, reappears on tap/hover near edges.

## Acceptance criteria

- [ ] Start screen renders with frosted glass background
- [ ] "Begin" button requests camera permission and fades out the overlay
- [ ] If camera permission denied, error message shown with retry option
- [ ] Reset button appears after veil has been opened, resets cloth to closed state
- [ ] Flip camera button stops current stream and restarts with opposite facingMode
- [ ] Hide UI button toggles all controls; UI hidden state shows only a subtle eye icon
- [ ] All buttons have hover/active states matching Liquid Glass aesthetic
- [ ] UI does not block WebGL canvas interaction when visible
- [ ] Works on both desktop (mouse hover) and mobile (touch)

## User stories

- #25 — Beautiful Liquid Glass start screen
- #26 — Flip between front and rear cameras
- #27 — Reset veil with single tap
