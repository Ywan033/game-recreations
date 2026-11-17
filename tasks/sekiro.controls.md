# 苇月剑决 (Reedmoon Duel) — controls, motion, and ambience-audio pass

The owner has played the current online version. This pass adds a unified
control scheme with jump, charged heavy attack and a healing flask, improves
the characters, camera and frame-rate independence, and replaces the rain /
ambience audio. Work on the existing code. Keep the arena theme (moonlit
reed fen), the boss, the core combat rules (guard, Glance deflect, chained
deflects, Bind-Step counter, Balance, Moonwheel finisher, two phases), the
URL hash options, the `window.__game` probe, and the single-file offline
HTML. Stay with Three.js WebGPURenderer plus the WebGL 2 fallback. First
read the current input bindings, the sim state machine, the renderer and
quality-tier code, and `src/audio.js` before changing them.

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

- Step (dodge) and the Bind-Step counter: Left Shift only, bound by
  `KeyboardEvent.code === "ShiftLeft"`.
- Jump: Space only. Remove the old Space step binding. Keep other bindings
  that do not conflict.
- Attack keys (keyboard `J` and left mouse must behave identically): a
  short press is a light cut / combo step; holding enters a charge;
  releasing after the charge threshold performs a heavy cut. The finisher
  prompt behaviour (F / E, left mouse while the prompt is open) stays.
- `R`: drink from the healing flask during the fight. Retry on the result
  screen must not be able to consume or be confused with a drink: keep
  Enter and the button for retry, and keep `R` as retry only if it is
  inactive during the fight.
- Update the in-game HUD, the start-screen key list, and README.md.

Jump: take-off, airborne, and landing states in the simulation; moderate
air steering; the reed boundary and ground still hold while airborne;
holding Space does not re-jump (edge-triggered); normal input returns after
landing. Decide and document how jumping interacts with boss attacks, with
no free invulnerability. Check the camera when jumping while locked on, at
the boundary, and mid-fight.

Charged heavy: clear wind-up, a visible and audible "fully charged" cue,
release, hit, and recovery phases; decide its health/Balance damage so it
is a real option without trivialising the deflect game. One input must
never produce both a light and a heavy cut, and short-press combos must
stay as responsive as now. Being hit interrupts the charge. Clear all
charge/jump/drink state on pause, window blur, death, and retry.

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

All new mechanics belong in the fixed-step simulation (`src/sim.js`); add
code-level tests for them.

## 2. Characters, camera, frame-rate independence

- Replace the rigid segmented bodies of the player and the boss with
  skinned meshes on a skeleton (lofted cross-sections weighted to bones,
  planted feet with two-bone leg IK, closed hands around the hilt). The
  sibling game solved this in
  `notes/rainlane-fighter.reference.js` (a copy placed in this game directory
  for reference only; delete the `notes/` folder when you are done); you may
  port that approach into this game's own directory (same repository, same
  MIT licence), adapted to this game's costumes, posture and two-hand sword
  grip. The Reedcutter and the Warden keep their own designs.
- Lock-on camera: adjust distance, height and framing so that in a normal
  exchange the boss's feet, weapon and wind-up are clearly readable and the
  fighters are not small in frame. Check close range, the boundary, a jump,
  and reeds between camera and fighters.
- Keep the cold white moonlight and the depth of the reed field; raise the
  separation of the fighters from the background (rim light, value
  contrast, slightly brighter exposure on the characters).
- Frame-rate independence: the simulation must advance in real time on
  slow renderers. Run as many fixed 60 Hz steps per frame as the elapsed
  time needs (with a sane catch-up cap for long stalls such as tab
  switches), so that jump, drink, charge, the deflect window and boss
  attacks keep their real-time durations at low quality tiers and at
  10–20 fps. Measure fight timings (for example one boss string from
  wind-up to end, in wall-clock seconds) at full frame rate and on the
  software renderer and report both.

## 3. Ambience and rain audio (replace the current bed)

The owner hears the current rain as one constant hiss. Replace it with an
open-field night ambience that has space, material, and variation, and
stays distinct from the sibling game's enclosed wet courtyard:

- Check what weather the field actually shows and how the current audio
  bed is built. Sound and picture must agree: use the field's existing rain
  strength; if the scene shows no rain while the audio plays rain, settle
  on a sparse light drizzle and add matching, very subtle visuals, or make
  the bed mostly wind with only occasional drops. Keep the quiet of a
  moonlit duel.
- Bottom layer: a sparse, distant rain curtain at low level with slow
  drift. On top: wind moving through the reeds (gusts that follow the same
  wind that sways the reeds), and individual drops on grass blades and on
  mud with varied level, spacing and timbre, at a controlled density, with
  no audible loop.
- Mix priority: footsteps, blade hits, the Glance bell, boss warning cues
  (the violet-flare wail), and the flask feedback stay clearly audible;
  duck or band-limit the ambience during combat cues.
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
  Left Shift steps and Space jumps and lands, and neither triggers the
  other; Bind-Step with W + Left Shift; short press light cut, repeated
  light cuts (combo), hold to charge, release for heavy, interruption by a
  hit, state cleanup; after taking damage `R` heals, exactly one charge per
  drink, heal never above max; full-health press, empty flask,
  interruption by a hit, charges restored on retry; the existing movement,
  guard, deflect, chained deflects, stance break, finisher, phase change,
  victory, defeat, retry, lock-on camera checks; audio start, pause, mute
  and resume; no uncaught page errors; no network requests.
- Report separately which checks ran on WebGPU and which on WebGL 2, and
  which were start-up/smoke checks vs. full fight regressions.
- Update `tests/online-check.cjs` (same exported `async function(page)`
  contract, run against the published URL in a plain headless Chromium on
  software rendering, existing timeouts) so that after starting the fight
  it also confirms with real key presses that ShiftLeft steps, Space
  jumps, and `R` is handled as the flask key.
- Record `compare/controls/gameplay.webm`: one normal gameplay clip with
  sound showing running, a jump, a charged heavy, a drink, a boss attack,
  and the ambience. Playwright video has no audio; record inside the page
  with MediaRecorder over `canvas.captureStream()` plus a
  `MediaStreamAudioDestinationNode` tapped from the game's master output
  (a recording hook enabled only by a hash option is fine), driven by real
  input. Keep it under about 8 MB. Also export `compare/controls/
  ambience.wav` (15–30 s of the ambience while moving around the field).
  Verify the clip really contains a non-silent audio track.
- Look at your own after-screenshots and frames from the clip and fix what
  looks wrong.
- Add a section "Controls, motion and audio pass" to DELIVERY.md: the full
  final key list, flask/jump/charge numbers, actual test results, render
  path coverage, performance and fight-timing measurements before/after,
  asset sources, evidence paths (screenshots, clip, audio sample), measured
  audio numbers vs. listening (not listened to by a person), and remaining
  problems. Update README.md.
