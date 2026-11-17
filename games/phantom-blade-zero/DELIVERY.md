# 雨巷双刃 (Rainlane Blades) — delivery record

Date of verification: 2026-11-17 · Windows 11, Node v26.13.1, npm 11.20.0
Dependencies (from `package-lock.json`): three 0.187.0, vite 8.3.8, vite-plugin-singlefile,
@playwright/test (Chromium 159.0.8154.6, Playwright build v1255), pngjs.

## Deliverable

`dist/play.html` — one standalone HTML file (≈ 972 kB, 277 kB gzipped after the realism pass; it
was ≈ 937 kB / 263 kB in the first delivery) with all JavaScript and CSS
inlined. No images, fonts, audio files or network requests; every texture, mesh, animation and sound
is generated in code at start-up. Open it by double-clicking (`file://`).

## Build

Run inside `games/phantom-blade-zero`:

```
npm ci
npm run build
npm run install:browsers
npm run test:offline
```

All four were run in this order for this record and exited 0, and again in the same order after
the realism pass (2026-11-17). `npm run test:sim` (optional, code-level) also exits 0.

## Controls (as implemented)

| Action | Keyboard | Mouse |
| --- | --- | --- |
| Move | `W A S D` / arrow keys | — |
| 3-hit light combo | `J` (press up to 3×) | left button |
| Guard (hold) | `K` | right button (hold) |
| Sidestep with i-frames | `Space` / `L` (+ direction; none = step back) | — |
| Camera | `Q` / `E` | move the mouse (pointer lock is optional) |
| Lock-on toggle | `F` / `Tab` | middle button |
| Pause · Mute | `P` · `M` | — |
| Start / Retry | `Enter` (retry also `R`) | click the on-screen button |

Documented URL-hash options (testing/debug): `seed=N`, `bhp=X`, `php=X` (health scales),
`q=low`, `gl` (force WebGL 2), `mute`. Read-only probe: `window.__game.snapshot()` and
`window.__game.events(sinceT)`.

## Real-input offline test results (`npm run test:offline`)

`tests/offline.spec.js` copies **only** `dist/play.html` into a fresh temp directory (asserted to
contain exactly that one file), opens it via `file://` in a new browser context with
`offline: true`, aborts and records any non-`file:` request, and fails on any uncaught page error or
`console.error`. Every action is a real Playwright keyboard or mouse event; the probe is only read.

Last run (after the realism pass, final build): **7 passed, 0 failed, 0 skipped (7.1 min)**. No page
errors, no console errors, no network requests in any test. No assertion in the suite was changed
for the realism pass. The run is slower than the first delivery's 4.7 min because the software
renderer used by tests 1–6 has more to draw. The figures in the table are from this run.

