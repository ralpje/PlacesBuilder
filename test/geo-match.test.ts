import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bearingDeg,
  cornersLonLat,
  distanceMeters,
  lonLatToPlan,
  metersPerPixelFromSheetScale,
  planToLonLat,
} from '../src/shared/georef.ts';
import { rectAround, selfIntersects, simplifyRing, pointOnSurface, pointInPolygon } from '../src/shared/geometry.ts';
import { nameCode, normalizeName, similarity, suggest } from '../src/shared/match.ts';
import { stableUuid } from '../src/shared/ids.ts';
import type { GeoRef, Pt } from '../src/shared/types.ts';

const g: GeoRef = { lon: 4.69, lat: 52.3, rotationDeg: 37, metersPerPixel: 0.07 };

test('plan <-> lon/lat round trip', () => {
  for (const p of [[0, 0], [1000, 600], [333.3, 12.5]] as Pt[]) {
    const back = lonLatToPlan(g, 1000, 600, planToLonLat(g, 1000, 600, p));
    assert.ok(Math.abs(back[0] - p[0]) < 1e-5 && Math.abs(back[1] - p[1]) < 1e-5, `${p} -> ${back}`);
  }
});

test('rotation is clockwise: with 90 degrees the top of the plan points east', () => {
  const r: GeoRef = { ...g, rotationDeg: 90 };
  const centre: [number, number] = [r.lon, r.lat];
  const top = planToLonLat(r, 1000, 600, [500, 0]);
  assert.ok(Math.abs(bearingDeg(centre, top) - 90) < 0.01);
  assert.ok(Math.abs(distanceMeters(centre, top) - 300 * 0.07) < 0.01);
  const north = planToLonLat({ ...g, rotationDeg: 0 }, 1000, 600, [500, 0]);
  assert.ok(Math.abs(bearingDeg(centre, north) - 0) < 0.01 || Math.abs(bearingDeg(centre, north) - 360) < 0.01);
});

test('image corners have the expected real-world size', () => {
  const [tl, tr, , bl] = cornersLonLat({ ...g, rotationDeg: 0 }, 1000, 600);
  assert.ok(Math.abs(distanceMeters(tl, tr) - 70) < 0.05);
  assert.ok(Math.abs(distanceMeters(tl, bl) - 42) < 0.05);
});

test('sheet scale 1:200 at one render pixel per PDF point is about 0.0706 m per pixel', () => {
  assert.ok(Math.abs(metersPerPixelFromSheetScale(200, 1) - 0.07056) < 1e-4);
  assert.ok(Math.abs(metersPerPixelFromSheetScale(200, 4) - 0.01764) < 1e-4);
});

test('geometry helpers', () => {
  assert.equal(selfIntersects([[0, 0], [2, 2], [2, 0], [0, 2]]), true);
  assert.equal(selfIntersects([[0, 0], [2, 0], [2, 2], [0, 2]]), false);
  const ring = rectAround([10, 10], 4, 2, 90);
  assert.ok(Math.abs(ring[0][0] - 11) < 1e-9);
  // a C-shape: the centroid is outside, pointOnSurface must be inside
  const c: Pt[] = [[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10]];
  assert.ok(pointInPolygon(pointOnSurface(c), c));
  const dense: Pt[] = [];
  for (let i = 0; i <= 100; i++) dense.push([i, 0]);
  dense.push([100, 50], [0, 50]);
  assert.ok(simplifyRing(dense, 0.5).length <= 6);
});

test('name matching copes with codes, spacing and accents', () => {
  assert.equal(normalizeName('1.1  - ORY'), '1.1 ory');
  assert.equal(nameCode('8.1 - Casablanca'), '8.1');
  assert.equal(nameCode('Auditorium'), undefined);
  assert.ok(similarity('Casablanca', '8.1 - Casablanca') >= 0.95);
  assert.ok(similarity('8.1', '8.1 - Casablanca') >= 0.9);
  assert.ok(similarity('Italië', '6 - Italie') > 0.8);
  assert.ok(similarity('Agadir', '8.1 - Casablanca') < 0.5);
  const items = [
    { placeId: 'a', name: '8.1 - Casablanca', type: 'Room', parentId: 'f' },
    { placeId: 'b', name: '8.2 - Marrakesh', type: 'Room', parentId: 'f' },
  ];
  assert.equal(suggest('marrakesh', items)[0].item.placeId, 'b');
  assert.equal(suggest('marrakesh', items, new Set(['b'])).length, 0);
  assert.equal(suggest('', items).length, 0);
});

test('stableUuid is deterministic and uuid-shaped', () => {
  assert.equal(stableUuid('x'), stableUuid('x'));
  assert.notEqual(stableUuid('x'), stableUuid('y'));
  assert.match(stableUuid('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
