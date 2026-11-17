# 苇月剑决 (Reedmoon Duel) — delivery record

Date: 2026-11-17 · Deliverable: `dist/play.html` (single self-contained file, 896.90 kB, 252 kB gzipped)

> The sections below up to "Published page check" describe the first delivery. Where the realism
> pass changed something, the **Realism pass** section at the end is the current record (look,
> frame-delta clamp, quality scaling, test results, known issues).

## Build

```
npm ci
npm run build            # vite build + vite-plugin-singlefile → dist/play.html
npm run install:browsers # playwright install chromium
npm run test:offline     # real-input offline suite (node tests/offline.mjs)
```

All four commands exited 0 on this machine (Windows 11, Node 26.13.1, npm 11.20.0, three 0.187,
vite 8.3, playwright 1.65). Extra scripts: `npm run test:sim` (code-level), `npm run dev`.

## Controls (as implemented)

| Action | Input |
| --- | --- |
| Move | W A S D (camera-relative) |
| Cut (light attack, 3-hit combo) | Left mouse / J |
| Guard (hold) / Glance (deflect: press ≤ 0.22 s before impact) | Right mouse / K |
| Step (dodge) / Bind-Step (step forward into the violet-flare thrust) | Space (+ direction) |
| Moonwheel (finisher, when prompted) | F / E (left mouse also works while the prompt is open) |
| Fix Gaze (lock-on toggle, on by default) | Q / Tab / middle mouse |
| Free-camera look (no pointer lock used) | Mouse move / arrow keys / resting the cursor at a screen edge |
| Start · Retry · Mute | Enter or button · R / Enter or button · M |

## Design notes and one deliberate departure from the brief

- Mechanics follow the brief: light attack, hold guard, timed deflect, chained deflects, health and
  stance for both fighters, multi-hit string, heavy slash, unguardable thrust with a warning cue,
  forward-step counter, stance break → finisher → phase two → second finisher ends the fight.
  UI names are the game's own: Balance 重心 (stance), Glance 拨锋 (deflect), Bind-Step 踏锁 (step-in
  counter), Unbalanced 失衡 (stance break), Moonwheel 月轮 (finisher), Fix Gaze 凝视 (lock-on),
  First/Second Tide 一幕/二幕 (phases).
- Warning cue for the thrust: violet-magenta rings collapsing onto the blade tip, the blade itself
  glowing violet, a violet screen-edge vignette, and a two-note falling pipe wail over a rising hiss.
  No glyph is used.
- **Departure — look of the scene and fighters.** The brief asks for cold white moonlight over a
  field of silver reeds. A moonlit silver-grass duelling field with a lone swordsman is the
  recognisable setting of an existing game's duel, so I did not reproduce that look. The arena keeps
  every structural element the brief lists (central low-grass clearing sized for lunges, tall
  wind-driven reeds ringing it as the boundary, moon, thin mist, distant mountain silhouettes) but
  with its own identity: a green fen islet at dusk, a large low amber moon, teal sky with an ember
  horizon, dark water under the reeds, fireflies, and leaning poles with red cloth streamers marking
  the boundary. The fighters are likewise their own designs: a hooded reed-cutter with an orange
  scarf, and a tall warden in a wide thatch hat, thatch mantle and long pale beak mask with teal
  glow. If the cold-white/silver palette is specifically wanted, it is a small change in
  `src/world.js` (sky gradient, moon and light colours, reed colours) — but that is a call for the
  project owner, not something I should do silently.
- The finisher (Moonwheel) is an original move: the player hooks the blade, wheels in a full low
  turn around the boss's flank to its back and cuts upward; a pale crescent sweep, white flash,
  ground ring, gong and rising shimmer accompany it. The Bind-Step traps the lunging blade against
  the ground with the player's own blade (cyan/violet ground rings, rising cyan sparks, stomp and
  scrape sound). Glance has gold star-sparks, a small ring and a bell whose pitch rises with the chain.
- Phase two: health and Balance reset, faster approach, shorter gaps between moves, the boss
  retaliates after two blocked cuts instead of three, and three new moves (five-hit string with a
  rhythm break, feint slash into thrust, leaping heavy). Phase two always opens with the new
  five-hit string. Music adds a drum pulse and a faster tempo.
- Simulation runs at a fixed 60 Hz step; frame delta is clamped to 50 ms, so on slow renderers the
  game slows down rather than skipping simulation.

## Test results (actual)

