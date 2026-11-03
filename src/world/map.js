// Compiles MAP data into a runtime World: per-layer wall segments, nav grids, lookups.
import { NavGrid } from './nav.js';

function rectSegments(r) {
  const x0 = r.x, z0 = r.z, x1 = r.x + r.w, z1 = r.z + r.h;
  return [
    { ax: x0, az: z0, bx: x1, bz: z0, o: r }, { ax: x1, az: z0, bx: x1, bz: z1, o: r },
    { ax: x1, az: z1, bx: x0, bz: z1, o: r }, { ax: x0, az: z1, bx: x0, bz: z0, o: r },
  ];
}

export function buildWorld(MAP) {
  const world = {
    name: MAP.name, width: MAP.width, height: MAP.height,
    start: MAP.start, exit: MAP.exit,
    layers: {}, doors: MAP.doors, transitions: MAP.transitions, items: MAP.items,
    interactables: MAP.interactables, locations: MAP.locations, enemies: MAP.enemies, events: MAP.events || {},
    layerIds: [-1, 0, 1],
  };
  for (const id of world.layerIds) {
    const src = MAP.layers[String(id)] || MAP.layers[id];
    const L = {
      id, name: src.name, floors: src.floors, obstacles: src.obstacles, bushes: src.bushes,
      floorsBlockVision: !!src.floorsBlockVision,
      staticSegments: [],
      grid: new NavGrid(MAP.width, MAP.height),
    };
    // Vision segments: walls, plus floor edges for enclosed layers (sewers).
    for (const o of src.obstacles) if (o.kind === 'wall') L.staticSegments.push(...rectSegments(o));
    if (src.floors && L.floorsBlockVision) for (const f of src.floors) L.staticSegments.push(...rectSegments(f));
    world.layers[id] = L;
  }
  rebuildAllGrids(world, new Map(MAP.doors.map((d) => [d.id, d.locked])));
  world.doorById = Object.fromEntries(MAP.doors.map((d) => [d.id, d]));
  world.transitionById = Object.fromEntries(MAP.transitions.map((t) => [t.id, t]));
  return world;
}

/** Rebuild nav grids; `doorLocked` is Map(doorId → locked). */
export function rebuildAllGrids(world, doorLocked) {
  for (const id of world.layerIds) rebuildGrid(world, id, doorLocked);
}
export function rebuildGrid(world, layerId, doorLocked) {
  const L = world.layers[layerId];
  const g = L.grid;
  if (L.floors) g.setFloors(L.floors); else g.fillAll(0);
  for (const o of L.obstacles) g.setRect(o, true);
  for (const d of world.doors) if (d.layer === layerId && doorLocked.get(d.id)) g.setRect(d, true);
  if (!L.floors) {
    // map border
    g.setRect({ x: -1, z: -1, w: world.width + 2, h: 1 }, true);
    g.setRect({ x: -1, z: world.height, w: world.width + 2, h: 1 }, true);
    g.setRect({ x: -1, z: -1, w: 1, h: world.height + 2 }, true);
    g.setRect({ x: world.width, z: -1, w: 1, h: world.height + 2 }, true);
  }
}

/** Vision-blocking segments for a layer given dynamic door state. */
export function visionSegments(world, layerId, doorLocked) {
  const L = world.layers[layerId];
  const segs = L.staticSegments.slice();
  for (const d of world.doors) if (d.layer === layerId && doorLocked.get(d.id)) segs.push(...rectSegments(d));
  return segs;
}

export function locationAt(world, layer, p) {
  if (layer === 1) return { id: 'roofs', name: 'Rooftops' };
  if (layer === -1) return { id: 'sewers', name: 'Sewers' };
  for (const l of world.locations) if (p.x >= l.x && p.x <= l.x + l.w && p.z >= l.z && p.z <= l.z + l.h) return l;
  return { id: 'unknown', name: 'Kurogane' };
}

export function bushAt(world, layer, p, extra = 0) {
  for (const b of world.layers[layer].bushes) {
    const dx = p.x - b.x, dz = p.z - b.z;
    if (dx * dx + dz * dz <= (b.r + extra) ** 2) return b;
  }
  return null;
}
