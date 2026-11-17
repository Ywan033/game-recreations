# Shared delivery requirements

Work inside games/<id>. Use Three.js WebGPURenderer with WebGL 2 fallback,
Vite, a committed npm lockfile, and Playwright. Build a third-person fight
with readable attacks, controls, victory, defeat, and retry.

Deliver dist/play.html as one standalone HTML file with all runtime code
and assets embedded. Use original or appropriately licensed assets.
Copy only play.html into an empty directory and test it via file:// in a
fresh, offline browser context. Verify movement, combat, victory, defeat,
retry, and the game-specific mechanics using browser input. Record the
build instructions, controls, test results, and known issues in DELIVERY.md.