| # | Test | Real input used | Observed result |
| --- | --- | --- | --- |
| 1 | Opening: start screen renders, lists controls, starts by click | mouse click on the start button | Title 雨巷双刃 and controls list shown; screenshot non-blank (494 colour buckets, luminance σ 30.8); frames advance; click starts the fight, HUD appears; lane view non-blank (1080 buckets, σ 34.9). The engineering id does not appear in page text. Backend in the default headless shell: WebGL 2 (software). |
| 2 | WebGL 2 fallback when forced (`#gl`) | `Enter`, `W` | backend = `webgl2`; walked into the yard; yard view non-blank (1073 buckets, σ 34.5); the screenshot (`test-results/shots/03-webgl2-yard.png`) was looked at and shows both new character models, the wet-stone reflections and the lantern lighting. |
| 3 | Movement, mouse look, boundary collision, body collision, near-wall camera | `W A S D`, mouse move, `Q`/`E`, `F` | `W` advances down the lane; lane walls stop `A`/`D` at x = ±1.15; `S` walks back. Mouse movement without pointer lock turns the camera (> 0.2 rad); `Q`/`E` turn it too. Entering the yard closes the gate. With lock off, each of the four keys pressed the player flat against a wall (distance to wall 0 for all four) while the boss attacked; at every sample the player and boss stayed inside the yard bounds, never overlapped, and the camera stayed inside the walls and below the eaves. With lock on and the player backed against a wall: boss on screen in 25/26 samples, camera swung sideways up to 1.96 rad and kept its distance (cam t > 0.3) in 25/26 samples, closest pull-in 0.26 of the normal distance. (`cam.t` in the probe is now the share of the wanted distance the camera actually has after sliding along walls.) |
| 4 | Combo, guard, dodge, punish, gap closer | `W`, `K` (hold), `Space`, `J`, `S`/`A`/`D` | Guarded delayed strike: 24 raw → 10 taken. Same strike unguarded: 24 → 24. Sidestep with `Space` just before the hit: `dodged` event, no damage at that moment. Three-hit combo landed during boss recovery: 14 / 16 / 27 damage against base 8 / 9 / 15 (= ×1.8 punish bonus), `comboMax` = 3, the "破绽 · PUNISH" HUD cue is on during recovery. A hit on a ready (idle) boss was turned aside: 3 damage vs base 8. After running to the far side of the yard (gap 14.2 m) the boss used the lunge (0.7 s wind-up, 1.25 s recovery) and closed to 3.7 m. |
| 5 | Phase-two transition, changed behaviour, victory, retry by key | `W`, `K`, `J`, `R` | Boss reached ≤ 50 % health → `phase` state seen, `phaseStart` / `burst` / `phaseTwo` events, boss health unchanged during the transition (invulnerable), HUD shows 第二式 with the second pip lit. Phase-one moves seen: chain (wind 0.5 s, rec 1.15 s), delay (0.85 / 1.4). Phase-two: chain wind 0.36 s, rec 0.95 s plus the new held spin follow-up (`followUp: spin`); no phase-one move had a follow-up. Fight finished → VICTORY screen (boss 0 HP, player alive). `R` retried: fight 2, both health bars full, phase one, gate open; walked in and re-engaged. |
| 6 | Defeat, retry by mouse, mouse buttons, pause | no input (to lose), mouse click, left/right buttons, `P` | With no input the boss killed the player → DEFEAT screen (player 0 HP). Clicking the retry button reset the fight. Left click swung the sword; holding the right button raised guard and releasing dropped it. `P` froze the simulation clock and resumed it. |
| 7 | WebGPU backend renders and plays | `Enter`, `W`, `K`, `J` | Launched the full Chromium build with WebGPU flags: backend = `webgpu` on this machine's hardware adapter (AMD), ≈ 124 fps (uncapped headless); walked in, traded blows (a landed hit and a guarded/received hit), yard view non-blank (1704 buckets, σ 38.6), no page errors. This test skips itself if no hardware WebGPU adapter is available. |

Tests 3–6 run with `q=low` and scaled health (`php`, `bhp`) plus a fixed `seed` so a full fight
fits in a test; tests 1, 2 and 7 use default quality. Screenshots from the run are written to
`test-results/shots/`.

## Code-level tests and state injection (reported separately)

- **State injection: none.** No test writes game state; the suite only reads `window.__game` and
  uses the documented hash options (`seed`, `php`, `bhp`, `q`, `gl`) to seed and scale the fight.
- **Code-level (`npm run test:sim`, Node, no browser, scripted inputs — not real input): 5 passed.**
  - walking into the yard engages the boss and closes the gate;
  - player and boss stay inside the arena and apart over 40 s of pushing in six directions;
  - standing still loses; `retry` restores health and phase one;
  - a scripted bot wins at full default health on seeds 1, 7, 11, 23 (56–64 s, 34–35 punish hits,
    5–8 phase-two follow-ups, finishing on 41–60 of 120 HP);
  - punish damage equals round(base × 1.8); every phase-two move has a shorter wind-up and recovery
    than its phase-one version; follow-ups only appear in phase two.
  The phase-two **reverse cut after the lunge** and the **second delayed strike with a different
  pause** are exercised only here (and by reading the code), not in the real-input suite, which
  observed the spin follow-up.
- Developer helpers `tools/shoot.mjs` and `tools/gpucheck.mjs` (screenshots, WebGPU adapter check)
  were used for visual review during development; they are not part of the checks.

## Renderer notes

- The game asks for a WebGPU adapter first. A hardware adapter → WebGPU backend; no adapter, a
  software/fallback adapter, or a failed device → three.js WebGL 2 backend. `#gl` forces WebGL 2.
