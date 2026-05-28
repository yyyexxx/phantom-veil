# 012 — Default ocean content + API client stub

**Type**: AFK
**Blocked by**: #006 (Glass shader + stencil)

## What to build

Wire up the default hidden content and the API client stub that will enable remote content switching in the future:

1. **Default ocean video**: A 720p H.264 MP4 ocean/underwater scene, bundled as the built-in hidden content. Loops, muted (audio routed through the glass low-pass in #008). Rendered into the WebGL texture used by the glass shader.

2. **API client stub**: A thin fetch wrapper that attempts `GET /api/content/default` on load. On success, uses the returned URL as the hidden content source. On failure (or endpoint unreachable), falls back to the built-in ocean video silently. The endpoint, response shape, and auth header are configured via constants for easy swap when the backend is built.

## Acceptance criteria

- [ ] Ocean video (720p H.264 MP4) plays on loop, muted, as hidden content layer
- [ ] Video fills the content area with object-fit: cover behavior
- [ ] API client calls `/api/content/default` on startup
- [ ] Successful response: hidden content source set to the returned URL
- [ ] Failed/unreachable: silently falls back to built-in ocean video
- [ ] No console errors in fallback path
- [ ] API base URL, endpoint path, and auth header configurable via a single constants object
- [ ] Video decode does not impact frame rate on target devices (hardware decode via H.264)

## User stories

- #28 — API supports remote content changes in the future
- #29 — Runs smoothly on both desktop and phone
