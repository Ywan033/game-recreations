# 雨巷双刃 (Rainlane Blades) — controls, motion, and rain-audio pass

The owner has played the current online version. This pass adds a unified
control scheme with jump, charged heavy attack and a healing flask, improves
the look and motion further, and replaces the rain audio. Work on the
existing code (skinned fighters, sim, tests). Keep the arena theme, the boss,
the core combat rules, the URL hash options, the `window.__game` probe, and
the single-file offline HTML. Stay with Three.js WebGPURenderer plus the
WebGL 2 fallback. First read the current input bindings, the action/sim
state machine, the renderer set-up and `src/audio.js` before changing them.

Evidence for this pass goes in `compare/controls/` (committed, not ignored).
Do not touch the existing files directly under `compare/`.

Work in the order below. Sections 1 and 3 and the verification in section 4
are mandatory; if budget runs short, cut depth in section 2, not the others.

## 0. Before evidence (first, before changing game code)

Build the current code and capture, with a script you can re-run later
(extend `tests/compare-shots.mjs` or add one), at 1280x720, default quality,
fixed seed, real input: `compare/controls/before-title.png`,
`before-explore.png`, `before-combat.png` (both fighters fully in frame,
weapons visible, boss in a wind-up). After the pass, the same script and
steps write `after-title.png`, `after-explore.png`, `after-combat.png`.

## 1. Controls (final scheme, same in both games of this repository)

- Dodge: Left Shift only, bound by `KeyboardEvent.code === "ShiftLeft"`.
- Jump: Space only. Remove the old Space dodge binding. Keep other bindings
  that do not conflict (for example `L` may stay as an alternative dodge).
- Attack keys (keyboard and mouse must behave identically): a short press
  is a light attack / combo step; holding enters a charge; releasing after
  the charge threshold performs a heavy attack.
- `R`: drink from the healing flask during the fight. Retry on the result
  screen must not be able to consume or be confused with a drink: keep
  Enter and the button for retry, and keep `R` as retry only if it is
  inactive during the fight.
- Update the in-game HUD, the start-screen key list, and README.md.

Jump: take-off, airborne, and landing states in the simulation; moderate
air steering; collision with ground, walls, props and the arena boundary
still holds while airborne; holding Space does not re-jump (edge-triggered);
normal input returns after landing. Decide and document how jumping
interacts with boss attacks (for example low sweeps can be jumped, others
still hit), with no free invulnerability. Check the camera when jumping
while locked on, next to a wall, and mid-fight.

Charged heavy: clear wind-up, a visible and audible "fully charged" cue,
release, hit, and recovery phases. One input must never produce both a
light and a heavy attack, and short-press combos must stay as responsive as
now (decide light-on-release vs. light-on-press-with-upgrade and make sure
the combo test timings still hold). Being hit interrupts the charge. Clear
all charge/jump/drink state on pause, window blur, death, and retry.

Flask: limited charges; count, heal amount, wind-up, and recovery tuned to
the current boss difficulty and defined in one config block. Heal is capped
at max health. Full health or an empty flask gives visible and audible
"cannot" feedback and consumes nothing. One valid action consumes exactly
one charge and heals exactly once; holding `R` does not repeat. Define one
moment at which the charge is consumed and the heal applied (the same
moment), so an interrupting hit before it costs nothing and heals nothing,
and after it both have happened. Retry restores the initial charges. HUD
shows the remaining charges. The drink has a recognisable animation and
sound.

All new mechanics belong in the fixed-step simulation (`src/sim.js`) so
they do not depend on render frame rate; add code-level tests for them.

## 2. Look and motion

- Keep the rainy tavern yard and the existing skinned characters. First
  fix the short stride, the floaty flight phase of the run, and remaining
  foot sliding. Then give jump, landing, charged swing, and drinking proper
  weight shift and hand motion (the flask hand comes to the mouth, the
  weapon hand stays believable).