- Playwright's default headless shell on this machine has no usable WebGPU device (and renders
  WebGL 2 in software at roughly 10–12 fps at default quality), so tests 1–6 exercise WebGL 2.
  WebGPU was exercised by test 7 in the full Chromium build.
- Simulation runs at a fixed 1/60 s step; the frame delta is clamped to 0.1 s and at most 8 steps
  run per frame, so slow renderers slow the game down rather than destabilise it.

## Known issues

- Balance was tuned only with scripted bots; no human playtest was possible in this session. The
  fight may be easier or harder than intended (guarding everything is survivable; reckless swings at
  a ready boss are punished).
- Weapon trails are sampled once per rendered frame, so at very low frame rates (software
  rendering) wide swings such as the phase-two spin look faceted.
- Near walls the camera swings sideways (or, in a dead-end corner, round to the far side) and
  slides along the wall. With lock off the movement keys keep their previous heading while the view
  swings, which can feel briefly off-axis. See "Realism pass → Problems that remain" for the
  camera cases that are still weak.
- `q=low` drops shadows and half the lantern lights, so the yard looks noticeably darker.
- Chinese text uses system fonts (KaiTi/Songti fallbacks); glyph style varies by OS.
- No gamepad or touch support (desktop keyboard and mouse only, per the brief).

## Not verified

- **Audio output.** All sound is synthesized with WebAudio; the tests confirm only that it starts
  and runs without errors. Mix levels, cue distinctness and the music were never listened to.
- Browsers other than Playwright's Chromium 159 (no Firefox or Safari run); WebGPU on GPUs other
  than this machine's AMD adapter.
- Pointer-lock mouse look (the suite verifies mouse look *without* pointer lock; the lock request
  itself is optional and untested), and manual double-click launch outside the automated
  `file://` run.
- Bindings not pressed in the real-input suite: arrow keys, `L` (dodge), `Tab` and middle button
  (lock toggle), `M` (mute), `Enter` as retry. They share handlers with the tested keys.
- Lightning flashes, footstep effects and the result-screen orbit camera were checked only by
  absence of errors and a few screenshots, not asserted.
- Long sessions (many consecutive retries) and window resizing during play.

## Realism pass (2026-11-17)

One visual upgrade pass after the feedback that the game looked too cartoonish. Combat rules,
timings, controls, URL hash options, the `window.__game` probe, `tests/online-check.cjs`, the
simulation (`src/sim.js`, untouched) and the single-file build are unchanged. No third-party
model, animation or texture was added; everything is still generated in code.

### What changed

**Characters and motion (`src/fighter.js`, rewritten)**

- Both fighters are now skinned humanoid meshes on a 17-bone skeleton instead of boxes, spheres
  and capsules. The body parts are lofted from cross-section rings and weighted to the bones:
  head and neck, shoulders, ribcage tapering to the waist, pelvis, upper and lower arms, closed
  hands, thighs, calves, feet. The player stands 1.78 m with a 0.235 m head (about 7.5 heads);
  the boss uses the same skeleton at 1.14× (it was 1.24×), about 2.0 m. Collision shapes are as before.
- Layered clothing. Player: dark inner robe sleeves and trousers, grey-blue outer coat with a
  skirt to the knee, crossed collar and standing inner collar, wool scarf, waist sash with a knot
  and two hanging ends, strapped leather bracers, cuffed boots, hair with a top knot, a painted
  face, scabbard on the hip. Boss: dark robe, long oxblood coat, banded cuirass with brass rim,
  crossed harness straps, three-plate pauldrons, hip tassets, belt and buckle with hanging sash
  ends, brass vambraces and greaves, gloves, wrapped head with an iron mask and slit, wide iron
  rain hat with brass rim, back pressure pack with two vent stacks, twin crossed scabbards.
- Weapons sit in closed fists: four fingers and a thumb wrap the grip, the blade leaves the fist
  on the knuckle line. The player's sword and the boss's curved sabres are proper tapered blades
  with guards, wrapped grips and pommels.
- Legs are no longer keyframed. Each foot is planted at a world position and stays there; when
  the body moves far enough it lifts, swings along an arc and lands ahead of the body. Thighs,
  shins and feet are solved with two-bone IK, the knee pointing between where the body and the
  foot face, and the pelvis drops as far as needed for both planted feet to reach. Feet therefore
  do not slide in walks, runs, strafes, lunges or knock-backs. The sidestep and the boss's dash
  are short hops.
