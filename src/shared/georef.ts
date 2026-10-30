import type { GeoRef, LonLat, Pt } from './types.ts';

/** Metres per degree of latitude and longitude at a given latitude (WGS84 series expansion). */
export function metersPerDegree(latDeg: number): { lat: number; lon: number } {
  const p = (latDeg * Math.PI) / 180;
  const lat = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
  const lon = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
  return { lat, lon };
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Plan pixel -> metres east/north of the image centre, after the map rotation is applied. */
export function planToLocalMeters(g: GeoRef, w: number, h: number, p: Pt): [number, number] {
  const dx = (p[0] - w / 2) * g.metersPerPixel; // image right
  const dy = -(p[1] - h / 2) * g.metersPerPixel; // image up
  const t = rad(g.rotationDeg); // clockwise on the map
  const east = dx * Math.cos(t) + dy * Math.sin(t);
  const north = -dx * Math.sin(t) + dy * Math.cos(t);
  return [east, north];
}

export function localMetersToPlan(g: GeoRef, w: number, h: number, m: [number, number]): Pt {
  const t = rad(g.rotationDeg);
  const dx = m[0] * Math.cos(t) - m[1] * Math.sin(t);
  const dy = m[0] * Math.sin(t) + m[1] * Math.cos(t);
  return [dx / g.metersPerPixel + w / 2, -dy / g.metersPerPixel + h / 2];
}

export function planToLonLat(g: GeoRef, w: number, h: number, p: Pt): LonLat {
  const [e, n] = planToLocalMeters(g, w, h, p);
  const k = metersPerDegree(g.lat);
  return [g.lon + e / k.lon, g.lat + n / k.lat];
}

export function lonLatToPlan(g: GeoRef, w: number, h: number, ll: LonLat): Pt {
  const k = metersPerDegree(g.lat);
  return localMetersToPlan(g, w, h, [(ll[0] - g.lon) * k.lon, (ll[1] - g.lat) * k.lat]);
}

/** Corners in MapLibre image-source order: top-left, top-right, bottom-right, bottom-left. */
export function cornersLonLat(g: GeoRef, w: number, h: number): [LonLat, LonLat, LonLat, LonLat] {
  return [
    planToLonLat(g, w, h, [0, 0]),
    planToLonLat(g, w, h, [w, 0]),
    planToLonLat(g, w, h, [w, h]),
    planToLonLat(g, w, h, [0, h]),
  ];
}

/** Metres east/north from a to b. Good to centimetres over building-sized distances. */
export function offsetMeters(a: LonLat, b: LonLat): [number, number] {
  const k = metersPerDegree(a[1]);
  return [(b[0] - a[0]) * k.lon, (b[1] - a[1]) * k.lat];
}

export function distanceMeters(a: LonLat, b: LonLat): number {
  const [e, n] = offsetMeters(a, b);
  return Math.hypot(e, n);
}

/** Compass bearing from a to b in degrees clockwise from north, in [0, 360). */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const [e, n] = offsetMeters(a, b);
  return ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360;
}

export function moveLonLat(a: LonLat, east: number, north: number): LonLat {
  const k = metersPerDegree(a[1]);
  return [a[0] + east / k.lon, a[1] + north / k.lat];
}

export function normalizeDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

/**
 * Metres per rendered pixel for a plan rendered from a PDF.
 * A PDF point is 1/72 inch; a drawing at 1:scale is `scale` times larger in reality.
 */
export function metersPerPixelFromSheetScale(sheetScale: number, renderPxPerPt: number): number {
  return ((0.0254 / 72) * sheetScale) / renderPxPerPt;
}
