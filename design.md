# VEIL — Escape from Kurogane
*Game design & technical foundation. Working title "VEIL" (the squad is called the Veil). Repo: `sg-esc` (stealth game / escape).*

Role note: this document takes the creative-director and tech-lead decisions so the prototype can be built without further questions. Everything here is a decision, not an option list. Change it by editing it.

---

## 1. Pitch

A real-time, pausable, top-down squad stealth game in the spirit of Commandos / Shadow Tactics / Shadow Gambit: The Cursed Crew, played with the mouse.
Shadow Gambit (Mimimi, 2023) is the primary reference. The full research report is at `../reports/Shadow Gambit Cursed Crew analysis.md`; §11 lists exactly what VEIL takes from it, what it fixes, and what it deliberately does not copy.
You control a hand-picked squad of 2–4 infiltrators who must **escape a locked-down castle town at night**.
Every guard has a modelled vision cone you can see. You never fight; you **observe, time, distract, knock out, hide, and route around**.

The map is a connected set of **locations**. Each location is a small puzzle: a blocker (usually a guard setup) stands between you and a new route.
You explore until you are stuck, find the blocker, analyse it, solve it with your characters' skills and the environment, and that unlocks a piece of the map — often one you have to walk back through. **Exploration → blocked → analyse → solve → unlock → repeat**, until the squad stands outside the Main Gate.

Prototype is 2D top-down rendered with three.js (orthographic camera, XZ plane, metres). The engine is written so that the move to full 3D is a camera/asset change, not a rewrite.

---

## 2. Design pillars

1. **Readable stealth.** Everything that can see you is shown. There are no hidden rolls. If you got spotted, you can point at the cone that did it.
2. **Many answers, one question.** Every blocker has at least two solutions using different characters/abilities/environment. The squad you pick changes which answers exist.
3. **Planning is play.** Pausing, queuing waypoints with waits, and delayed starts are the core verbs. Synchronising two characters is the signature move.
4. **Failure is cheap, knowledge is kept.** Being spotted ends the attempt instantly, but quicksave/quickload is free, instant (quickload under 0.5 s, no loading screen) and the fog-of-war memory of what you learned stays in your head. Shadow Gambit's most-praised feature was its save system; the three-second reload *is* the feature.
5. **Precise world.** The simulation is in metres and seconds. Rendering is a view of the simulation and never leaks into it.
6. **Authored challenge inside the sandbox.** Shadow Gambit's freedom made it "too easy" for genre veterans and nothing in its difficulty menu fixed that. Every VEIL map ships with badges and squad restrictions (§8.3) that a strong squad cannot trivialise. The sandbox is for everyone; the badges are for the people who finished it.

---

## 3. Core loop

```
Select squad (roster) ─► Infiltration map
   ▲                          │
   │               explore (fog of war, cones)
   │                          ▼
   │                hit a blocker (guard setup / locked route)
   │                          ▼
   │        analyse: who sees what, patrol timing, what tools do I have
   │                          ▼
   │        solve: takedown / distract / sneak gap / alternative layer
   │                          ▼
   │        unlock: key, lever, cleared post ─► new route (often back through old locations)
   │                          │
   └─────── spotted ◄─────────┘        all squad at exit ─► Mission complete
```

---

## 4. The squad

### 4.1 Roster & squad selection
- The game bootstraps a **roster of 8 random characters** (persisted in `localStorage`; "Reroll" regenerates).
- Before a map you pick a **squad of 2–4** from the roster. The selection screen warns about missing capabilities ("Nobody can lift grates", "Nobody can lockpick") because those decide which solutions exist. It never blocks you — a squad without a tool just has fewer answers.
- Generation guarantees the roster as a whole can solve the map (coverage of Takedown, Lockpick, Stone, STR≥7, AGI≥7).

### 4.2 Attributes (1–10)
| Attribute | Effect |
|---|---|
| **Stealth** | Multiplies how fast enemies' detection meters fill when they see you: `rate × (1.30 − 0.06·STL)`. 10 ⇒ 0.70, 1 ⇒ 1.24. |
| **Speed** | Sneak speed `1.2 + 0.14·SPD` m/s (1.3 to 2.6), run speed `2.8 + 0.28·SPD` m/s (3.1 to 5.6). The spread is wide on purpose: a slow character changes the route, not just the timing. |
| **Perception** | Own view range `9 + 0.8·PER` m (120° FOV). Governs what the squad reveals. |
| **Strength** | ≥5 can carry bodies. ≥7 can lift sewer grates. |
| **Agility** | ≥7 can climb vines. Takedown takes `1.1 − 0.04·AGI` s. |

