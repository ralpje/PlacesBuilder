import type { Pt } from './types.ts';

/** Signed area; positive when the ring runs counter-clockwise in a y-up system. */
export function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export const area = (ring: Pt[]) => Math.abs(signedArea(ring));

export function centroid(ring: Pt[]): Pt {
  const a = signedArea(ring);
  if (Math.abs(a) < 1e-12) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function bbox(ring: Pt[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function pointInPolygon(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distToRing(p: Pt, ring: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, distToSegment(p, ring[i], ring[(i + 1) % ring.length]));
  return d;
}

/** A point that is guaranteed to lie inside the polygon (centroid if inside, else best grid sample). */
export function pointOnSurface(ring: Pt[]): Pt {
  const c = centroid(ring);
  if (pointInPolygon(c, ring)) return c;
  const [x0, y0, x1, y1] = bbox(ring);
  let best: Pt = ring[0];
  let bestD = -1;
  const n = 24;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const p: Pt = [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n];
      if (!pointInPolygon(p, ring)) continue;
      const d = distToRing(p, ring);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** True when two non-adjacent edges of the ring cross each other. */
export function selfIntersects(ring: Pt[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsCross(a, b, ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

export function dedupeRing(ring: Pt[], eps = 1e-9): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > eps || Math.abs(last[1] - p[1]) > eps) out.push(p);
  }
  if (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) <= eps && Math.abs(f[1] - l[1]) <= eps) out.pop();
  }
  return out;
}

export function rotatePoints(points: Pt[], about: Pt, deg: number): Pt[] {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return points.map(([x, y]) => {
    const dx = x - about[0];
    const dy = y - about[1];
    return [about[0] + dx * c - dy * s, about[1] + dx * s + dy * c] as Pt;
  });
}

/** Rectangle centred on `c`, w x h, rotated clockwise (screen space, y down) by deg. */
export function rectAround(c: Pt, w: number, h: number, deg: number): Pt[] {
  const r: Pt[] = [
    [c[0] - w / 2, c[1] - h / 2],
    [c[0] + w / 2, c[1] - h / 2],
    [c[0] + w / 2, c[1] + h / 2],
    [c[0] - w / 2, c[1] + h / 2],
  ];
  return rotatePoints(r, c, deg);
}

/** Ramer-Douglas-Peucker on an open polyline. */
function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  let dmax = 0;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], a, b);
    if (d > dmax) {
      dmax = d;
      idx = i;
    }
  }
  if (dmax <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

/** Simplify a closed ring. */
export function simplifyRing(ring: Pt[], eps: number): Pt[] {
  if (ring.length < 4) return ring;
  // Split at the two points furthest apart so both halves are open polylines.
  let ia = 0;
  let ib = 0;
  let dmax = -1;
  const step = Math.max(1, Math.floor(ring.length / 200));
  for (let i = 0; i < ring.length; i += step) {
    for (let j = i + 1; j < ring.length; j += step) {
      const d = Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
      if (d > dmax) {
        dmax = d;
        ia = i;
        ib = j;
      }
    }
  }
  const first = ring.slice(ia, ib + 1);
  const second = [...ring.slice(ib), ...ring.slice(0, ia + 1)];
  const out = [...rdp(first, eps).slice(0, -1), ...rdp(second, eps).slice(0, -1)];
  return out.length >= 3 ? out : ring;
}
