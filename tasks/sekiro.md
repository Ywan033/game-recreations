# 苇月剑决 (Reedmoon Duel)

Engineering id: `sekiro` (paths and branch only). The page title and all
player-facing text use 苇月剑决 / Reedmoon Duel.

## Scene

An original moonlit field of silver reeds. Cold white moonlight, reeds
moving in the wind, thin drifting mist, distant mountain silhouettes, and
two swordfighters facing each other. Design the field yourself: a central
clearing of low grass gives room for thrusts and step-in counters, tall
reeds ring the outside and mark the boundary.

## Player

Third-person swordfighter with lock-on camera. Light attack, guard (hold),
and deflect (guard pressed just before a hit lands). Chained deflects
against a multi-hit string must work. The player has health and a stance
meter; guarding fills the player's stance, deflecting fills the boss's.

## Boss

An original swordfighter of your own design with health and a stance
meter. Moves include a multi-hit string that rewards chained deflects, a
heavy slash, and a dangerous thrust that cannot be guarded.

- Dangerous thrust: announced by an original warning cue of your own
  design (a distinct coloured flash and sound, not a glyph borrowed from
  another game). Stepping forward into it with the dodge input at the
  right moment performs a step-in counter that pins the blade and deals
  heavy stance damage.
- Stance break: when the boss's stance meter fills, the boss staggers and
  a finisher prompt opens.
- First stance break: the player's finisher is an original close-range
  move that starts phase two. The boss recovers with a changed rhythm or
  new strings.
- Second stance break: the finisher ends the fight.

Deflect, step-in counter, and finisher each need distinct visual and audio
feedback.

## Readability and camera

Characters, weapons, and the danger cue must stay clear against tall reeds
and mist. The lock-on camera must keep both fighters readable.

## Acceptance

- Opening, fight, victory screen, defeat screen, retry all work.
- Real-input offline test covers: movement, attack, guard, a deflect,
  chained deflects, the step-in counter, stance break, the phase
  transition and changed boss behaviour, the second finisher and victory,
  defeat, retry.
- Lock-on camera is tested.
- No uncaught page errors.