### 4.3 Abilities (each character has 2)
| Ability | Key | Target | What it does |
|---|---|---|---|
| **Takedown** | T / left-click enemy | enemy ≤1 m | Silent knockout. Not on Elites. Leaves a body that other enemies can find. |
| **Throw Stone** | S | ground point ≤12 m | Noise at the impact point. Enemies within 9 m go investigate for ~4 s, then return. 3 stones. |
| **Lockpick** | L / left-click door | locked door | Opens locked doors/gates without a key. Takes 3 s standing at the door. |
| **Smoke Bomb** | B | ground point ≤10 m | 5 m radius cloud for 8 s. Blocks line of sight both ways. 1 bomb. |
| **Whistle** | W | self | Lures the single nearest enemy within 14 m to walk to the whistler's position and look around. Riskier than a stone (they come to *you*), but no consumable. |
| **Sprint** (rare) | V | self | For 3 s move at 1.7× run speed. Loud and detected like running. 2 per map. |
| **Stealth Sprint** (rare) | G | self | For 2.5 s move at run speed, silent and detected like sneaking. 1 per map. |

Rare skills: about one character in eight rolls one as a third skill. They never replace the two base skills, so roster coverage is unchanged.

Every character can: sneak, run, hide in bushes, use ladders/stairs/hatches, pick up items, use levers, carry a body (STR≥5), and drop a body in a bush or into water.

**Rule for every future ability.** An ability may add a route or a timing window; it may never delete a rule. No takedown that auto-hides the body, no on-demand hiding spot, no unlimited underground hole. Shadow Gambit's DLC character Yuki (kills turn into logs, solo-kills linked pairs) erased two core constraints and every reviewer flagged it; Suleidy's plant-a-bush-anywhere was the base game's balance complaint. Consumables are **per-map charges, never cooldowns**: a charge is a decision, a cooldown is a wait.

### 4.4 Stances
- **Sneak** (default): quiet, normal detection.
- **Run** (toggle `R`): faster, detection ×1.6, makes noise in a 7 m radius every step (enemies turn to look, then investigate).

---

## 5. Perception model (the heart of the game)

### 5.1 Vision cones
Every character (player or NPC) has `facing`, `fov` (degrees) and `range` (m). The engine computes a **visibility polygon** each tick by casting rays against the layer's vision-blocking walls, clipped to the cone.
- **NPC cones are rendered** as overlays, split into a **near zone** (inner 40 % of range, drawn solid) and a **far zone** (drawn striped/dashed).
- **Far zone detects movement only.** A sneaking character who is standing still inside the far zone is not detected at all. Walking or running in it is. This is the Mimimi "dashed cone" rule: the two zones mean different *things* (solid = never, dashed = only while moving), not just different speeds, and it lets a player park a character inside a cone to wait for a timing window.
- **Player cones are not rendered**, but exist in the engine and feed the fog of war.
- Cone colour encodes alertness: yellow (calm) → orange (suspicious) → red (about to spot).

