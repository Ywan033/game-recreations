# 雨巷双刃 (Rainlane Blades) — realism visual pass

Player feedback after hands-on play: the game looks too cartoonish. Do one
visual upgrade pass toward a grounded, realistic third-person action look:
believable body proportions, weight in the motion, distinct materials, and
motivated lighting. Keep the arena theme (rainy night tavern courtyard), the
combat rules, the controls, the URL hash options, the `window.__game` probe,
`tests/online-check.cjs`, and the single-file offline HTML. Stay with
Three.js WebGPURenderer plus the WebGL 2 fallback.

Work in this order; if time or budget runs short, finish the earlier items
properly rather than touching everything thinly.

## 0. Before screenshots (do this first, before changing any game code)

Write a reusable capture script (for example `tests/compare-shots.mjs`) that
builds nothing itself but opens the built `dist/play.html` with real input
at 1280x720, default quality, a fixed seed, and saves three normal gameplay
camera shots:

- `compare/before-title.png` — opening / start screen.
- `compare/before-explore.png` — exploration view: player walking in the
  yard before or between exchanges, normal follow camera.
- `compare/before-combat.png` — combat: both fighters fully in frame, weapons
  visible, boss in an attack wind-up.

Build the current code and run it now so the `before-*` files show the
delivered version. Prefer a hardware-accelerated browser (the full Chromium
build with WebGPU flags, as the existing WebGPU test does) so the shots look
like what a player sees; fall back to WebGL 2 if needed and say which was
used. After the upgrade, run the same script with the same seed and camera
steps to write `compare/after-title.png`, `after-explore.png`,
`after-combat.png`. The `compare/` folder must be committed (not ignored).

## 1. Characters and motion (highest priority)

- Replace the visible player and boss models. No bodies assembled from
  obvious spheres, cylinders, or capsules. Build proper humanoid meshes with
  realistic proportions (about 7.5 heads tall): head and neck, shoulders,
  ribcage tapering to the waist, pelvis, upper and lower arms, hands, thighs,
  calves, feet. Collision shapes can stay as they are.
- Layer the clothing and armour: inner robe, outer coat or cuirass, belt or
  sash with hanging ends, bracers, boots, and for the boss the hat and the
  two-blade rig. Weapons must sit in the hands with a believable grip
  (fingers around the hilt, wrist aligned with the blade), not float.
- Rework idle, locomotion, attack swings, hit reactions, guard, and sidestep
  for weight: hips lead, shoulders counter-rotate, knees bend into steps,
  feet plant instead of sliding, swings have anticipation, a committed
  follow-through, and a recovery. Keep the existing timings of the combat
  simulation; change the presentation, not the rules.
- You may use a compact third-party model or animation only if it is
  explicitly licensed for redistribution and you can include it without any
  network access; keep its licence notice. Otherwise make the models in code.
- Check the body silhouettes at the normal combat camera distance, not only
  in close-ups.

## 2. Materials and lighting

- Wet flagstones, timber, and metal must read as different materials:
  distinct roughness, reflectivity, and normal or height detail. Wet stone
  shows lantern reflections and darker joints; timber is matte with grain;
  metal has tight highlights.
- Warm lanterns light their surroundings locally; the lane mouth and the
  shadows are held by a cooler, dim ambient. Avoid flat, evenly lit
  surfaces and saturated toy-like colours.
- Rain streaks and splashes: smaller, dimmer, and varied by distance and
  scale (near streaks longer and fainter-edged, far rain reading as haze).
  They must not hide wind-ups or weapon trails.

## 3. Camera fixes (known issues from the first delivery)

- Near walls and in corners the camera must not suddenly jump up above the
  player; ease it in and keep a usable view.
- The camera must not pass through hanging lanterns and chains: treat them
  as camera obstacles or fade them when they are too close to the lens.

## 4. Verification and report

- Rebuild the self-contained `dist/play.html`.
- Confirm that both the WebGPU path and the WebGL 2 path actually render the
  new look (non-blank, characters visible), and say exactly which paths were
  verified and how.
- The full existing real-input offline suite must still pass: start,
  movement, attack, guard, dodge, phase change, victory, defeat, retry, wall
  camera, boundary. Update assertions only where the visuals changed, never
  to hide a regression. `npm run build`, `npm run install:browsers`, and
  `npm run test:offline` must exit 0 after `npm ci`.
- Look at your own after-screenshots, including a fast turn, a wall-hugging
  position, and the locked-on view, and fix what looks wrong.
- Add a "Realism pass" section to DELIVERY.md: what changed, the paths of
  the before/after comparison images, which render paths were verified, the
  `play.html` size before and after, and the problems that remain. Update
  README.md where it describes the look or the files.
