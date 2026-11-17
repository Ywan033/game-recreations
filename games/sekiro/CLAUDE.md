# 苇月剑决 (Reedmoon Duel) — game rules

Player-facing title: 苇月剑决 / Reedmoon Duel. The directory id is an
engineering identifier and must not appear in the UI.

## Scene

- Original moonlit reed field: cold white moonlight, wind-driven reeds,
  thin mist, distant mountain silhouettes.
- Central clearing of low grass sized for thrusts and step-in counters;
  tall reeds ring the outside and mark the boundary.
- All geometry, textures, characters, animation, UI, and audio are made in
  code for this game.

## Gameplay

- Third-person, lock-on camera, desktop keyboard and mouse. Mouse look must
  work without pointer lock too, and every action needs a keyboard binding.
- Player: light attack, hold guard, deflect on a well-timed guard press,
  chained deflects against multi-hit strings, health and stance meters.
- Boss (original swordfighter): health and stance meters; multi-hit
  string, heavy slash, unguardable dangerous thrust.
- Dangerous thrust: original warning cue (coloured flash plus sound, no
  glyph borrowed from other games); dodge forward into it at the right
  time for a step-in counter with heavy stance damage.
- Stance break opens a finisher prompt. The first finisher is an original
  close-range move that starts phase two with a changed rhythm or new
  strings; the second finisher ends the fight.
- Deflect, step-in counter, and finisher have distinct visual and audio
  feedback. Use original names for all mechanics in the UI.
- Use a fixed simulation timestep with a clamped frame delta so behaviour
  is stable on slow or headless renderers.
- Show controls on the start screen. HUD: health and stance for both
  fighters, phase indicator.

## Testing

- A read-only state probe (for example `window.__game`) may expose state to
  tests. A documented test option (for example a URL hash) may fix the
  random seed or scale meters so a full fight fits in a test, but actions
  in the offline suite must come from real keyboard and mouse events.
- Anything verified by state injection or code-level tests is listed
  separately in DELIVERY.md.

## Online check hook

Also provide `tests/online-check.cjs` (CommonJS) exporting
`async function (page)`. It receives a Playwright page that has already
navigated to the built game (an https or file URL) with the canvas visible.
Using only real keyboard and mouse input it must start the fight, confirm
the scene rendered, confirm the player moves under keyboard input and that
an attack registers under mouse input, and throw an Error on any failure.
Keep it short (well under a minute) and independent of the offline suite's
temporary directories. The launcher uses it to verify the published page.

## Acceptance

- Build produces a self-contained dist/play.html that runs from file://
  offline, on WebGPU or the WebGL 2 fallback.
- Offline real-input test passes: render, movement, attack, guard,
  deflect, chained deflects, step-in counter, stance break, phase
  transition, second finisher and victory, defeat, retry, lock-on camera,
  no uncaught page errors.
- README.md lists actual controls and build steps; DELIVERY.md records
  actual results, known issues, and unverified items.
