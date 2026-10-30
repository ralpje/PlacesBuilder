import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImdf, correlationCsv } from '../src/shared/imdf.ts';
import { validateProject } from '../src/shared/validate.ts';
import { signedArea } from '../src/shared/geometry.ts';
import { parseCsv } from '../src/shared/csv.ts';
import { feat, makeFloor, makeOffice, rect } from './helpers.ts';

const NOW = '2026-10-30T12:00:00Z';
const parse = (s: string) => JSON.parse(s) as { features: { id: string; feature_type: string; geometry: any; properties: any }[] };

test('buildImdf writes the expected files at the zip root', () => {
  const r = buildImdf(makeOffice(), [makeFloor()], { now: NOW });
  assert.deepEqual(Object.keys(r.files).sort(), [
    'address.geojson',
    'building.geojson',
    'fixture.geojson',
    'footprint.geojson',
    'level.geojson',
    'manifest.json',
    'section.geojson',
    'unit.geojson',
    'venue.geojson',
  ]);
  for (const name of Object.keys(r.files)) assert.ok(!name.includes('/'), name);
  assert.equal(JSON.parse(r.files['manifest.json']).version, '1.0.0');
});

test('levels, units and sections follow the model', () => {
  const r = buildImdf(makeOffice(), [makeFloor()], { now: NOW });
  const level = parse(r.files['level.geojson']).features[0];
  assert.equal(level.properties.ordinal, 8);
  assert.equal(level.properties.name.en, '8 - Marokko');
  const unit = parse(r.files['unit.geojson']).features;
  // room + workspace (the desk is a fixture by default)
  assert.deepEqual(unit.map((u) => u.properties.category).sort(), ['room', 'workspace']);
  // Places display name is used for matched features
  assert.equal(unit.find((u) => u.id === 'u1')!.properties.name.en, '8.1 - Casablanca');
  assert.equal(unit.find((u) => u.id === 'u1')!.properties.level_id, level.id);
  const fixture = parse(r.files['fixture.geojson']).features[0];
  assert.equal(fixture.properties.category, 'desk');
  // desk rotation 10 deg in the plan frame + map rotation 30
  assert.equal(fixture.properties.rotation, 40);
  const section = parse(r.files['section.geojson']).features[0];
  assert.equal(section.properties.name.en, 'TestSection');
});

test('polygons are closed, counter-clockwise and located near the anchor', () => {
  const r = buildImdf(makeOffice(), [makeFloor()], { now: NOW });
  for (const file of ['level.geojson', 'unit.geojson', 'section.geojson', 'fixture.geojson', 'footprint.geojson']) {
    for (const f of parse(r.files[file]).features) {
      const ring = f.geometry.coordinates[0] as [number, number][];
      assert.deepEqual(ring[0], ring[ring.length - 1], `${file} closed`);
      assert.ok(signedArea(ring.slice(0, -1)) > 0, `${file} counter-clockwise`);
      for (const [lon, lat] of ring) assert.ok(Math.abs(lon - 4.69) < 0.01 && Math.abs(lat - 52.3) < 0.01);
    }
  }
});

test('address maps the Dutch province to an ISO code; building geometry is null', () => {
  const r = buildImdf(makeOffice(), [makeFloor()], { now: NOW });
  const a = parse(r.files['address.geojson']).features[0].properties;
  assert.equal(a.province, 'NL-NH');
  assert.equal(a.locality, 'Hoofddorp');
  assert.equal(parse(r.files['building.geojson']).features[0].geometry, null);
});

test('ids are stable between builds', () => {
  const a = buildImdf(makeOffice(), [makeFloor()], { now: NOW });
  const b = buildImdf(makeOffice(), [makeFloor()], { now: '2027-01-01T00:00:00Z' });
  assert.equal(a.files['level.geojson'], b.files['level.geojson']);
  assert.equal(a.files['unit.geojson'], b.files['unit.geojson']);
});

