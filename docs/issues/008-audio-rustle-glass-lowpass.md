# 008 — Audio: rustle + glass low-pass

**Type**: AFK
**Blocked by**: #004 (Top-rail physics)

## What to build

Implement the Web Audio graph with two sound layers:

1. **Cloth rustle**: A short fabric-rustle sample triggered on grab and played continuously during drag. Volume scales with hand velocity — faster pull = louder rustle. Fades out quickly on release.

2. **Glass low-pass filter**: Hidden content audio (ocean video soundtrack) is routed through a `BiquadFilterNode` configured as a low-pass filter. The cutoff frequency maps linearly to the percentage of veil opened:
   - 0% open → 800Hz cutoff (heavily muffled, "behind glass")
   - 100% open → 20000Hz cutoff (effectively bypassed, full clarity)
   - Gain: -6dB at closed, 0dB at fully open, linear interpolation

## Acceptance criteria

- [ ] Web Audio context created on user gesture (compliant with autoplay policy)
- [ ] Cloth rustle sample loaded and playable
- [ ] Rustle triggers on grab, stops on release with short fade-out
- [ ] Rustle volume proportional to hand velocity during drag
- [ ] Low-pass filter chain: source → BiquadFilterNode(lowpass) → GainNode → destination
- [ ] Filter cutoff maps linearly to veil-open percentage (0% → 800Hz, 100% → 20000Hz)
- [ ] Gain maps linearly to veil-open percentage (0% → -6dB, 100% → 0dB)
- [ ] Tests pass: audio graph nodes connected without error, filter type is 'lowpass', cutoff responds to parameter change

## User stories

- #18 — Subtle fabric rustle when pulling
- #19 — Ocean audio muffled through glass, clearer as veil opens
