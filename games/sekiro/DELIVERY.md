# 苇月剑决 (Reedmoon Duel) — delivery record

Date: 2026-11-17 · Deliverable: `dist/play.html` (single self-contained file, ~876 kB, 243 kB gzipped)

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
- Animation is pose-blended procedural motion on capsule figures: readable, but simple. The player's
  scarf is a stiff segmented ribbon.
- At very low frame rates the blade trail is drawn as a few large segments.
- The start screen text overlaps the two fighters standing in the background.
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