- Push wet bluestone, old timber and metal further apart in roughness and
  reflection. Keep warm lanterns against cool ambient. Keep rain streaks,
  splashes and highlights dim enough that fighters and blades stay clear.
- Test with real input: turning while hugging a wall, passing through the
  lane mouth, jumping, and lock-on. The camera must not pop upward or pass
  through lanterns, chains, or walls. Fix what you find.

## 3. Rain audio and mix (replace the current rain)

The owner hears the current rain as one constant hiss. Replace it with a
rain scene that has space, material, and variation:

- Bottom layer: distant rain curtain, low level, slowly drifting in level
  and tone. On top: individual near drops with varied level, spacing and
  timbre, at a controlled density, with no audible loop.
- Distinguish open rain on wet stone and puddles, drips from the eaves,
  and rain on the wooden eaves/roof. As the player moves between the lane
  mouth, under the eaves, and the open yard, position, level, or filtering
  of these layers changes smoothly (spatialise or crossfade by position).
- Mix priority: footsteps, blade hits, guard/parry, boss warning cues, and
  the flask feedback stay clearly audible; duck or band-limit the ambience
  during combat cues so it never masks them.
- Check through normal play: level changes, pause, mute, restart, and the
  audio unlock on the first user gesture.
- Audio may be synthesised in code (preferred) or use recordings that are
  explicitly licensed for redistribution, embedded in the single HTML, with
  source and licence recorded in README.md.

Measurement: render or capture the mix and report measured numbers (peak,
RMS/loudness of ambience alone vs. with combat cues, clipping count, level
when muted/paused). Keep these separate from listening impressions. Nobody
listens in this session: say so explicitly in DELIVERY.md.

## 4. Verification, evidence, report

- Rebuild `dist/play.html`. `npm run build`, `npm run install:browsers`,
  `npm run test:offline` must exit 0 after `npm ci`.
- Extend the real-input offline suite (single file copied to an empty
  directory, `file://`, offline context, real keyboard and mouse) to cover:
  Left Shift dodges and Space jumps and lands, and neither triggers the
  other; short press light attack, repeated light attacks (combo), hold to
  charge, release for heavy, interruption by a hit, state cleanup; after
  taking damage `R` heals, exactly one charge per drink, heal never above
  max; full-health press, empty flask, interruption by a hit, charges
  restored on retry; the existing movement, guard, phase change, victory,
  defeat, retry, wall camera, boundary checks; audio start, pause, mute and
  resume; no uncaught page errors; no network requests.
- Report separately which checks ran on WebGPU and which on WebGL 2, and
  which were start-up/smoke checks vs. full fight regressions.
- Update `tests/online-check.cjs` (same exported `async function(page)`
  contract, run against the published URL in a plain headless Chromium) so
  that after starting the fight it also confirms with real key presses
  that ShiftLeft dodges, Space jumps, and `R` is handled as the flask key.
- Record `compare/controls/gameplay.webm`: one normal gameplay clip with
  sound showing running, a jump, a charged heavy, a drink, a boss attack,
  and the ambience. Playwright video has no audio; record inside the page
  with MediaRecorder over `canvas.captureStream()` plus a
  `MediaStreamAudioDestinationNode` tapped from the game's master output
  (a recording hook enabled only by a hash option is fine), driven by real
  input. Keep it under about 8 MB. Also export `compare/controls/
  ambience.wav` (15–30 s of the rain bed while walking between zones).
  Verify the clip really contains a non-silent audio track.
- Look at your own after-screenshots and frames from the clip and fix what
  looks wrong.
- Add a section "Controls, motion and audio pass" to DELIVERY.md: the full
  final key list, flask/jump/charge numbers, actual test results, render
  path coverage, performance before/after, asset sources, evidence paths
  (screenshots, clip, audio sample), measured audio numbers vs. listening
  (not listened to by a person), and remaining problems. Update README.md.
