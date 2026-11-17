# 雨巷双刃 (Rainlane Blades) — delivery record

Date of verification: 2026-11-17 · Windows 11, Node v26.13.1, npm 11.20.0
Dependencies (from `package-lock.json`): three 0.187.0, vite 8.3.8, vite-plugin-singlefile,
@playwright/test (Chromium 159.0.8154.6, Playwright build v1255), pngjs.

## Deliverable

`dist/play.html` — one standalone HTML file (≈ 937 kB, 263 kB gzipped) with all JavaScript and CSS
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

All four were run in this order for this record and exited 0. `npm run test:sim` (optional,
code-level) also exits 0.

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

Last run: **7 passed, 0 failed, 0 skipped (4.7 min)**. No page errors, no console errors, no network
requests in any test.

| # | Test | Real input used | Observed result |
| --- | --- | --- | --- |
| 1 | Opening: start screen renders, lists controls, starts by click | mouse click on the start button | Title 雨巷双刃 and controls list shown; screenshot non-blank (618 colour buckets, luminance σ 31.4); frames advance; click starts the fight, HUD appears; lane view non-blank (1567 buckets, σ 39.5). The engineering id does not appear in page text. Backend in the default headless shell: WebGL 2 (software). |
| 2 | WebGL 2 fallback when forced (`#gl`) | `Enter`, `W` | backend = `webgl2`; walked into the yard; yard view non-blank (1758 buckets, σ 38.6). |
| 3 | Movement, mouse look, boundary collision, body collision, near-wall camera | `W A S D`, mouse move, `Q`/`E`, `F` | `W` advances down the lane; lane walls stop `A`/`D` at x = ±1.15; `S` walks back. Mouse movement without pointer lock turns the camera (> 0.2 rad); `Q`/`E` turn it too. Entering the yard closes the gate. With lock off, each of the four keys pressed the player flat against a wall (distance to wall 0 for all four) while the boss attacked; at every sample the player and boss stayed inside the yard bounds, never overlapped, and the camera stayed inside the walls and below the eaves. With lock on and the player backed against a wall: boss on screen in 44/44 samples, camera swung sideways up to 2.06 rad and kept its distance (cam t > 0.3) in 41/44 samples. |
| 4 | Combo, guard, dodge, punish, gap closer | `W`, `K` (hold), `Space`, `J`, `S`/`A`/`D` | Guarded delayed strike: 24 raw → 10 taken. Same strike unguarded: 24 → 24. Sidestep with `Space` just before the hit: `dodged` event, no damage at that moment. Three-hit combo landed during boss recovery: 14 / 16 / 27 damage against base 8 / 9 / 15 (= ×1.8 punish bonus), `comboMax` = 3, the "破绽 · PUNISH" HUD cue is on during recovery. A hit on a ready (idle) boss was turned aside: 3 damage vs base 8. After running to the far side of the yard (gap 14.2 m) the boss used the lunge (0.7 s wind-up, 1.25 s recovery) and closed to 3.7 m. |
| 5 | Phase-two transition, changed behaviour, victory, retry by key | `W`, `K`, `J`, `R` | Boss reached ≤ 50 % health → `phase` state seen, `phaseStart` / `burst` / `phaseTwo` events, boss health unchanged during the transition (invulnerable), HUD shows 第二式 with the second pip lit. Phase-one moves seen: chain (wind 0.5 s, rec 1.15 s), delay (0.85 / 1.4). Phase-two: chain wind 0.36 s, rec 0.95 s plus the new held spin follow-up (`followUp: spin`); no phase-one move had a follow-up. Fight finished → VICTORY screen (boss 0 HP, player alive). `R` retried: fight 2, both health bars full, phase one, gate open; walked in and re-engaged. |
| 6 | Defeat, retry by mouse, mouse buttons, pause | no input (to lose), mouse click, left/right buttons, `P` | With no input the boss killed the player → DEFEAT screen (player 0 HP). Clicking the retry button reset the fight. Left click swung the sword; holding the right button raised guard and releasing dropped it. `P` froze the simulation clock and resumed it. |
| 7 | WebGPU backend renders and plays | `Enter`, `W`, `K`, `J` | Launched the full Chromium build with WebGPU flags: backend = `webgpu` on this machine's hardware adapter (AMD), ≈ 60 fps; walked in, traded blows (a landed hit and a guarded/received hit), yard view non-blank (3014 buckets, σ 50.1), no page errors. This test skips itself if no hardware WebGPU adapter is available. |

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
- Near walls the camera swings sideways (or, when locked on in a tight corner, round to the far
  side) to keep its distance. With lock off the movement keys keep their previous heading while the
  view swings, which can feel briefly off-axis; in the tightest corners between a prop and a wall
  the camera can still pull in above the player for a moment (3 of 44 samples in test 3).
- Hit flashes and telegraph glints are additive sprites; at point-blank camera range they can
  briefly wash out the boss.
- The camera can pass through hanging lanterns and chains (they are not camera colliders).
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
