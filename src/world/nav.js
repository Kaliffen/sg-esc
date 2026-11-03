// Grid-based navigation per layer: A* with binary heap, octile heuristic, string pulling.
import { pointInRect } from '../core/math.js';

const CELL = 0.5;
const AGENT_RADIUS = 0.35;

export class NavGrid {
  constructor(width, height, cell = CELL) {
    this.cell = cell;
    this.w = Math.ceil(width / cell);
    this.h = Math.ceil(height / cell);
    this.blocked = new Uint8Array(this.w * this.h);
  }
  idx(cx, cz) { return cz * this.w + cx; }
  toCell(x, z) { return [Math.floor(x / this.cell), Math.floor(z / this.cell)]; }
  cellCenter(cx, cz) { return { x: (cx + 0.5) * this.cell, z: (cz + 0.5) * this.cell }; }
  inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h; }
  isBlockedCell(cx, cz) { return !this.inBounds(cx, cz) || this.blocked[this.idx(cx, cz)] === 1; }
  isWalkable(x, z) { const [cx, cz] = this.toCell(x, z); return !this.isBlockedCell(cx, cz); }

  fillAll(v) { this.blocked.fill(v); }
  /** Mark rect blocked/free, inflated by pad metres. */
  setRect(r, blocked, pad = AGENT_RADIUS) {
    const x0 = Math.max(0, Math.floor((r.x - pad) / this.cell));
    const z0 = Math.max(0, Math.floor((r.z - pad) / this.cell));
    const x1 = Math.min(this.w - 1, Math.floor((r.x + r.w + pad - 1e-6) / this.cell));
    const z1 = Math.min(this.h - 1, Math.floor((r.z + r.h + pad - 1e-6) / this.cell));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) this.blocked[this.idx(cx, cz)] = blocked ? 1 : 0;
  }
  /** Mark everything outside the given floors as blocked (floors shrunk by pad). */
  setFloors(floors, pad = AGENT_RADIUS) {
    this.blocked.fill(1);
    for (const f of floors) {
      const x0 = Math.ceil((f.x + pad) / this.cell), z0 = Math.ceil((f.z + pad) / this.cell);
      const x1 = Math.floor((f.x + f.w - pad) / this.cell) - 1, z1 = Math.floor((f.z + f.h - pad) / this.cell) - 1;
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) if (this.inBounds(cx, cz)) this.blocked[this.idx(cx, cz)] = 0;
    }
  }

  /** Nearest walkable cell to a world point (spiral search). */
  nearestWalkable(x, z, maxR = 12) {
    const [cx, cz] = this.toCell(x, z);
    if (!this.isBlockedCell(cx, cz)) return [cx, cz];
    for (let r = 1; r <= maxR; r++) {
      let best = null, bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = cx + dx, nz = cz + dz;
        if (this.isBlockedCell(nx, nz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = [nx, nz]; }
      }
      if (best) return best;
    }
    return null;
  }

  /** Is the straight segment p→q free of blocked cells? Samples at quarter-cell steps. */
  segmentClear(p, q) {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    const steps = Math.max(1, Math.ceil(d / (this.cell * 0.25)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isWalkable(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t)) return false;
    }
    return true;
  }

  /** A* from world point to world point. Returns array of world points (excluding start) or null. */
  findPath(from, to) {
    const s = this.nearestWalkable(from.x, from.z), g = this.nearestWalkable(to.x, to.z);
    if (!s || !g) return null;
    const goalPt = this.isWalkable(to.x, to.z) ? { x: to.x, z: to.z } : this.cellCenter(g[0], g[1]);
    const startPt = { x: from.x, z: from.z };
    if (this.isWalkable(from.x, from.z) && this.segmentClear(startPt, goalPt)) return [goalPt];

    const W = this.w, H = this.h, N = W * H;
    const sIdx = s[1] * W + s[0], gIdx = g[1] * W + g[0];
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    gScore[sIdx] = 0;
    heap.push(sIdx, heur(s[0], s[1], g[0], g[1]));
    const gx = g[0], gz = g[1];
    let found = false;
    let expansions = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === gIdx) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++expansions > 200000) break;
      const cx = cur % W, cz = (cur / W) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const ni = nz * W + nx;
        if (this.blocked[ni] || closed[ni]) continue;
        if (dx && dz && (this.blocked[cz * W + nx] || this.blocked[nz * W + cx])) continue; // no corner cutting
        const cost = gScore[cur] + (dx && dz ? 1.41421356 : 1);
        if (cost < gScore[ni]) { gScore[ni] = cost; came[ni] = cur; heap.push(ni, cost + heur(nx, nz, gx, gz)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = gIdx; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => this.cellCenter(i % W, (i / W) | 0));
    pts[pts.length - 1] = goalPt;
    pts[0] = startPt;
    return this.stringPull(pts).slice(1);
  }

  stringPull(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i <= pts.length; i++) {
      if (i === pts.length || !this.segmentClear(pts[anchor], pts[i])) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    return out;
  }
}

function heur(ax, az, bx, bz) {
  const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
  return (dx + dz) + (1.41421356 - 2) * Math.min(dx, dz);
}

class MinHeap {
  constructor() { this.keys = []; this.vals = []; }
  get size() { return this.keys.length; }
  push(v, k) {
    const ks = this.keys, vs = this.vals;
    ks.push(k); vs.push(v);
    let i = ks.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= ks[i]) break;
      [ks[p], ks[i]] = [ks[i], ks[p]]; [vs[p], vs[i]] = [vs[i], vs[p]];
      i = p;
    }
  }
  pop() {
    const ks = this.keys, vs = this.vals;
    const top = vs[0];
    const lk = ks.pop(), lv = vs.pop();
    if (ks.length) {
      ks[0] = lk; vs[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < ks.length && ks[l] < ks[m]) m = l;
        if (r < ks.length && ks[r] < ks[m]) m = r;
        if (m === i) break;
        [ks[m], ks[i]] = [ks[i], ks[m]]; [vs[m], vs[i]] = [vs[i], vs[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Cross-layer route. Returns [{layer, to, via?}] legs where `via` is a transition id used at the end of the leg,
 * or null if unreachable. `canUse(transition)` filters transitions by character capability / state.
 */
export function routeLayers(world, fromLayer, toLayer, canUse, maxHops = 4) {
  // All hop sequences (DFS). Layers may repeat (roof → street → roof), a transition is used at most once.
  const trans = world.transitions.filter(canUse);
  const out = [];
  const dfs = (layer, path, used) => {
    if (path.length && layer === toLayer) { out.push(path); return; }
    if (path.length >= maxHops) return;
    for (const t of trans) {
      if (used.has(t.id)) continue;
      for (const [from, to] of [[t.a, t.b], [t.b, t.a]]) {
        if (from.layer !== layer) continue;
        used.add(t.id);
        dfs(to.layer, [...path, { transition: t, from, to }], used);
        used.delete(t.id);
      }
    }
  };
  if (fromLayer === toLayer) out.push([]);
  dfs(fromLayer, [], new Set());
  out.sort((a, b) => a.length - b.length);
  return out;
}

export { CELL, AGENT_RADIUS, pointInRect };
