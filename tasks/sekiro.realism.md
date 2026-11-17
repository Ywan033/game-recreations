# 苇月剑决 (Reedmoon Duel) — realism visual pass

Player feedback after hands-on play: the game looks too cartoonish. Do one
visual upgrade pass toward a grounded, realistic third-person action look:
believable body proportions, weight in the motion, distinct materials, and
motivated lighting. Keep the arena theme (moonlit reed field), the combat
rules, the controls, the URL hash options, the `window.__game` probe,
`tests/online-check.cjs`, and the single-file offline HTML. Stay with
Three.js WebGPURenderer plus the WebGL 2 fallback.

Work in this order; if time or budget runs short, finish the earlier items
properly rather than touching everything thinly.

## 0. Before screenshots (do this first, before changing any game code)

Write a reusable capture script (for example `tests/compare-shots.mjs`) that
opens the built `dist/play.html` with real input at 1280x720, default
quality, a fixed seed, and saves three normal gameplay camera shots:

- `compare/before-title.png` — opening / start screen.
- `compare/before-explore.png` — exploration view: player moving in the
  clearing with the normal follow camera, reeds and moon in view.
- `compare/before-combat.png` — combat: both fighters fully in frame, weapons
  visible, boss in an attack wind-up.

Build the current code and run it now so the `before-*` files show the
delivered version. Prefer a hardware-accelerated browser (full Chromium with
WebGPU flags) so the shots look like what a player sees; fall back to
WebGL 2 if needed and say which was used. After the upgrade, run the same
script with the same seed and camera steps to write
`compare/after-title.png`, `after-explore.png`, `after-combat.png`. The
`compare/` folder must be committed (check `.gitignore`).

## 1. Characters and motion (highest priority)

- The fighters are currently capsule figures. Replace the visible player
  and boss models with proper humanoid meshes with realistic proportions
  (about 7.5 heads tall): head and neck, shoulders, ribcage tapering to the
  waist, pelvis, upper and lower arms, hands, thighs, calves, feet.
  Collision shapes can stay as they are.
- Layer the swordfighters' clothing: under-robe, outer garment with
  overlapping collar, wide trousers or skirted lower garment that moves,
  belt or sash, bracers, leg wraps, footwear; the boss keeps a distinct
  silhouette (hat, cloak or mantle). Replace the stiff segmented scarf with
  something that moves believably or remove it.
- Sword grip and stance: both hands or a clear one-hand grip around the
  hilt, wrist in line with the blade, a real guard stance with the blade
  held across the body.
- Rework idle, locomotion, cuts, hit reactions, guard, the deflect, the
  step, the step-in counter, and the finisher for weight: hips lead,
  shoulders counter-rotate, knees bend, feet plant instead of sliding. The
  deflect in particular needs a sharp, readable parry motion with a recoil
  on both fighters. Keep the simulation timings; change the presentation,
  not the rules.
- You may use a compact third-party model or animation only if it is
  explicitly licensed for redistribution and you can include it without any
  network access; keep its licence notice. Otherwise make the models in code.
- Check the body silhouettes at the normal combat camera distance.

## 2. Lighting and field

- Moonlight comes from one clear direction and gives the player and the
  boss a distinct rim light; shadows fall consistently. Keep the night
  readable without flat ambient fill or saturated toy-like colours.
- Reeds: vary height, density, and sway amplitude across the field, with
  some bent and broken stalks and plumes that catch the moonlight. The
  central clearing, the fighters' feet, and the blades must stay clearly
  visible.
- Ground: believable soil and trampled grass with roughness variation
  instead of a flat tint. Mist stays thin and layered.
- Start screen: move the title and text so they do not overlap the two
  fighters standing in the background.

## 3. Verification and report

- Rebuild the self-contained `dist/play.html`.
- Confirm that both the WebGPU path and the WebGL 2 path actually render the
  new look (non-blank, characters visible), and say exactly which paths were
  verified and how. Run the real-input suite on WebGL 2 as before and at
  least a real-input smoke run on WebGPU.
- The full existing real-input offline suite must still pass: start,
  movement, attack, guard, deflect, chained deflects, step-in counter,
  stance break, phase change, second finisher and victory, defeat, retry,
  lock-on camera. Update assertions only where the visuals changed, never
  to hide a regression. `npm run build`, `npm run install:browsers`, and
  `npm run test:offline` must exit 0 after `npm ci`.
- Look at your own after-screenshots, including a fast turn, a position at
  the reed boundary, and the locked-on view, and fix what looks wrong.
- Add a "Realism pass" section to DELIVERY.md: what changed, the paths of
  the before/after comparison images, which render paths were verified, the
  `play.html` size before and after, and the problems that remain. Update
  README.md where it describes the look or the files.