test('desks can be exported as units instead of fixtures', () => {
  const r = buildImdf(makeOffice(), [makeFloor()], { now: NOW, desksAs: 'unit' });
  assert.ok(!('fixture.geojson' in r.files));
  const cats = parse(r.files['unit.geojson']).features.map((u) => u.properties.category).sort();
  assert.deepEqual(cats, ['desk', 'room', 'workspace']);
});

test('correlation rows list building, level and every linked feature', () => {
  const r = buildImdf(makeOffice(), [makeFloor()], { now: NOW });
  const byFile = r.correlation.map((c) => `${c.file}:${c.placesId}`).sort();
  assert.deepEqual(byFile, [
    'building.geojson:B',
    'level.geojson:F8',
    'section.geojson:S1',
    'unit.geojson:R1',
    'unit.geojson:W1',
  ]);
  const csv = parseCsv(correlationCsv(r.correlation));
  assert.equal(csv[0][4], 'PlaceId');
  assert.equal(csv.length, 6);
});

test('floors without plan, position or outline are left out; no usable floor throws', () => {
  const unfinished = makeFloor({ id: 'fl1', name: '1 - Bases', ordinal: 1, placesFloorId: 'F1', georef: undefined });
  const r = buildImdf(makeOffice(), [makeFloor(), unfinished], { now: NOW });
  assert.equal(r.includedFloorIds.length, 1);
  assert.match(r.warnings.join(' '), /1 - Bases/);
  assert.throws(() => buildImdf(makeOffice(), [unfinished]), /No floor/);
});

test('valid project has no errors; unmapped Places room is reported as a warning', () => {
  const v = validateProject(makeOffice(), [makeFloor()]);
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  assert.match(v.problems.map((p) => p.message).join('\n'), /8\.2 - Marrakesh/);
  assert.deepEqual(v.stats, { floors: 1, units: 1, sections: 1, workspaces: 1, desks: 1, matched: 3 });
});

test('validation catches the problems Places would reject', () => {
  const msgs = (o: ReturnType<typeof makeOffice>, f: ReturnType<typeof makeFloor>[]) =>
    validateProject(o, f).problems.filter((p) => p.level === 'error').map((p) => p.message).join('\n');

  assert.match(msgs(makeOffice(), [makeFloor({ ordinal: 7 })]), /must equal the Places SortOrder 8/);
  assert.match(msgs(makeOffice(), [makeFloor({ placesFloorId: undefined })]), /not linked to a Places floor/);
  assert.match(msgs(makeOffice({ placesBuildingId: undefined, places: undefined }), [makeFloor({ placesFloorId: undefined })]), /Places building/);

  const bowtie = makeFloor();
  bowtie.features.push(feat({ id: 'bad', kind: 'unit', points: [[0, 0], [100, 100], [100, 0], [0, 100]] }));
  assert.match(msgs(makeOffice(), [bowtie]), /crosses itself/);

  const dup = makeFloor();
  dup.features.push(feat({ id: 'u2', kind: 'unit', points: rect(100, 300, 200, 400), placesId: 'R1' }));
  assert.match(msgs(makeOffice(), [dup]), /already linked/);

  const ghost = makeFloor();
  ghost.features.push(feat({ id: 'u3', kind: 'unit', points: rect(100, 300, 200, 400), placesId: 'NOPE' }));
  assert.match(msgs(makeOffice(), [ghost]), /not in the imported export/);
});

test('validation warns about workspaces outside sections and features outside the outline', () => {
  const f = makeFloor();
  f.features.push(feat({ id: 'ws2', kind: 'workspace', category: 'workspace', points: rect(50, 400, 150, 500) }));
  f.features.push(feat({ id: 'out', kind: 'unit', points: rect(900, 500, 1100, 650) }));
  const w = validateProject(makeOffice(), [f]).problems.filter((p) => p.level === 'warning').map((p) => p.message).join('\n');
  assert.match(w, /not inside a section/);
  assert.match(w, /outside the floor outline/);
});
