# VEIL — Escape from Kurogane (prototype)

Top-down squad stealth, real-time pausable, mouse controlled. three.js (orthographic camera over the XZ plane), plain ES modules, no build step, no node.

## Run
    python serve.py
then open http://localhost:8080/ (any static server works; ES modules need http://, not file://).

## Read first
- `design.md` — game design + technical foundation (the source of truth)
- `src/world/map-data.js` — the whole level as data (walls, bushes, doors, transitions, enemies with routes, event route-swaps)
- `src/sim/sim.js` — the simulation; `state` is plain data (F5/F9 quicksave is a `structuredClone`)
- `src/render/` — three.js view of the state; `fog.js` is the GPU fog of war

## Dev / design flags
- `F2` in game: reveal mode (no fog, all enemies and cones). For studying the map.
- URL: `?auto=3` skips squad select with the first 3 roster characters, `&sim=20` fast-forwards 20 s,
  `&reveal`, `&layer=1` (-1 sewers, 0 ground, 1 roofs), `&cx=80&cz=55&ppm=10` camera.
- The browser console prints `VEIL ready: ...` after the first frame and `JSERROR ...` on uncaught errors.
- Headless checks used during development: Node can import everything under `src/sim`, `src/world`, `src/core`
  (no three.js there), so the simulation can be scripted and asserted without a browser.

## Folder notes
- `assets/` — concept art added by another agent; not referenced by the game.
- `design.md.pre-shadow-gambit.bak` — the design doc before another agent merged the Shadow Gambit research into it.
