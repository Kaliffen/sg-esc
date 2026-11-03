# VEIL — Escape from Kurogane (prototype)

Top-down squad stealth, real-time pausable, mouse controlled. three.js (orthographic camera over the XZ plane), plain ES modules, no build step, no node.

Live: https://kaliffen.github.io/sg-esc/ (GitHub Pages, deployed from `main`).

## Two entry points
- `index.html` — landing page with concept art and a **single-file build** of the game (everything inlined; owned by the HTML/landing work).
- `play.html` — the **modular build**: loads `src/` directly. This is the engine source of truth for the simulation, map and renderer. Open it locally or at https://kaliffen.github.io/sg-esc/play.html.

## Run locally
    python serve.py          (or double-click serve.cmd)
then open http://localhost:8080/play.html (any static server works; ES modules need http://, not file://).

## Read first
- `design.md` — game design + technical foundation (the source of truth)
- `src/world/map-data.js` — the whole level as data (walls, bushes, doors, transitions, enemies with routes, event route-swaps)
- `src/sim/sim.js` — the simulation; `state` is plain data (F5/F9 quicksave is a `structuredClone`)
- `src/render/` — three.js view of the state; `fog.js` is the GPU fog of war

## Dev / design flags (play.html)
- `F2` in game: reveal mode (no fog, all enemies and cones). For studying the map.
- URL: `?auto=3` skips squad select with the first 3 roster characters, `&sim=20` fast-forwards 20 s,
  `&reveal`, `&layer=1` (-1 sewers, 0 ground, 1 roofs), `&cx=80&cz=55&ppm=10` camera.
- The browser console prints `VEIL ready: ...` after the first frame and `JSERROR ...` on uncaught errors.
- Node can import everything under `src/sim`, `src/world`, `src/core` (no three.js there), so the simulation can be scripted and asserted without a browser.

## Folder notes
- `assets/` — concept art used by the landing page.
- `design.md.pre-shadow-gambit.bak` — the design doc before the Shadow Gambit research was merged into it.