### 5.2 Detection meter
Each enemy keeps a detection meter `0…1` (driven by the most visible squad member, shown over the enemy's head).
Per second, when a squad member is inside the cone with clear line of sight and not hidden:

```
rate = base(type) × zone × stance × stealthMult(character)
zone:   near zone = 4.0 (≈ instant, 0.25 s)   far zone = lerp(1.2 → 0.5, by distance)
stance: sneak 1.0, run 1.6, still (not moving) 0.7 in the near zone, 0 in the far zone (§5.1)
```
When nobody is visible the meter decays at 0.6/s. Meter ≥ 0.35 ⇒ **suspicious**: the enemy stops and stares at the last seen position until the meter decays below 0.2. Meter reaches 1.0 ⇒ **spotted ⇒ alarm ⇒ mission failed**. (Alarm escalation / combat is intentionally out of scope for the prototype: being spotted loses the map.)

### 5.3 Hiding
- **Bush**: a character inside a bush is invisible to any enemy farther than 1.5 m (dogs: 2.5 m). Bushes also hide bodies dropped in them.
- **Smoke**: a smoke cloud is a temporary circular vision blocker for everyone.
- **Walls** block vision; **fences, water, railings** block movement but not vision.
- **Darkness** is not modelled (map is night but uniformly lit) — reserved for the 3D version.

### 5.4 Hearing / noise
Noise events have a position and radius (halved through walls). Every mobile enemy on the same layer inside the radius walks to it, looks around (Guards 4 s, Elites and Dogs 2 s) and returns to its routine. Stationary Sentinels only turn toward the noise for 3 s.
Noise sources: running steps (7 m), stone impact (9 m), lever use (6 m), lifting a grate (5 m), whistle (14 m, nearest enemy only).

### 5.5 Bodies
Knocked-out enemies lie where they fell. Any enemy that sees a body (cone + LOS) raises the alarm immediately. Bodies can be carried (STR≥5, carrier moves at 70 % speed) and dropped in bushes to hide them, or dropped into water (harbour, canal) where they sink and are gone. Water hides bodies; bushes hide bodies and people.

### 5.6 Layers of the world
Three layers: **Sewer (−1)**, **Ground (0)**, **Roofs (+1)**. Each layer has its own walls and nav-grid.
Vision rules: a viewer sees its own layer. A viewer on the Roof layer *also* sees the Ground layer (cone computed against ground walls). Ground never sees Roofs, Sewer sees only Sewer. Transitions (ladder, stairs, hatch, grate, vine) connect layers; some require an attribute.

---

## 6. Enemies

| Type | FOV | Range | Base rate | Behaviour | Counter-play |
|---|---|---|---|---|---|
| **Guard** | 90° | 12 m | 1.0 | Patrols a route with pauses; investigates noise. | Takedown, distract, time the gap. |
| **Sentinel** | 50° | 24 m | 0.8 | Stationary on a tower; slowly sweeps a 120° arc. Sees Roofs + Ground. | Learn the sweep timing, use the gap, or avoid the layer. |
| **Dog** | 360° | 5 m | 2.0 | Fast patrol loop. Smells you through bushes within 2.5 m. | Keep distance; stone draws it far away; can be knocked out. |
| **Elite** (samurai) | 110° | 14 m | 1.3 | Holds a post, pacing a short line. **Cannot be taken down.** Responds to noise but returns fast (2 s look). | Lure away with stone/whistle, blind with smoke, approach from another layer. |
| **Officer** | 90° | 12 m | 1.0 | Patrols like a Guard but **ignores stones and whistles**: turns toward the noise, never walks to it. Can be taken down. | Smoke, patrol timing, or a takedown from behind and a bush for the body. |

**Each enemy type cancels exactly one player tool.** Guard: none (the baseline). Dog: bushes. Sentinel: the open street and a whole layer. Elite: Takedown. Officer: distraction. Shadow Gambit built its roster this way (Commissarius resists distraction, Kindred pairs need two attackers, Prognosticar punishes a single attacker) and it is what forces multi-character solutions; its one roster complaint was that six types was too few and they all appeared early. VEIL introduces one type per location (§8.1) and adds a type with every new map.

Enemy AI states: `patrol → suspicious → investigate → return`, plus `alarmed` (terminal) and `unconscious`.

---

## 7. Orders & controls (mouse first)

All orders can be issued while paused. Unpausing executes them.

| Input | Action |
|---|---|
| Left click character / portrait / `1–4` | Select |
| Right click ground | Move here (replaces current orders) |
| **Right click + drag** | Move here and face the drag direction on arrival. A gizmo (ring, line, arrow) shows the spot and the facing while held; the waypoint keeps the arrow after release. |
| **Shift** + right click | Append waypoint |
| Hover a waypoint + wheel | Adjust wait time at that waypoint (±0.5 s) |
| **Ctrl** + wheel | Adjust start delay of the selected character's orders |
| Left click enemy / door / item / lever / ladder | Context action (Takedown, Lockpick/Open, Pick up, Use, Climb). Shift appends. |
| `T` `S` `B` `W` `L` | Arm ability, then click target |
| `C` | Carry / drop body (drop in a bush to hide) |
| `R` | Toggle sneak / run |
| `H` or `X` | Hold position / clear orders |
| `Space` | Pause / resume |
| `F` | Centre camera on selected |
| Wheel / middle-drag / arrow keys | Zoom / pan |
| `Tab` | Cycle the viewed layer (auto-follows the selected character) |
| `F5` / `F9` | Quicksave / quickload |
| `Esc` | Cancel armed ability / deselect |
| `F1` | Help overlay |
| `F2` | Reveal mode: no fog, every enemy and cone drawn. A design/debug view, not a play mode. |

Order model: a character has an **order queue** of steps (`move`, `wait`, `use`, `takedown`, `ability`) and a **start delay**. A delayed queue shows a countdown ring around the character. Waypoints are drawn as numbered dots with the path, and wait times as small labels. This is what makes synchronised double takedowns possible: give A a 0 s delay and B a 1.5 s delay while paused, unpause, watch.

**Order state is never ambiguous.** Shadow Gambit's one recurring Shadow Mode complaint was not knowing whether a queued action was still armed or had been cancelled. In VEIL: queued steps are white, the executing step is green, a delayed queue shows its countdown ring, and a cancelled queue flashes red once and disappears. Takedown animations stay short (`1.1 − 0.04·AGI` s, never longer) because slow kill animations were a named friction point.

**Save reminder.** After 90 s of sim time without a quicksave a small bell icon pulses next to the clock (toggle in F1, default on). Shadow Gambit's optional "ghost bell" reminder is the model. **Controls stay stable**: this scheme is the Shadow Tactics / Desperados III scheme and VEIL does not change it. Mimimi changed the camera between demo and release and had to patch the old one back within weeks.

---

## 8. The map: Kurogane Town (150 × 110 m)

The squad botched a job and the town is locked down. Get everyone out through the Main Gate.

### 8.1 Locations
| # | Location | Layer(s) | Blocker | Unlocks |
|---|---|---|---|---|
| 1 | **Harbour Warehouse** (start) | Ground, Roof | One guard watching the only door, patrols a short line. | Dock Street. Roof ladder → the rooftop route. |
| 2 | **Dock Street market** | Ground, Sewer under it | 2 guards on a loop + a dog. The **Temple Gate** (locked) and the **Alley** are watched. | Alley (via street gap, sewer grate STR≥7, or roofs). |
| 3 | **Watch Alley** | Ground, Roof | **Sentinel tower** sweeps the only street between Market and Guardhouse (gap ≈ 6 s each 20 s). | Guardhouse. |
| 4 | **Guardhouse** | Ground, Roof hatch | **Elite** paces inside beside the **Captain's Key Ring**. Can't be taken down. | Key Ring → opens Temple Gate & Main Gate wicket. Roof hatch drops in from above. |
| 5 | **Temple Grounds** | Ground | 1 guard + 1 **Officer** cross-patrolling, garden bushes, the **Sluice Winch**. Reached through the Temple Gate (key or lockpick). | Winch opens the **sewer sluice** → sewer route into Noble Quarter. Temple east door → Noble Quarter, watched by an Elite on post. |
| 6 | **Noble Quarter** | Ground, Roof, Sewer exit | Patrols + a dog. The **Main Gate wicket** is locked (key) and watched by **two gate guards facing each other**. | Exit. |
| 7 | **Outside the Gate** (exit) | Ground | — | All squad members here ⇒ win. |

### 8.2 Intended progression (and the alternatives)
1. **Warehouse → Market**: knock the door guard out when he turns, or stone the yard so he walks away, or climb to the roof and skip him.
2. **Market → Alley** (through the Sentinel's sweep): time the gap through bushes; *or* lift the sewer grate (STR≥7) and pop up behind the tower; *or* run the rooftops and climb down the vine (AGI≥7).
3. **Guardhouse → Key Ring**: Elite can't be dropped. Stone the far room so he walks there and grab the ring; whistle him outside and loop around; smoke the room; or drop through the roof hatch straight onto the key when he is at the far end of his pacing line.
4. **Back through the Market → Temple Gate** (first forced backtrack): open it with the key ring, or lockpick it (if you had Lockpick you could do this earlier and get the key later — the order is yours).
5. **Temple → Winch**: a guard and an Officer cross-patrol the courtyard; use the garden bushes. The Officer cannot be stoned away, so it is timing, smoke, or a takedown from behind with a bush for the body. Winching makes noise (6 m) — plan for it. The sluice opens ("you hear water rushing below").
6. **Temple → Noble Quarter**: through the east door past the Elite on post (sync a stone + a sneak), *or* **back to the Market sewer grate**, through the now-open sluice into the Noble Quarter (second backtrack).
7. **Main Gate**: two guards face each other across the wicket. Double takedown with a delayed start, or stone one away and drop the other, or smoke and lockpick/key the wicket while blind. Bring everyone through.

Every step has ≥2 solutions and most depend on *who* you brought. The map is small enough to hold in your head, dense enough to keep the cones interesting.

**Revisits change the location.** Shadow Gambit's single biggest complaint (54 "repetitive map" mentions, its lowest review scores) was being sent back across a layout that had not changed. VEIL's map forces two backtracks, so every unlock trips a state change in the locations you will walk back through:
- **Temple Gate opened** → one Market guard leaves his loop and takes post at the open gate. Dock Street's gap gets wider; the gate itself gets harder.
- **Sluice opened** (winch noise) → the Market dog is moved to the street above the sewer grate. The sewer becomes the quiet route, the street stops being one.
- **Key Ring taken** → the Guardhouse Elite starts a longer patrol out through Watch Alley. The alley is no longer safe on the way back; the Guardhouse now is.

No location is re-entered with the guard setup it had the first time. `map-data.js` declares these as `onEvent` route swaps, not scripted cutscenes.

### 8.3 Badges and difficulty (authored challenge)
Four badges per map, shown on the squad-select screen, tracked per map in `localStorage`:
| Badge | Constraint |
|---|---|
| **Ghost** | No takedowns. |
| **Duo** | Squad of exactly 2. |
| **Street Level** | Never enter the Roof or Sewer layer. |
| **Clockwork** | All out in under 8:00 of sim time. |

Three difficulty presets, chosen with the squad:
| Preset | Rules |
|---|---|
| **Veil** (default) | As written in this document. |
| **Hard** | Detection rates ×1.4, 2 stones, no smoke, save reminder off. |
| **Blind** | As Hard, and **orders cannot be issued while paused**: pause still lets you look, planning happens in real time. This is Desperados III's "Desperado" rule; Shadow Gambit's hardest preset left the pause-and-queue untouched and veterans called it "so easy on the hardest". |

---

## 9. Technical foundation

### 9.1 Principles
- **Simulation is plain data.** `sim.state` is a tree of plain objects (characters, enemies, objects, doors, items, noises, clock). No three.js objects, no closures. This gives us quicksave (`structuredClone`), determinism, and later: replays, networking, and the 3D renderer for free.
- **Fixed timestep.** The simulation advances in 1/60 s steps.
- **World units are metres**, Y is up, the ground is the XZ plane, +Z is "down" on screen. All geometry, nav and vision live in world space. Only `Viewport` knows about pixels.
- **Map is data.** `map-data.js` declares rectangles (walls/fences/water/bushes), doors, transitions, items, interactables, enemies with routes, `onEvent` route swaps (§8.2), locations, start and exit. `map.js` compiles it into per-layer wall segments and nav grids. The declaration is JSON-shaped from day one so a level editor is a form over the same data. Mimimi shipped its editor in the studio's last week and it could not build a community; VEIL's editor ships with the second map.
- **Saves are versioned and instant.** A quicksave is `structuredClone(sim.state)` tagged with `saveVersion`; quickload is a pointer swap and must stay under 0.5 s. Save corruption was Shadow Gambit's fourth most-mentioned negative on Steam, accumulated after patching stopped; the version tag is what lets a later build refuse or migrate an old save instead of loading garbage.

### 9.2 Modules
```
index.html                 import map (three.js from CDN), HUD DOM, styles
src/main.js                boot: roster → squad select → mission; game loop
src/core/math.js           vectors, segment intersection, angles, point-in-polygon
src/core/rng.js            seeded RNG for the roster
src/world/map-data.js      Kurogane Town (data only)
src/world/map.js           compile: walls per layer, nav grids, lookups
src/world/nav.js           A* on grid + string pulling + cross-layer routing via transitions
src/world/vision.js        visibility polygon for a cone against segments (+ smoke discs)
src/sim/characters.js      roster generation (names, attributes, abilities)
src/sim/enemies.js         enemy types + AI (patrol / suspicious / investigate / return)
src/sim/sim.js             state, update(), orders, detection, noises, interactions, win/lose
src/render/viewport.js     orthographic camera, zoom-to-cursor, pan, screen↔world
src/render/fog.js          GPU fog of war: visibility RT → memory RT (fade) per layer
src/render/renderer.js     scene graph sync from state, cones, markers, ghosts, labels
src/ui/input.js            mouse/keyboard → orders, armed abilities, hover context
src/ui/hud.js              portraits, action bar, order panel, toasts, overlays
src/ui/squad-select.js     roster screen
tools/driver.mjs           headless remote control: runs src/sim in Node (orders, inspection, snapshot/restore, speculative attempt)
tools/e2e.mjs              end-to-end scenarios without a browser: lose, save/load, features, full win (node tools/e2e.mjs)
```

### 9.3 Vision & fog implementation
- Visibility polygon: rays to every wall endpoint inside the cone (±0.0005 rad) plus fill rays every 3°, intersected against segments pre-filtered by range; sorted by angle; triangle fan.
- Fog of war is GPU-side per layer: squad polygons are rasterised to a "current visibility" render target; a ping-pong "memory" target applies `mem = max(vis, mem > 0 ? max(mem − dt/20, 0.35) : 0)`; the overlay plane darkens by `1 − mem`. Seen-then-lost areas fade to grey over 20 s and never go fully dark again.
- Enemies are rendered only if currently inside a squad member's visibility polygon on the viewed layer; otherwise a dim "last seen" ghost is drawn at the last known position.

### 9.4 Navigation
- Grid per layer, 0.5 m cells, obstacles inflated by the agent radius (0.35 m). Binary-heap A*, octile heuristic, no corner cutting. Path is string-pulled with segment-vs-obstacle checks.
- Cross-layer: transitions form a tiny graph; routing is BFS over transitions, then A* per segment. A locked door or unopened grate is simply not an edge.

### 9.5 Road to 3D
Swap `OrthographicCamera` for `PerspectiveCamera` + controls, keep `Viewport.screenToWorld` (it already raycasts a ground plane), replace flat meshes by models with the same ids, draw cones on the ground as decals (same polygons), and keep the fog as a ground projection. The sim does not change.

---

## 9.6 Prototype status (what the code in this folder does today)
Implemented: everything in §4–§8 except as noted here. Roster + squad select with presets and badges; three layers with per-layer nav grids and fog of war; cones with solid near zone and striped far zone (movement-only detection in the far zone); Guard, Sentinel, Dog, Elite and Officer; bushes, smoke, water body disposal, carried bodies; stone, whistle, smoke, lockpick, takedown; doors/keys, winch/sluice, grates/vines/ladders/hatch; the three `onEvent` route swaps; order queue with waits and start delay, executing-order colour, cancel flash; quicksave/quickload with `saveVersion`; save reminder bell; win/lose with badge tracking.
Not yet: a fog-of-war memory in the quicksave (fog is visual only and is not restored), per-step order colours beyond executing/queued, a level editor, alarms beyond "spotted = map lost".

## 10. Out of scope for the prototype (deliberately)
Combat/alarm escalation, lighting/shadows, disguises, save slots beyond quicksave, sound, multiple maps, character progression, audio-driven noise masking. The foundation leaves room for all of these: noises and alertness already exist as data; abilities are a table; maps are data. The decisions for the first post-prototype systems are already made in §12.

---

## 11. What VEIL takes from Shadow Gambit, and what it does not
Source: `../reports/Shadow Gambit Cursed Crew analysis.md` (Metacritic 85, Steam 91 % on ~6,600 reviews, studio closed twelve days after launch). The mapping below is the integration; the sections above already contain the edits.

### 11.1 Kept
| Shadow Gambit | Evidence | VEIL decision |
|---|---|---|
| Instant diegetic quicksave, three-second reload | Most-praised feature; three story beats hinge on it being hijacked, looped and switched off | Pillar 4: quickload < 0.5 s, versioned saves (§9.1). The fiction wrapper and the "save disabled" mission are §12 items. |
| Solid vs dashed view cone | Genre convention players read instantly | §5.1: far zone detects movement only. |
| Enemy types that each cancel one tool | Forces synchronised multi-character solutions; roster of six was "too few, all at once" | §6: five types, one new type per location, a new type with each new map. Officer added as the distraction-immune type. |
| Kits built on repositioning with hard passive limits | Routing differs by crew, not just combat | §4.2: STR gates grates and carrying, AGI gates vines. Keep extending this table before extending abilities. |
| Per-map charges on strong tools | The uncharged tools (bush, cannon, underground) were the balance complaints | §4.3: charges, never cooldowns. |
| Bodies hidden in water | Cheap, readable, rewards map knowledge | §5.5. |
| Onion-layered map: easy rim, hard core | Reviewers' description of the islands that worked | §8: Harbour → Market → Alley → Guardhouse → Gate escalates inward. |
| Readability-first art, faction colour | Dev Diary #3: Desperados III was "too noisy" | Cones, bodies, noise rings and layer transitions are the only saturated colours; the town is desaturated night. |
| Optional save reminder | Removes the "forgot to save" rage without automating the save | §7. |
| Custom difficulty and constraint badges | The part of SG's difficulty menu that did work | §8.3. |

### 11.2 Fixed
| Shadow Gambit problem | Evidence | VEIL decision |
|---|---|---|
| 10 islands for 32 missions, mandatory revisits on identical perimeters | 54 Steam mentions, lowest critic scores cite it | §8.2: every unlock changes the guard setup in the locations you walk back through. Never re-enter an unchanged location. |
| No authored escalation above the sandbox | 45 "too easy" mentions; "so easy on the hardest" | Pillar 6, §8.3: Blind preset removes order-while-paused; badges restrict squad and tools. |
| Queued-vs-cancelled order ambiguity, slow kill animations | TheSixthAxis, Steam threads | §7: unambiguous order colours, takedown ≤ 1.1 s. |
| Camera/control scheme changed between demo and release | Patched back within weeks | §7: the scheme is fixed now. |
| Editor shipped in the studio's last week | No community formed | §9.1: editor with map two. |
| Save corruption after patching stopped | 32 Steam mentions | §9.1: `saveVersion`. |
| Story front-loaded with talk, villain only in cutscenes, 22 % finished | Steam threads, Gameswelt, Mimimi Dev Diary #5 | §12: no dialogue cards; the antagonist acts inside missions from mission one. |

### 11.3 Deliberately not copied
- **Eight freely combinable characters across a long campaign.** It cost Mimimi the hand-tuned difficulty curve of their earlier games and forced a hub narrator just to deliver exposition. VEIL's roster is random per run and the squad is picked per map; the map, not the cast, is authored.
- **The explorable hub ship.** Walking the hub and clicking dialogue cards was called filler. VEIL's between-map screen is the squad select and nothing else.
- **Supernatural kit ceiling** (teleport, possession, body-eating chest). Spectacular, and the reason the game was easy. VEIL's tools are a stone, a whistle, a smoke, a lockpick and a takedown. Depth comes from timing and layers.
- **The business model.** Roughly 40 people, premium price, 200-metre hand-built islands: Mimimi's own verdict was that the genre's revenue cannot carry it, and the genre's two successors peak at 240–270 concurrent players. VEIL is sized the other way: one dense 150 × 110 m map, maps as data, an editor early.

---

## 12. After the prototype (decided, not scheduled)
1. **Local alarms with a runner.** Being spotted alarms the *location*, not the town. One enemy type, the **Runner**, carries the alarm to the Guardhouse; stop him and the lockdown stays local. Alarmed locations get doubled patrols permanently. This is the Shadow Gambit mechanic (local alarms + bell-carrying Acolytes) that made open maps playable at 250 NPCs, and it is the first thing that turns "spotted = lost" into "spotted = worse".
2. **A second exit.** The harbour skiff, reachable only by the sewer outfall with STR≥7 and a lockpick. Player-chosen entry and exit points were the most praised structural idea in Shadow Gambit; VEIL starts with the exit.
3. **A voice that is always there.** Shadow Gambit's ghost ship is the one voiced character that is present whatever party you bring, and the Afia–Marley relationship is the one players quote. VEIL's equivalent is the Veil's **fixer**, heard but never seen, who briefs, comments on who you brought, and is the only continuity between maps. The fixer is written to be compromised in a later map, which is how the "save disabled" mission (the Marley hijack in "Into the Lion's Den") is earned.
4. **Story shown in play.** No dialogue cards. Character history is delivered the way Shadow Gambit's praised Captain's Tests did it: a mission built around one character's past, played, not read. The antagonist appears inside missions from the first map onward.
5. **New maps add one enemy type each**, and new abilities add routes, never delete rules (§4.3).
