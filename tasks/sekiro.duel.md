# 苇月剑决 (Reedmoon Duel) — lock-on camera, character realism, steel audio pass

The owner will play this build next. This pass fixes readability of the
locked-on duel, makes both fighters more believable, and gives blade
contact the sound of real steel. Work on the existing code. Keep this
game's own characters (the Reedcutter and the Fen Warden), arena, moves,
UI and sounds: do not imitate the characters, arena, UI or audio of any
existing game. Keep the combat rules, attack windows and fight rhythm, the
controls (Space jump, Left Shift step, hold J / left mouse to charge, R
flask, guard, Glance, finisher, retry flow), the URL hash options, the
`window.__game` probe, and the single-file offline HTML. Stay with
Three.js WebGPURenderer plus the WebGL 2 fallback.

Evidence for this pass goes in `compare/duel/` (committed). Do not touch
other files under `compare/`.

Budget is tight (about 22 USD for this session, hard stop). Priorities, in
order: (A) lock-on camera and boss wind-up readability, (B) the main
character detail, (C) blade contact audio, then verification and evidence.
Compress secondary scenery work; do not start anything in the field,
reeds or ground unless A–C and verification are done. Save working,
buildable states as you go so a stop leaves a usable candidate.

## 0. Before evidence (first, before changing game code)

With a re-runnable script (extend the existing capture scripts), default
quality, fixed seed, 1280x720, real input, on the current code:

- `compare/duel/before-title.png`, `before-explore.png`,
  `before-combat.png` (locked on at 3–5 m, boss in a wind-up).
- `compare/duel/before-character-lock.png` (both fighters at normal lock
  distance) and `before-character-close.png` (close view of both).
- `compare/duel/before.webm`: clip with game audio (the existing in-page
  MediaRecorder hook), locked on at 3–5 m, including a camera position
  where the Reedcutter covers the Warden, and one boss move as a continuous
  wind-up → charge → strike.

After the pass the same script, seed and steps write `after-title.png`,
`after-explore.png`, `after-combat.png`, `after-character-lock.png`,
`after-character-close.png`, and `compare/duel/gameplay.webm` (same arena,
same boss move, same camera situations, game audio kept; it must also let
the owner hear a whiff, a normal guard, a Glance, and a direct hit). Keep
each clip under about 8 MB and verify it has a non-silent audio track.

## A. Lock-on camera and boss wind-up

Problems reported from play: at 3–5 m locked on, the Reedcutter covers the
Warden, the picture is too dark, and the charge / wind-up is hard to read.

- Rework the lock-on camera's lateral offset and re-centring so that while
  the player circles, both fighters' upper bodies and weapons stay in
  frame together as far as possible. Measure it: add a debug/probe value or
  a test helper that projects both fighters' chest and blade-tip points to
  the screen and reports overlap/occlusion, sample it while strafing a
  full circle at 3, 4 and 5 m, and report the fraction of samples where the
  Warden's upper body is covered, before and after.
- Close range and near the arena edge: no sudden jumps, no passing through
  fighters or reeds in a way that hides the target, no losing the target.
  Smooth all offset changes (no side flips without hysteresis).
- Keep the moonlit night, but separate the Warden's shoulders, hands and
  blade from the background with local rim light and material response
  (for example a rim that follows the camera/moon geometry, a slightly
  lifted exposure on characters, steel that catches the moon). The player
  must be able to tell, before the strike, that the Warden has raised the
  blade and from which side the charge comes.
- Prefer camera, light and pose changes. Make wind-up poses larger and
  clearer (blade raised clear of the hat and mantle silhouette, shoulders
  turned) without changing attack windows or timings in `src/sim.js`.

## B. Characters toward realism

- Believable proportions for both: head-to-body ratio, shoulders and neck,
  wrists, hands, and garment thickness. Remove oversized heads and hands,
  blocky armour or garment pieces, and the plastic look.
- Cloth, leather and steel must respond differently under the moonlight
  (roughness, sheen, tight highlight on steel; fine normal or weave detail
  where cheap).
- Keep the existing character designs and the skinned skeleton. Check the
  deformation in stance, run, turn, raised blade and guard. In the normal
  play camera check specifically: the hands stay on the hilt, the hilt does
  not pass through the hand during cuts, and the two fighters can be told
  apart by silhouette alone.
- The Warden currently reads as a hat and a cone of mantle from the lock
  camera: open the silhouette so arms, hands and blade are visible
  (shorter or parted mantle, arms outside it during wind-ups).

## C. Blade contact audio (synthesised, in `src/audio.js`)

Trigger each sound from the actual combat resolution in the simulation
(the event for that hit/guard/deflect), at the moment of blade contact:

- Normal guard: a short, lower, heavier steel impact.
- Precise deflect (Glance): a clearer metallic attack with a brief ring.
- Sliding contact: a short scrape where the move has one (for example
  the Bind-Step pin, or a guarded heavy).
- Whiff: an air swish only; direct hit on a body: its own impact sound.
  Both must be clearly distinguishable from steel on steel.

Blade contact must stay audible over the ambience (duck it as now). In
rapid exchanges check summed level and clipping (limiter or voice
management as needed). Measure and report: time offset between the sim
event and the sound onset, peak/RMS per sound type, spectral centroid or
similar showing guard vs. Glance vs. hit vs. whiff differ, and clipped
sample count over a chained exchange. Nobody listens in this session; say
so. The owner judges the sound by ear.

## D. Verification and report

- `npm ci`, `npm run build`, `npm run install:browsers`,
  `npm run test:offline` must exit 0. The full real-input offline suite
  (single file in an empty directory, `file://`, offline) must still pass
  with the existing checks for jump, step, charge, flask, guard, Glance,
  phases, victory, defeat and retry; update lock-on framing assertions
  only where the camera intentionally changed, and add a check that both
  fighters' upper bodies are on screen while strafing locked on.
- Run the suite on WebGL 2 and, as before, on hardware WebGPU
  (`node tests/offline.mjs --gpu`); report what actually ran on each.
- `tests/online-check.cjs` must keep passing on software rendering.
- Look at your own after-images and clip frames and fix what looks wrong.
- Add a section "Duel readability, characters and steel audio pass" to
  DELIVERY.md: what changed, occlusion measurements before/after, audio
  measurements, test results per render path, evidence paths, unverified
  items and remaining problems. Update README.md if it describes the look.
