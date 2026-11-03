// Kurogane Town — pure data. Units are metres. X grows right, Z grows DOWN on screen.
// Angles: radians, 0 = +X (east), PI/2 = +Z (south / down on screen).
// Layers: -1 sewer, 0 ground, 1 roofs.

const PI = Math.PI;
const E = 0, S = PI / 2, W = PI, N = -PI / 2;

const wall = (x, z, w, h, name) => ({ kind: 'wall', x, z, w, h, name });     // blocks move + vision
const fence = (x, z, w, h, name) => ({ kind: 'fence', x, z, w, h, name });   // blocks move only
const water = (x, z, w, h, name) => ({ kind: 'water', x, z, w, h, name });   // blocks move only
const floor = (x, z, w, h, name) => ({ x, z, w, h, name });                   // walkable area for layers that have floors
const bush = (x, z, r = 1.5) => ({ x, z, r });
const pt = (x, z, wait = 0, face = null) => ({ x, z, wait, face });

export const MAP = {
  name: 'Kurogane Town',
  width: 160,
  height: 110,
  start: { layer: 0, x: 12, z: 96 },
  exit: { layer: 0, x: 150, z: 28, w: 8, h: 16, name: 'Outside the Gate' },

  layers: {
    0: {
      name: 'Ground',
      floors: null, // whole map walkable except obstacles
      obstacles: [
        // outer walls
        wall(0, 0, 160, 2), wall(0, 108, 160, 2), wall(0, 0, 2, 70), wall(158, 0, 2, 110),
        water(0, 70, 2.6, 38, 'Harbour'),                     // quay strip x 2.6-4 reachable from the warehouse
        wall(150, 2, 8, 26), wall(150, 44, 8, 64),           // outside corridor
        // dividing wall south strip / north (with temple gate gap x 44–48)
        wall(0, 68, 44, 2), wall(48, 68, 102, 2),
        // temple / noble wall (gap z 20–23)
        wall(62, 2, 2, 18), wall(62, 23, 2, 45),
        // east gate wall (wicket gap z 34–37)
        wall(148, 2, 2, 32), wall(148, 37, 2, 31),

        // --- Harbour Warehouse (x 4–34, z 70–108)
        wall(4, 70, 30, 1, 'Warehouse'), wall(4, 107, 30, 1), wall(4, 70, 1, 24), wall(4, 97, 1, 11), // quay door gap z 94-97
        wall(33, 70, 1, 16), wall(33, 89, 1, 19),            // door gap z 86–89
        wall(12, 80, 3, 3), wall(20, 90, 4, 2), wall(26, 78, 2, 4), wall(8, 86, 2, 6),

        // --- Dock Street market (x 34–96, z 70–100)
        wall(34, 100, 62, 10, 'South row houses'),
        wall(50, 80, 4, 2, 'Stall'), wall(58, 80, 4, 2, 'Stall'), wall(50, 90, 4, 2, 'Stall'), wall(58, 90, 4, 2, 'Stall'),
        wall(75, 85, 3, 3, 'Well'),
        fence(84, 72, 10, 1, 'Railing'),

        // --- Watch alley (x 96–114, z 76–96) + tower + smithy
        wall(96, 70, 18, 6, 'Storehouse'),
        wall(104, 76, 4, 4, 'Watchtower'),
        wall(96, 96, 14, 12, 'Smithy'),

        // --- Guardhouse (x 114–146, z 74–106)
        wall(114, 74, 32, 1, 'Guardhouse'), wall(114, 105, 32, 1), wall(145, 74, 1, 32),
        wall(114, 74, 1, 14), wall(114, 91, 1, 15),           // west door gap z 88–91
        wall(130, 74, 1, 10), wall(130, 87, 1, 19),           // interior doorway z 84–87
        wall(118, 78, 4, 3, 'Crates'), wall(124, 98, 3, 3, 'Crates'), wall(136, 100, 6, 2, 'Bunks'),

        // --- Temple grounds (x 4–62, z 2–68)
        wall(10, 10, 20, 20, 'Temple'),
        wall(44, 8, 8, 6, 'Shrine'),
        water(4, 34, 10, 4, 'Pond'),
        fence(30, 36, 1, 10, 'Garden fence'),

        // --- Noble quarter (x 64–148, z 2–68)
        wall(80, 4, 20, 14, 'Manor Ishida'), wall(108, 6, 30, 18, 'Manor Kuroda'),
        wall(80, 44, 20, 16, 'Manor Sato'), wall(112, 46, 24, 14, 'Tea house'),
        fence(100, 24, 1, 10, 'Fence'), fence(138, 10, 1, 12, 'Fence'),
        water(118, 25.5, 8, 3, 'Fountain basin'),
      ],
      bushes: [
        bush(40, 97), bush(46, 74, 1.6), bush(70, 97), bush(88, 76), bush(92, 92), bush(97, 84, 1.4),
        bush(100, 92), bush(110, 92),
        bush(40, 40, 1.8), bush(48, 52, 1.8), bush(34, 58, 1.6), bush(54, 30, 1.8), bush(20, 45, 1.6), bush(46, 62, 1.6), bush(58, 16, 1.6),
        bush(100, 36, 1.6), bush(120, 36, 1.6), bush(136, 44, 1.6), bush(70, 50, 1.5), bush(70, 47, 1.5), bush(104, 66, 1.5), bush(78, 30, 1.5),
      ],
    },
    1: {
      name: 'Rooftops',
      floorsBlockVision: false,
      floors: [
        floor(4, 70, 30, 38, 'Warehouse roof'), floor(34, 100, 62, 10, 'South row roofs'),
        floor(96, 96, 14, 12, 'Smithy roof'), floor(114, 74, 32, 32, 'Guardhouse roof'), floor(104, 76, 4, 4, 'Watchtower top'),
      ],
      obstacles: [wall(20, 84, 4, 4, 'Chimney'), wall(60, 103, 3, 3, 'Chimney'), wall(126, 88, 4, 4, 'Skylight')],
      bushes: [],
    },
    '-1': {
      name: 'Sewers',
      floorsBlockVision: true,
      floors: [floor(60, 98, 60, 4, 'Main drain'), floor(64, 40, 4, 60, 'North drain'), floor(116, 86, 4, 14, 'Guardhouse drain')],
      obstacles: [],
      bushes: [],
    },
  },

  // Doors: thin rects. locked doors block move + vision until opened.
  doors: [
    { id: 'warehouse_door', layer: 0, x: 33, z: 86, w: 1, h: 3, locked: false, name: 'Warehouse door' },
    { id: 'temple_gate', layer: 0, x: 44, z: 68, w: 4, h: 2, locked: true, key: 'keyring', pickable: true, name: 'Temple Gate' },
    { id: 'temple_east', layer: 0, x: 62, z: 20, w: 2, h: 3, locked: false, name: 'Temple east door' },
    { id: 'guardhouse_door', layer: 0, x: 114, z: 88, w: 1, h: 3, locked: false, name: 'Guardhouse door' },
    { id: 'wicket', layer: 0, x: 148, z: 34, w: 2, h: 3, locked: true, key: 'keyring', pickable: true, name: 'Main Gate wicket' },
    { id: 'sluice', layer: -1, x: 64, z: 66, w: 4, h: 2, locked: true, pickable: false, opensBy: 'winch', name: 'Sewer sluice' },
  ],

  // Transitions between layers. `req` = attribute requirement. `closed` = must be opened once (grate).
  transitions: [
    { id: 'wh_ladder', type: 'ladder', name: 'Ladder', a: { layer: 0, x: 6.5, z: 104 }, b: { layer: 1, x: 6.5, z: 104 } },
    { id: 'market_grate', type: 'grate', name: 'Sewer grate', a: { layer: 0, x: 62, z: 97 }, b: { layer: -1, x: 62, z: 100 }, closed: true, req: { attr: 'strength', min: 7 } },
    { id: 'gh_drain', type: 'ladder', name: 'Drain ladder', a: { layer: -1, x: 118, z: 88 }, b: { layer: 0, x: 118, z: 100 } },
    { id: 'noble_drain', type: 'ladder', name: 'Drain ladder', a: { layer: -1, x: 66, z: 42 }, b: { layer: 0, x: 67, z: 44 } },
    { id: 'smithy_vine', type: 'vine', name: 'Vine', a: { layer: 1, x: 109, z: 100 }, b: { layer: 0, x: 111.5, z: 94 }, req: { attr: 'agility', min: 7 } },
    { id: 'gh_vine', type: 'vine', name: 'Vine', a: { layer: 0, x: 112.5, z: 100 }, b: { layer: 1, x: 116, z: 100 }, req: { attr: 'agility', min: 7 } },
    { id: 'gh_hatch', type: 'hatch', name: 'Roof hatch', a: { layer: 1, x: 139, z: 78 }, b: { layer: 0, x: 138, z: 80.5 } },
  ],

  items: [
    { id: 'keyring', layer: 0, x: 142.5, z: 79, name: "Captain's Key Ring" },
  ],

  interactables: [
    { id: 'winch', layer: 0, x: 16, z: 50, name: 'Sluice winch', action: 'winch', opens: 'sluice', noise: 6, duration: 2.5 },
  ],

  // Route swaps fired by unlock events (design section 8.2). Key: door:<id> | item:<id> | use:<id> | transition:<id>
  events: {
    'door:temple_gate': {
      message: 'A market guard takes post at the open Temple Gate.',
      swaps: [{ enemy: 'e_m1', route: [pt(46, 72, 999, S)] }],
    },
    'door:sluice': {
      message: 'The dog on Dock Street is moved to the street above the sewer grate.',
      swaps: [{ enemy: 'e_dog1', route: [pt(55, 94, 0.5), pt(69, 94, 0.5), pt(69, 98, 0.5), pt(55, 98, 0.5)] }],
    },
    'item:keyring': {
      message: 'The Captain starts a longer patrol out through Watch Alley.',
      swaps: [{ enemy: 'e_elite1', route: [pt(134, 80, 2, E), pt(122, 89.5, 1, W), pt(103, 90, 3, W), pt(122, 89.5, 0, E), pt(134, 96, 3, S)] }],
    },
  },

  locations: [
    { id: 'warehouse', name: 'Harbour Warehouse', layer: 0, x: 4, z: 70, w: 30, h: 38 },
    { id: 'market', name: 'Dock Street', layer: 0, x: 34, z: 70, w: 62, h: 30 },
    { id: 'alley', name: 'Watch Alley', layer: 0, x: 96, z: 70, w: 18, h: 40 },
    { id: 'guardhouse', name: 'Guardhouse', layer: 0, x: 114, z: 74, w: 32, h: 32 },
    { id: 'temple', name: 'Temple Grounds', layer: 0, x: 2, z: 2, w: 60, h: 66 },
    { id: 'noble', name: 'Noble Quarter', layer: 0, x: 64, z: 2, w: 84, h: 66 },
    { id: 'exit', name: 'Outside the Gate', layer: 0, x: 150, z: 28, w: 8, h: 16 },
  ],

  enemies: [
    // Warehouse door guard
    { id: 'e_door', type: 'guard', layer: 0, name: 'Door guard', route: [pt(36.5, 87.5, 3, W), pt(44, 87.5, 3, E)] },
    // Market
    { id: 'e_m1', type: 'guard', layer: 0, name: 'Market guard', route: [pt(40, 92, 2, N), pt(64, 97, 1, E), pt(88, 96, 2, N), pt(88, 78, 2, W), pt(64, 76, 1, W)] },
    { id: 'e_m2', type: 'guard', layer: 0, name: 'Wall guard', route: [pt(52, 74.5, 3, S), pt(92, 74.5, 3, S)] },
    { id: 'e_dog1', type: 'dog', layer: 0, name: 'Dog', route: [pt(70, 82, 0.5), pt(82, 82, 0.5), pt(82, 92, 0.5), pt(70, 92, 0.5)] },
    // Watchtower
    { id: 'e_sentinel', type: 'sentinel', layer: 1, name: 'Sentinel', route: [pt(106, 78, 0, S)], sweep: { center: S, amp: PI / 3, period: 20 }, seesLayers: [1, 0] },
    // Guardhouse
    { id: 'e_elite1', type: 'elite', layer: 0, name: 'Captain', route: [pt(134, 80, 3, E), pt(134, 96, 4, S)] },
    // Sewer
    { id: 'e_sewer', type: 'guard', layer: -1, name: 'Drain guard', route: [pt(80, 100, 2, W), pt(110, 100, 2, E)] },
    // Temple
    { id: 'e_t1', type: 'guard', layer: 0, name: 'Temple guard', route: [pt(36, 20, 2, W), pt(56, 24, 2, S), pt(56, 60, 2, W), pt(36, 60, 2, N)] },
    { id: 'e_t2', type: 'officer', layer: 0, name: 'Garden officer', route: [pt(8, 40, 2, E), pt(28, 42, 2, S), pt(28, 62, 2, W), pt(8, 62, 2, N)] },
    // Noble quarter
    { id: 'e_elite2', type: 'elite', layer: 0, name: 'Samurai', route: [pt(76, 19, 3, W), pt(76, 26, 3, W)] },
    { id: 'e_n2', type: 'guard', layer: 0, name: 'Street guard', route: [pt(104, 30, 2, S), pt(140, 30, 2, S), pt(140, 40, 2, N), pt(104, 40, 2, N)] },
    { id: 'e_n3', type: 'guard', layer: 0, name: 'Patrol', route: [pt(70, 65, 2, E), pt(144, 65, 3, N), pt(144, 63, 0), pt(70, 63, 3, N)] },
    { id: 'e_dog2', type: 'dog', layer: 0, name: 'Dog', route: [pt(76, 42, 0.5), pt(104, 42, 0.5), pt(104, 62, 0.5), pt(76, 62, 0.5)] },
    { id: 'e_gate1', type: 'guard', layer: 0, name: 'Gate guard', route: [pt(143, 30, 999, S)] },
    { id: 'e_gate2', type: 'guard', layer: 0, name: 'Gate guard', route: [pt(143, 40, 999, N)] },
  ],
};