### A. Real-input offline suite — `npm run test:offline` → PASSED, 52 checks, 0 page errors

Run 5 times in total during development: the first run found a real bug (step-in counter never
triggered at the lock-on camera's angle; fixed in `src/sim.js`), one later run failed on a test
flake (a single J key press swallowed while the player was staggered; the test now retries the
press). After those two fixes it passed 3 times consecutively.

How it runs: copies only `dist/play.html` into a fresh `os.tmpdir()` directory (asserts the
directory lists exactly that one file), opens it via `file://` in a fresh Playwright Chromium
context with `setOffline(true)` and every non-`file:` request aborted and recorded (none occurred).
Viewport 800×450, headless, backend reported by the page: **WebGL 2** (software/ANGLE, ~16 fps).
All actions are real keyboard and mouse events. `window.__game.snap` is only read (to observe
state and to time the presses); nothing is written into the page.

Hash options used: win run `#seed=11&q=low&hurt=0.3`, loss run `#seed=5&q=low&hurt=1.5`.
`hurt` scales damage taken by the player only; the boss's meters, the deflect window and the
counter window are unscaled. `q=low` reduces reed count/shadows for the software renderer.

Covered with real input:

- Opening screen shown, title text, controls listed, engineering id absent from UI text.
- Rendering: screenshot of the canvas region has varied pixels (title and fight); frames advance.
- Start by mouse click on Begin (win run) and by Enter (loss run).
- Movement with W, A, S, D.
- Lock-on camera: on by default; both fighters inside the view and camera facing the boss;
  stays on the boss while strafing; Q releases it; mouse movement turns the free camera without
  pointer lock; arrow keys turn it; Q re-engages and re-frames the boss.
- Attack: left mouse button swings and connects with the boss; J swings.
- Guard: holding right mouse blocks a hit and fills the player's Balance; holding K guards (loss run).
- Glance (deflect) on a timed right-mouse press; boss Balance rises.
- Chained Glances through a multi-hit string (longest chain 5 in the recorded runs).
- Bind-Step: W + Space into the violet-flare thrust (3 of 4 thrusts countered in the recorded run).
- Stance break, finisher prompt visible in the DOM, F performs the Moonwheel.
- Phase transition: phase indicator text changes, boss health/Balance reset, phase one used only
  phase-one moves, phase two opens with the new five-hit string and uses moves absent from phase one.
- Second stance break, second Moonwheel, victory screen.
- Retry from victory with R (clean state), defeat by standing still, defeat screen, retry by mouse
  click on Retry, controls work after retry. Space performs the Step.
- No uncaught page errors, no page crash, no network requests.

Screenshots from the last run are written to `test-results/` (git-ignored).

### B. Online check hook — `tests/online-check.cjs`

Run locally with `node tests/run-online-check.mjs` against `file://…/dist/play.html` at 1280×720,
full quality, headless software rendering: **passed in 18.3 s**. It clicks Begin with the mouse,
waits for the fight, checks frames advance and the canvas screenshot is not blank, moves with A,
and confirms a left-click registers a swing. Not run against a published https URL (publishing is
the launcher's job).

### C. Code-level test (no browser, synthetic inputs) — `npm run test:sim` → passed

`tests/sim.test.mjs` steps `src/sim.js` directly with scripted bots: an idle player loses; a player
who only holds guard is guard-broken and loses; a reactive bot wins on seeds 1–4 with 2 breaks,
2 finishers, chain ≥ 3 and ≥ 1 counter, and phase two opens with its new string; an attacking bot
deals health damage, gets blocked sometimes, and wins. This is not real-input evidence.

### D. Debug state injection

None. No test writes game state. The only test affordances are the documented URL-hash options
above and the read-only probe.

### E. Manual/dev checks (not part of the automated suite)

- `tests/shot.mjs` (dev helper) loaded the build in installed Google Chrome, headless with WebGPU
  enabled: the page reported backend **WebGPU**, ~56 fps at 1280×720 full quality, no console
  errors or warnings, and the idle fight ran through to the defeat screen. Screenshots of the title,
  fight and thrust cue were inspected by eye. With Playwright's bundled Chromium and hardware GL the
  WebGL 2 backend ran at 60 fps full quality.
- In Playwright's bundled Chromium, WebGPU device creation fails (missing `dxcompiler.dll`) and the
  renderer falls back to WebGL 2 automatically — this is the path the offline suite exercises.

## Known issues

- Headless software rendering is slow (~16 fps in low quality at 800×450, ~4 fps in full quality at
  1280×720); because of the clamped frame delta the game then runs in slow motion. The offline suite
  takes roughly 2–3 minutes for that reason.
- Free-camera mouse look uses cursor deltas rather than pointer lock, so the cursor can reach the
  screen edge; resting it at the left/right edge keeps turning, and the arrow keys also turn.
- When the fighters are very close the player model can partly cover the kneeling boss; the camera
  is offset to the side and raised to limit this, and ground rings mark both fighters.
- (Resolved in the realism pass: capsule figures, the stiff scarf, and the start-screen text
  overlapping the fighters.)
- At very low frame rates the blade trail is drawn as a few large segments.
- No pause function; the fight keeps running if the tab loses focus (held keys are released).
- Audio starts on the first click/keypress (browser autoplay policy).

## Not verified

- Audio output: sounds are synthesised with WebAudio and the code paths run without errors in the
  tests, but nothing was listened to or measured — headless runs have no audio check.
- The full real-input suite was not run on the WebGPU backend (only the smoke run in E).
- No human hands-on playthrough was done; feel, difficulty and balance are judged from bot and
  scripted-input runs only. The scripted player finishes the fight in roughly 35–60 s of game time.
- Other browsers (Firefox, Safari) and other operating systems were not tested.
- Literal double-click from a file manager was not performed; the equivalent `file://` load in a
  fresh offline browser context was.
- The published (https) page was not checked.
- Gamepad and touch input are not supported.

## Published page check (added by the launcher run, 2026-11-17)

This supersedes the "published (https) page was not checked" item above. The delivered
`play.html` was published unchanged to GitHub Pages:
https://ywan033.github.io/game-recreations/play/reedmoon-duel.html

`scripts/verify-online.cjs` with `tests/online-check.cjs` opened that URL in a fresh, logged-out
Chromium context (headless): HTTP 200, canvas visible, the fight was started and movement and an
attack were driven with real keyboard and mouse input, and there were no uncaught page errors.
Result: PASS. This is a short load-and-input check, not a full fight.

## Realism pass (2026-11-17)

One visual upgrade toward a grounded look, done in two sessions (the first was interrupted after
the character/lighting work; the second added the low-end performance work, re-verified everything
and re-captured the screenshots). Combat rules, simulation timings, controls, URL hash options,
the `window.__game` probe, `tests/online-check.cjs` and the single-file build are unchanged. No
test assertion was changed. No third-party model or animation was added; everything is still made
in code.

### What changed

Characters and motion (`src/figure.js`, rewritten):

- Both fighters are humanoid meshes about 7.5 heads tall (1.76 m at scale 1; the Warden is 1.15×):
  head, jaw and neck, shoulders, ribcage tapering to the waist, pelvis, upper and lower arms,
  hands, thighs, knees, calves, feet. Collision shapes are untouched.
- Layered clothing: pale under-robe showing at the neck, outer robe with two overlapping collar
  bands, sash with knot and hanging ends, leather bracers, leg wraps, shoes with soles, trousers.
  The Reedcutter has a short robe skirt, tied-back hair, a headband with loose tails and a scabbard;
  the Warden keeps its own silhouette with a wide woven hat, two-layer thatch mantle, back cloak,
  long split robe skirt and a pale beaked mask. The stiff segmented scarf is gone; skirts, cloak,
  sash ends and headband tails are hinged panels driven by a spring (trail behind motion, hang with
  gravity, pushed out by the legs).
- Grip and stance: the sword is posed first and both arms reach the hilt by two-bone IK (right hand
  under the guard, left at the pommel; one-hand poses where the move calls for it), with the hand
  aligned along the blade. Guard holds the blade across the body.
- Motion: pose targets for idle, run, guard, deflect, three cuts (wind-up / hit / follow-through),
  thrust, stagger, kneel, pinned, bind, step, finisher (hook, wheel, rising cut) and falls. Hips
  blend faster than the chest and the blade trails; shoulders counter-rotate against the stride;
  feet plant in world space and step when they fall behind, the pelvis drops until both planted feet
  are in reach (knees bend), and each footfall dips the body. The deflect snaps to its own pose for
  0.2 s and both fighters get spring recoil (the Warden's blade is thrown wide, alternating sides
  along a chain). Presentation only: the simulation code (`src/sim.js`) was not edited.

Lighting and field (`src/world.js`):

- One key light: a low pale moon. Sky sheen, the directional light, the shadow map (2048², was
  1024²) and a moon-side fresnel rim on every character material all read the same direction. The
  only other lights are a dim sky hemisphere and a faint bounce from the opposite side.
- Reeds: three stalk meshes (leafed reed with a one-sided plume, snapped stalk, grass tuft); height,
  density and sway amplitude follow noise fields, about 9 % of stalks are bent, snapped stalks stand
  along the inner edge and some lie flat on the rim; plumes pass a little moonlight.
- Ground: generated albedo, roughness and normal maps (trampled grass, dry and wet soil, muddy rim,
  heel scars) instead of a flat tint. Mist is thin sheets at two heights outside the clearing.
- Start screen: the title and controls are a column on the right; the two fighters and the moon
  stand clear on the left.
- Palette: the first delivery used an amber moon and teal dusk (see "Departure" above). This pass
  moved to pale moonlight over a dark fen for the realistic look that was asked for; the arena
  design (islet, water under the reeds, poles with cloth streamers) and both characters remain this
  game's own.

Fixes made in the second session after looking at the after-screenshots:

- Fighters were too dark against the ground at the combat camera: wider and stronger moon rim,
  exposure 1.3 → 1.5.
- At the reed boundary the free camera was pushed up into a top-down view with leaves across the
  lens, and a stalk next to the camera showed as a bright line across the explore shot. Reeds
  within 3–6 m of the camera now lie down (vertex shader), the camera may back up to 3.4 m into the
  reed belt, and it is lifted less.
- The last line of the start-screen text was clipped at 1280×720; spacing tightened.

### Low-end performance (brief item 4)

Cause: the new look draws about 15 000 leafed reed instances and 6 500 grass tufts (was 9 000 and
5 000 single blades), a 2048² shadow pass, 4× MSAA and heavier materials. On a software rasteriser
this fell to about 2 fps, and because the frame delta was clamped to 50 ms the 2.2 s intro took
about 20 s of wall time, so the published-page check timed out in `intro`.

Changes (`src/main.js`, `src/world.js`, `src/figure.js`):

- Automatic quality scaling. Frame times are measured continuously (windows of ≥ 8 frames /
  ≥ 0.6 s, the frames right after a change are skipped). Below 27 fps the game steps down one tier,
  below 14 fps two, below 6 fps three; it never steps back up. Tiers 0–4: reed instances
  15 000 / 9 000 / 5 200 / 3 800 / 3 000, grass 6 500 / 4 200 / 2 800 / 2 000 / 1 500, render scale
  full / 1 / 1 / 0.75 / 0.55, shadow-map pass on for tiers 0–1 and replaced by soft contact shadows
  under the fighters from tier 2, half the mist sheets from tier 3. Instances are placed in random
  order, so drawing fewer thins the field evenly.
- A software renderer (SwiftShader, llvmpipe, a WebGPU fallback adapter) is recognised at start-up:
  it gets no MSAA and starts at tier 2; the measured frame rate then decides the rest.
- Outside the fight (title, intro, result) the frame-delta clamp is 250 ms, so slow frames no longer
  stall the opening. During the fight it is still 50 ms (slow frames slow the duel instead of
  skipping simulation). Character springs are sub-stepped so long frames cannot destabilise them.
- The current tier is shown in the corner label (`WebGL 2 · Q4`) and in the probe
  (`snap.quality`). `#auto=0` turns the scaling off (used for the "before" numbers below).
- `tests/online-check.cjs` and its timeouts are unchanged.

Measured frame rates, 1280×720, default quality, this machine, headless
(`node tests/measure-fps.mjs`, fight started with a real Enter key press):

| Path | Before the fix | After |
| --- | --- | --- |
| Software WebGL 2 (bundled Chromium, SwiftShader — the launcher's kind of browser) | 2.3 fps, online check timed out in `intro` | 14–15 fps (tier 4), intro 2.1 s, online check passes in 6.4 s |
| Software WebGPU (Chrome, `--use-webgpu-adapter=swiftshader`) | 2.2 fps, intro 3.8 s (`#auto=0`: same build with scaling off, MSAA on) | 14 fps (tier 4), intro 2.2 s, online check passes in 4.8 s |
| Software WebGL 2 at tier 2 only (`#auto=0`) | — | 7 fps |
| Hardware WebGPU (Chrome) | — | 150–195 fps unthrottled, stays at tier 0 |
| Hardware WebGL 2 (bundled Chromium with GPU flags, `#gl=1`) | — | 60 fps, stays at tier 0 |

For reference, the first delivery (before the realism pass) recorded about 4 fps on software
WebGL 2 at full quality and an online check of 18.3 s.

### Comparison images

Same script, seed and input steps for both sets: `node tests/compare-shots.mjs before|after`
(`npm run shots:compare`), 1280×720, default quality, `#seed=3&hurt=0.05&mute=1`, real keyboard and
mouse input. The after set was captured in installed Google Chrome, headless, with WebGPU flags;
the page reported backend **WebGPU**. The before set was captured by the first session with the
same script and was not regenerated; which browser it used was not recorded.

- `compare/before-title.png` → `compare/after-title.png`
- `compare/before-explore.png` → `compare/after-explore.png`
- `compare/before-combat.png` → `compare/after-combat.png`
- Review shots looked at for this pass (`--extra`): `compare/review/after-boundary.png` (reed
  boundary), `after-turn.png` and `after-turn-settled.png` (fast turn), `after-locked.png` and
  `after-locked2.png` (locked-on view), `after-contact.png`, `after-cut.png`, and two close crops.
- `compare/lowtier-title.png`, `-explore.png`, `-combat.png`: the same steps on software WebGL 2
  (`--gl`), showing the tier-4 picture a GPU-less machine gets.
- `compare/review/gallery-*.png` are pose-gallery sheets from the first session (`#gallery=`
  dev option); they predate the second session's lighting changes and were not re-captured.

### Verification (real input unless stated)

The offline suite, the two online-check runs marked "final" and the after-screenshots were run on
the final build. The software-WebGPU smoke run and the frame-rate table were run on the build just
before the last change, which only tightened start-screen CSS spacing.

- `npm ci`, `npm run build`, `npm run install:browsers`, `npm run test:offline`: all exit 0.
- **WebGL 2 (software), full offline suite**: `npm run test:offline` → PASSED, 52 checks, 0 page
  errors, no network requests; ~18 fps at 800×450 with `q=low`. Run three times in this session
  (after the scaling change, after the camera/lighting fixes, on the final build); all passed.
  Covers start, movement, attack, guard, deflect, chained deflects (chain of 5), step-in counter
  (3 of 4 thrusts on the final run), stance break, phase change, second finisher and victory,
  defeat, retry, lock-on camera.
- **WebGL 2 (software), online check** (final): `node tests/run-online-check.mjs` → passed in 6.4 s.
- **WebGPU (hardware), smoke run** (final): `node tests/run-online-check.mjs --webgpu` (Chrome) → passed in
  3.8 s; page reported WebGPU, tier 0, shadows on. It clicks Begin, checks the scene is not blank,
  moves with A and attacks with the mouse. The after-screenshots were also taken on this path and
  show both characters.
- **WebGPU (software adapter), smoke run**: `node tests/run-online-check.mjs --swgpu` → passed in
  4.8 s, tier 4.
- **WebGL 2 (hardware)**: only the frame-rate run above (Enter to start, 60 fps, tier 0); no
  screenshot was inspected on this path.
- Code-level, not real input: `npm run test:sim` → passed (seeds 1–4).
- No state injection anywhere; `window.__game.snap` gained a read-only `quality` field.

### `play.html` size

876 kB (243 kB gzipped) before the realism pass → 896.90 kB (252.04 kB gzipped) after.

### Problems that remain

- On a software renderer the picture is 14–15 fps at 0.55 render scale with thin reeds and no
  shadow map: playable and correct, visibly coarse. Below 20 fps the duel still runs in slow motion
  (50 ms clamp).
- The full offline suite was not run on WebGPU, only the smoke runs above.
- The quality tier only steps down; a machine that was briefly busy at start-up stays at the lower
  tier until the page is reloaded.
- At the lock-on camera height the Warden reads mostly as hat and mantle from above, and both
  fighters are small in frame; the camera distance was left as delivered.
- Running uses a long, low stride that can look like a lunge in a still frame.
- Limbs are rigid segments with sphere joints and cloth is hinged panels: no skinning, no cloth
  simulation, no fingers, no facial detail. Panels seen edge-on can show as thin bright lines.
- Reeds near the camera lie down rather than fade, which is visible as a cleared patch when the
  camera backs into the reed belt. Moon shadows are long (the moon is low) and soft-edged only as
  far as a 2048² map allows.
- Not judged by a human player: feel and weight of the motion were assessed from screenshots only.
  Audio is unchanged and still unverified by ear.