- Weight: every pose has a stance and a pelvis shift; hips move first and faster than the spine,
  the arms follow last; the pelvis turns toward the leading foot while the shoulders and arms
  counter-swing; the body leans into its velocity. Player swings are anticipation → committed cut
  → follow-through (blade and shoulders keep travelling) → recovery, inside the same simulation
  windows as before. Hit reactions: the player recoils and gathers back, the boss flinches from
  each hit. Death uses forward kinematics so the body can lie down.
- Footstep sounds and spray are now tied to the moment a foot actually lands.

**Materials and lighting (`src/world.js`, `src/tex.js` new, `src/main.js`)**

- Wet flagstones: colour, roughness and normal maps drawn from one stone layout — dark recessed
  joints, each slab with its own tilt and wear, glossy slabs (roughness about 0.24–0.47), level
  puddles. Timber and plaster are matte (roughness 0.84–0.96) with grain / trowel normal maps.
  Iron, copper and brass are fully metallic with smudged roughness and tight highlights. Roof
  tiles have a ridge normal map and a wet sheen.
- The empty yard is captured once at start-up into a small cube map (128 px, 64 px at `q=low`)
  used as the scene environment, so the wet stone and the metal reflect the actual lanterns and
  windows. Lantern paper and windows are emissive above white so they tone-map like light sources.
- Lighting: hemisphere light cut from 0.75 to 0.2 and moonlight from 1.25 to 0.5, both cool; the
  warm lantern point lights now carry the scene locally. The painted floor glows were reduced to
  30 %. Colours were desaturated (windows, lanterns, copper, both costumes). Characters have a
  soft contact shadow instead of a hard black disc.
- Presentation effects toned down so they sit in the lighting: weapon trails are a thin arc from
  the outer part of the blade, floor telegraphs, blade glints, guard glow, hit flashes, sparks
  and the phase-two shock ring are smaller and dimmer. They are all still present.
- Rain (`src/fx.js`): camera-facing streak quads in three depth layers instead of one-pixel
  lines — near streaks long, thin and faint with soft edges, mid streaks shorter, the far layer
  fine enough to read as haze. Streaks fade out right at the lens and pick up warm light when
  they fall past a lantern. Splash rings are small (a few centimetres, growing to at most about
  25 cm far away), dim, varied in size and brightness, and densest near the camera.

**Camera (`src/main.js`)**

- The old camera marched in 28 steps, snapped its distance in a single frame and added up to
  1.3 m of height as it closed in — that was the jump above the player. Now the camera slides
  along walls by continuous projection, the sideways swing is chosen from a continuous score
  with hysteresis and smoothed in two stages, the pull-in for props is eased, and the small rise
  when close (at most 0.85 m, quadratic) is eased with the same value.
- Hanging lanterns, chains and the portcullis fade out as the lens approaches them (they start
  to fade at 2.2 m and are gone at 0.8 m), and the camera keeps a wider margin from the walls
  that carry fixtures (west chains, east pipework and gantry chains, north eave lanterns).
- After the gate drops the camera glides into the yard instead of snapping in.

### Before / after images

`tests/compare-shots.mjs` (also `npm run shots:before` / `npm run shots:after`) builds nothing;
it opens the built `dist/play.html` from `file://` at 1280×720, default quality, `seed=7`
(`#seed=7&php=5&mute`) and drives it with real keyboard input. Both sets were taken with the
**full Chromium build with WebGPU flags; the game reported the `webgpu` backend** on this
machine's hardware adapter both times.

| | Before (first delivery, commit `fe335fc`) | After (this pass) |
| --- | --- | --- |
| Start screen | `compare/before-title.png` | `compare/after-title.png` |
| Exploration, walking into the yard | `compare/before-explore.png` | `compare/after-explore.png` |
| Combat, boss holding the delayed-strike wind-up | `compare/before-combat.png` | `compare/after-combat.png` |

The combat shot waits for the boss's delayed strike, steps back with `S` during the wind-up and
swings the lock-on camera with `Q` until the two fighters are apart on screen. Because the script
polls in real time, the two runs do not land on the identical frame.

