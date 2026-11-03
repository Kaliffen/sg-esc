// Visibility polygon (triangle fan) for a cone against wall segments and blocking circles (smoke).
import { raySegment, rayCircle, TAU, wrapAngle } from '../core/math.js';

const FILL_STEP = (3 * Math.PI) / 180;
const EPS = 0.0005;

function segDist2(px, pz, s) {
  const vx = s.bx - s.ax, vz = s.bz - s.az;
  const wx = px - s.ax, wz = pz - s.az;
  const l2 = vx * vx + vz * vz || 1e-9;
  let t = (wx * vx + wz * vz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = s.ax + vx * t - px, dz = s.az + vz * t - pz;
  return dx * dx + dz * dz;
}

/** Segments within `range` of (x,z). */
export function nearbySegments(segments, x, z, range) {
  const r2 = range * range;
  const out = [];
  for (const s of segments) if (segDist2(x, z, s) <= r2) out.push(s);
  return out;
}

function castRay(ox, oz, ang, range, segs, circles) {
  const dx = Math.cos(ang), dz = Math.sin(ang);
  let t = range;
  for (const s of segs) { const h = raySegment(ox, oz, dx, dz, s.ax, s.az, s.bx, s.bz); if (h < t) t = h; }
  if (circles) for (const c of circles) { const h = rayCircle(ox, oz, dx, dz, c.x, c.z, c.r); if (h < t) t = h; }
  return t;
}

/**
 * Returns {poly: [{x,z}...] (fan, first = origin), hits: [{ang, t}] sorted by relative angle}.
 * fov in radians; fov >= TAU gives a full circle.
 */
export function visibilityPolygon(ox, oz, facing, fov, range, segments, circles = null) {
  const segs = nearbySegments(segments, ox, oz, range);
  const full = fov >= TAU - 1e-6;
  const half = fov / 2;
  const angles = [];
  const inCone = (a) => full || Math.abs(wrapAngle(a - facing)) <= half + 1e-9;
  if (!full) { angles.push(facing - half, facing + half); }
  // endpoint rays
  const r2 = range * range;
  for (const s of segs) {
    for (const [px, pz] of [[s.ax, s.az], [s.bx, s.bz]]) {
      const dx = px - ox, dz = pz - oz;
      if (dx * dx + dz * dz > r2 * 1.05) continue;
      const a = Math.atan2(dz, dx);
      if (inCone(a)) { angles.push(a - EPS, a, a + EPS); }
    }
  }
  // fill rays
  if (full) { for (let a = 0; a < TAU; a += FILL_STEP) angles.push(a); }
  else { for (let a = -half; a <= half; a += FILL_STEP) angles.push(facing + a); }

  const hits = [];
  for (const a of angles) {
    const rel = full ? wrapAngle(a - facing) : wrapAngle(a - facing);
    if (!full && Math.abs(rel) > half + 1e-6) continue;
    hits.push({ ang: a, rel, t: castRay(ox, oz, a, range, segs, circles) });
  }
  hits.sort((p, q) => p.rel - q.rel);
  const poly = [{ x: ox, z: oz }];
  for (const h of hits) poly.push({ x: ox + Math.cos(h.ang) * h.t, z: oz + Math.sin(h.ang) * h.t });
  if (full && hits.length) poly.push(poly[1]);
  return { poly, hits, full };
}

/** Line of sight between two points against segments and circles. */
export function hasLOS(a, b, segments, circles = null) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  const ux = dx / d, uz = dz / d;
  for (const s of segments) if (raySegment(a.x, a.z, ux, uz, s.ax, s.az, s.bx, s.bz) < d) return false;
  if (circles) for (const c of circles) if (rayCircle(a.x, a.z, ux, uz, c.x, c.z, c.r) < d) return false;
  return true;
}

/** Is point p inside cone (origin o, facing, fov, range) ignoring walls? Returns distance or -1. */
export function inCone(o, facing, fov, range, p) {
  const dx = p.x - o.x, dz = p.z - o.z;
  const d = Math.hypot(dx, dz);
  if (d > range) return -1;
  if (fov >= TAU - 1e-6 || d < 0.3) return d;
  const a = Math.atan2(dz, dx);
  return Math.abs(wrapAngle(a - facing)) <= fov / 2 ? d : -1;
}
