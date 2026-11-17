# 雨巷双刃 (Rainlane Blades) — game rules

Player-facing title: 雨巷双刃 / Rainlane Blades. The directory id is an
engineering identifier and must not appear in the UI.

## Scene

- Original rainy-night tavern courtyard: narrow lantern-lit entry lane,
  walled yard of wet flagstones, low-eaved timber buildings with warm
  windows, cold rain and mist, invented mechanical fixtures (steam pipes,
  chains, a gear tower silhouette beyond the wall).
- Clear central fighting space; props stay at the edges.
- All geometry, textures, characters, animation, UI, and audio are made in
  code for this game.

## Gameplay

- Third-person, lock-on camera, desktop keyboard and mouse. Mouse look must
  work without pointer lock too, and every action needs a keyboard binding.
- Player: 3-hit light combo, hold guard, sidestep with brief
  invulnerability, bonus-damage punish window during boss recovery.
- Boss (original dual-blade fighter): fast 3-hit chain, delayed strike,
  lunging gap closer; each with a distinct telegraph and punishable
  recovery.
- Phase two at 50% boss health: visible transition, changed timing, and at
  least one new follow-up.
- Use a fixed simulation timestep with a clamped frame delta so behaviour
  is stable on slow or headless renderers.
- Show controls on the start screen. HUD: player health, boss health,
  phase indicator.

## Testing

- A read-only state probe (for example `window.__game`) may expose state to
  tests. A documented test option (for example a URL hash) may fix the
  random seed or scale health so a full fight fits in a test, but actions
  in the offline suite must come from real keyboard and mouse events.
- Anything verified by state injection or code-level tests is listed
  separately in DELIVERY.md.

## Acceptance

- Build produces a self-contained dist/play.html that runs from file://
  offline, on WebGPU or the WebGL 2 fallback.
- Offline real-input test passes: render, movement, combo, guard, dodge,
  punish, phase transition, victory, defeat, retry, near-wall camera,
  boundary collision, no uncaught page errors.
- README.md lists actual controls and build steps; DELIVERY.md records
  actual results, known issues, and unverified items.