### Render paths verified

- **WebGPU**: (a) offline-suite test 7 — full Chromium build, `backend = webgpu`, walked in and
  traded blows, non-blank, no page errors; (b) the `compare/after-*.png` shots and about 25
  review shots were taken on WebGPU and looked at one by one (characters, materials, lighting).
- **WebGL 2**: offline-suite tests 1–6 run on the WebGL 2 backend in Playwright's headless shell
  (software rendering, about 12 fps at default quality), test 2 with `#gl` forced. Its screenshot
  `test-results/shots/03-webgl2-yard.png` was looked at: both new fighters, the reflections and
  the lantern lighting are there and match the WebGPU look. The skinned meshes, the environment
  capture and the fading materials produced no page or console errors on either backend.
- Not verified: WebGL 2 on a hardware GPU (only the software path was run), any browser other
  than Playwright's Chromium, WebGPU on other GPUs.

### Review shots (real input, not asserted)

`node tests/compare-shots.mjs after review seq` additionally saves shots to `test-results/review/`
(not committed): a front, back and side close-up of the player, both fighters in the combat
frame, the three player swings, boss chain wind-up and hit, a fast mouse turn, a wall-hugging
position with the free camera, a corner, the locked-on view with the player's back to a wall,
and four consecutive frames of a run. Things found this way and fixed: at running speed both feet
left the ground together (a hop) — the stepper now forces them to alternate; weapon trails were
opaque slabs; puddles mirrored a black sky and looked like holes; the camera collapsed onto the
player in a corner and sat among the pipes and chains; the scarf tail and hair ribbon were flat
rectangles (removed); the player's shoulders were too broad; the coat skirt let the thigh through.

### `play.html` size

| | Bytes reported by the build | gzip |
| --- | --- | --- |
| Before | 936.80 kB | 263.37 kB |
| After | 972.05 kB | 276.58 kB |

### Problems that remain

- Animation was judged from still frames and short frame sequences only; nobody has watched it
  in motion in this session. Timing feel, foot placement during fast direction changes and the
  blend into the death pose (inverse to forward kinematics) may need tuning.
- The run has a visible flight phase and short strides; the boss's 3.2 m/s approach reads as a
  jog rather than a walk.
- Clothing is skinned, not simulated. In the deepest lunges the long coat bunches around the
  thighs and the skirt can still clip a leg. Sash ends are rigid links that sway.
- Close up, the models are simple: no finger or facial animation, the player's off hand is a
  closed fist, the face is a painted texture, shoulders crease when the arms go overhead.
- Only the moon casts shadow-mapped shadows; lantern light does not, so characters rely on the
  soft contact shadow under warm light.
- Reflections come from one static capture taken at the yard centre: fighters, rain and steam
  are not reflected, the parallax is approximate, and the lane reuses the yard's capture.
- Rain is a volume around the camera and is not blocked by roofs, so it also falls under eaves.
- Floor telegraphs, the punish ring, blade glints and damage numbers are still game cues rather
  than physical effects; they were dimmed, not removed, to keep wind-ups readable.
- Camera: in the pocket between the boiler and the east wall the camera has little room, comes
  close and the player model is hidden while it is within 0.85 m. At the resting lock-on angle
  the boss can still be partly hidden behind the player at very short range. A fast mouse turn
  near a prop leaves the prop filling much of the view until the swing catches up.
- Software WebGL 2 runs at about 12 fps at default quality (as before); `q=low` is darker.
- The boiler's fire door is a flat emissive plane; the gear tower is still a silhouette.

## Published page check (added by the launcher run, 2026-11-17)

Note: this check was run on the first delivery's build, before the realism pass. It has not been
repeated for the new build in this session.

The delivered `play.html` was published unchanged to GitHub Pages:
https://ywan033.github.io/game-recreations/play/rainlane-blades.html

`scripts/verify-online.cjs` with `tests/online-check.cjs` opened that URL in a fresh, logged-out
Chromium context (headless, WebGL 2 backend): HTTP 200, canvas visible, a real mouse click on the
start button began the fight, `W` moved the player 0.54 m, mouse movement turned the camera, the
left button started an attack, and there were no uncaught page errors. Result: PASS. This is a
short load-and-input check, not a full fight.
