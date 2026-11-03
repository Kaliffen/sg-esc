# Changelog

## 0.9.0 — local validation build (2026-11-03)

### Gameplay
- Characters differ much more in speed: sneak 1.3–2.6 m/s, run 3.1–5.6 m/s across SPD 1–10.
- Two rare speed skills (about one character in eight rolls one as a third skill): **Sprint** (V, 3 s at 1.7× run speed, loud, 2 per map) and **Stealth Sprint** (G, 2.5 s at run speed, silent, counts as sneaking, 1 per map).
- Right-click **drag** sets the direction a character faces on arrival. A gizmo (ring, line, arrow) is drawn while the button is held; the waypoint keeps an arrow after release.
- Rooftop route restored: the warehouse roof now connects to the south-row roofs and the smithy roof (the roof floors did not overlap, so the ladder led to a dead end).
- Squad spawns in a 2 m formation; the action bar sits above the portraits.

### Fixes (from the code review)
- Restarting a mission re-locked doors visually but left the nav grid open: a second run could walk through the Temple Gate, the wicket and the sluice. The sim now rebuilds the grids from its own door state.
- Enemy `investigate` could crash on an empty path.
- Door approach side is chosen by real path length, not waypoint count.
- Stones and smoke are refused when aimed on a layer the character is not on.
- Badges are recomputed after a quickload and a second win.
- Mouse wheel over a non-move waypoint no longer swallows the zoom.
- The fail/win overlay is rendered once per state instead of every frame.
- Roster coverage guarantees can no longer overwrite each other.
- Blind preset: drop, clear orders and stance changes also respect "no orders while paused".
- A start delay no longer freezes a queue that is already running.
- A suspicious officer or sentinel no longer gets a stale 3 s turn queued by a noise.
- `serve.py` is threaded (parallel module loads were refused).

### Tooling
- `tools/driver.mjs`: headless remote control for the simulation in Node (orders, inspection, snapshot/restore, speculative `attempt`).
- `tools/e2e.mjs`: lose, save/load, features and a full scripted win of Kurogane Town, no browser needed.
- `tools/explore.mjs`: routing and enemy timing questions.

### Site
- `index.html` is the vision page (header, locations, pillars, controls, a reveal-mode screenshot of the running prototype). `play.html` is the game.
