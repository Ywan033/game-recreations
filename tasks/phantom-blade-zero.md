# 雨巷双刃 (Rainlane Blades)

Engineering id: `phantom-blade-zero` (paths and branch only). The page title
and all player-facing text use 雨巷双刃 / Rainlane Blades.

## Scene

An original rainy-night courtyard outside a tavern. The player enters from a
narrow lantern-lit lane into a walled yard of wet flagstones. Low-eaved
timber buildings with warm window light sit against cold rain and mist;
invented mechanical fixtures (steam pipes, chains, a slow-turning gear
tower silhouette beyond the wall) give the place its own character. Design
the yard layout yourself. Keep the centre clear so there is room to
sidestep, back off, and counterattack. Warm/cold contrast is the visual
anchor.

## Player

Third-person swordfighter with lock-on camera. Short light-attack combo
(3 hits), guard (hold), sidestep/dodge with brief invulnerability, and a
punish window: attacks landed while the boss is recovering deal bonus
damage and are signalled clearly.

## Boss

An original dual-blade fighter of your own design. Moves:

- Fast chain: 3 quick alternating slashes.
- Delayed strike: a long, readable wind-up with a deliberate pause before
  the hit, meant to catch early dodges.
- Gap closer: a lunge from range.

Each move has a distinct telegraph and a recovery the player can punish.
At 50% health the boss enters phase two with a visible transition: attack
timing changes (shorter gaps, mixed delays) and at least one recognisable
new follow-up is added to an existing move.

## Readability and camera

Weapon trails and wind-ups must stay readable through rain and mist. The
camera must not clip through walls or lose the fight near the arena edge.
The player and boss collide with the arena boundary and each other.

## Acceptance

- Opening, fight, victory screen, defeat screen, retry all work.
- Real-input offline test covers: movement, combo hit, guard reducing
  damage, dodge avoiding a hit, punish bonus, phase-two transition and
  changed boss behaviour, victory, defeat, retry.
- Near-wall camera and boundary collision are tested.
- No uncaught page errors.
