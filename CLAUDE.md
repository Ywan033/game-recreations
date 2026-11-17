# Shared delivery requirements

These rules apply to every game in this repository. Each game also has its
own brief in tasks/<id>.md and its own games/<id>/CLAUDE.md.

## Scope and originality

Each game is an original, independently designed third-person 3D boss-fight
prototype: one arena, one boss, one fight that runs from the opening to a
win or loss screen and can be retried. Design the arena layout, characters,
boss, move set presentation, UI, and audio yourself. Do not copy the names,
characters, maps, UI, or signature presentation of any existing game. The
directory ids are engineering identifiers only; player-facing text uses the
game's own title from its brief.

## Engineering

Work only inside games/<id>. Use Three.js WebGPURenderer with a WebGL 2
fallback, Vite, a committed npm lockfile, and Playwright. Build the playable
fight first (controls, readable attacks, victory, defeat, retry), then polish
scene, animation, and audio.

Provide npm scripts named `build`, `install:browsers`, and `test:offline`.
Use package scripts or Node for filesystem work so they run on Windows.

## Assets and licensing

Prefer procedural geometry, textures, animation, and synthesized audio made
in code. Any third-party asset must be explicitly licensed for
redistribution; record its source and license in the game's README.md and
keep required notices, including for content embedded in the single HTML
file. Project code is MIT licensed (see LICENSE).

## Delivery

Deliver dist/play.html as one standalone HTML file with all runtime code,
styles, and assets embedded. It must work when double-clicked (file://)
with no network.

Copy only play.html into an empty directory and test it via file:// in a
fresh, offline browser context. Using real keyboard and mouse input, verify
rendering, movement, combat, the game-specific mechanics, the phase
transition, victory, defeat, and retry, and fail on uncaught page errors.
Report code-level tests and any debug state injection separately from
real-input results.

Record build instructions, controls, actual test results, known issues, and
anything left unverified in games/<id>/DELIVERY.md. Update the game's
README.md with the actual controls and how to build and play.

Do not commit, push, or publish from a generation session; the launcher
handles milestones after verification.
