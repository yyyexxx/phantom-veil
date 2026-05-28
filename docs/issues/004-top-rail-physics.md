# 004 — Top-rail physics: slide / stack / peek / restore

**Type**: AFK
**Blocked by**: #002 (PhysicsEngine)

## What to build

Extend the PhysicsEngine to implement top-rail curtain behavior. Top-row vertices can slide horizontally along the rail but cannot move vertically. Horizontal pulling force causes the entire cloth to slide and stack/compress on one side. Outward/upward pulling creates local deformation (peek) without top-rail movement.

Released peek → cloth restores to original position. Released full-open → cloth stays where it is. Stacked fabric on the open side displays natural vertical compression folds.

## Acceptance criteria

- [ ] Top-row vertices constrained to horizontal movement only (rail sliding)
- [ ] Horizontal pull ≥ threshold: top vertices slide, fabric stacks
- [ ] Outward/upward pull: local deformation only, rail vertices stay
- [ ] Released after peek (< threshold displacement): cloth restores to closed position
- [ ] Released after full-open (≥ threshold): cloth stays at current position
- [ ] Stacked side compresses vertically, producing visible fold density
- [ ] Reverse drag from stacked side: cloth slides back (user can close it)
- [ ] Tests pass: top vertex vertical immobility, stacking compression, restore force direction per interaction type

## User stories

- #8 — Pull sideways to slide open like a curtain
- #10 — Peek under by pulling corner outward
- #11 — Peeked corner falls back when released
- #12 — Fully opened stays open when released
- #13 — Grab stacked fabric and pull back to close
