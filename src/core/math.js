// Small 2D math toolkit. World is the XZ plane in metres; we use {x, z} objects.
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const len = (v) => Math.hypot(v.x, v.z);
export const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
export const add = (a, b) => ({ x: a.x + b.x, z: a.z + b.z });
export const scale = (v, s) => ({ x: v.x * s, z: v.z * s });
export const norm = (v) => { const l = len(v) || 1; return { x: v.x / l, z: v.z / l }; };
export const angleOf = (v) => Math.atan2(v.z, v.x);
export const fromAngle = (a, r = 1) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });

/** Wrap angle to (-PI, PI]. */
export function wrapAngle(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}
export const angleDiff = (a, b) => wrapAngle(b - a);

/** Move angle `a` toward `b` by at most `step` radians. */
export function turnToward(a, b, step) {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= step) return b;
  return wrapAngle(a + Math.sign(d) * step);
}

/** Move scalar toward target. */
export function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

/**
 * Ray (origin o, direction d) vs segment (a, b). Returns t along the ray (>=0) or Infinity.
 */
export function raySegment(ox, oz, dx, dz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az;
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return Infinity;
  const fx = ax - ox, fz = az - oz;
  const t = (fx * ez - fz * ex) / den;
  const u = (fx * dz - fz * dx) / den;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return Infinity;
}

/** Segment (p,q) intersects segment (a,b)? */
export function segmentsIntersect(p, q, a, b) {
  const d1 = orient(a, b, p), d2 = orient(a, b, q), d3 = orient(p, q, a), d4 = orient(p, q, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}
function orient(a, b, c) { return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x); }

/** Does segment p-q intersect axis-aligned rect {x,z,w,h} (expanded by pad)? */
export function segmentHitsRect(p, q, r, pad = 0) {
  const x0 = r.x - pad, z0 = r.z - pad, x1 = r.x + r.w + pad, z1 = r.z + r.h + pad;
  // Liang–Barsky clip
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dz = q.z - p.z;
  const checks = [[-dx, p.x - x0], [dx, x1 - p.x], [-dz, p.z - z0], [dz, z1 - p.z]];
  for (const [pp, qq] of checks) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

export function pointInRect(p, r, pad = 0) {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.z >= r.z - pad && p.z <= r.z + r.h + pad;
}

/** Point in polygon (array of {x,z}). */
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Ray-circle: returns smallest t>=0 where ray hits circle, or Infinity. */
export function rayCircle(ox, oz, dx, dz, cx, cz, r) {
  const fx = ox - cx, fz = oz - cz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - 4 * c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / 2, t2 = (-b + s) / 2;
  if (t1 >= 0) return t1;
  if (t2 >= 0) return 0; // inside circle
  return Infinity;
}

export const fmt = (n, d = 1) => Number(n).toFixed(d);
