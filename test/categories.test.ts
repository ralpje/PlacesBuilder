import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATEGORY_GROUPS, UNIT_CATEGORIES, UNIT_CATEGORY_CATALOG, categoryInfo, exportUnitCategory, isUnitCategory } from '../src/shared/categories.ts';
import { buildImdf } from '../src/shared/imdf.ts';
import { validateProject } from '../src/shared/validate.ts';
import { LocalStorage } from '../src/server/storage.ts';
import { Repo } from '../src/server/repo.ts';
import { NO_LIMITS } from '../src/server/config.ts';
import { feat, makeFloor, makeOffice, rect } from './helpers.ts';

// IMDF 1.0 unit categories (OGC community standard 20-094, Categories page, read 6 November 2026).
const IMDF_UNIT_CATEGORIES = new Set(
  ('auditorium brick classroom column concrete conferenceroom drywall elevator escalator fieldofplay firstaid fitnessroom foodservice footbridge glass ' +
    'huddleroom kitchen laboratory library lobby lounge mailroom mothersroom movietheater movingwalkway nonpublic office opentobelow parking phoneroom ' +
    'platform privatelounge ramp recreation restroom restroom.family restroom.female restroom.female.wheelchair restroom.male restroom.male.wheelchair ' +
    'restroom.transgender restroom.transgender.wheelchair restroom.unisex restroom.unisex.wheelchair restroom.wheelchair road room serverroom shower ' +
    'smokingarea stairs steps storage structure terrace theater unenclosedarea unspecified vegetation waitingroom walkway walkway.island wood').split(' '),
);

const NOW = '2026-11-06T12:00:00Z';
const unitCategories = (files: Record<string, string>) =>
  (JSON.parse(files['unit.geojson']) as { features: { properties: { category: string; name: { en?: string } | null } }[] }).features.map((u) => [u.properties.name?.en, u.properties.category]);

test('the IMDF reference list has the 63 unit categories', () => {
  assert.equal(IMDF_UNIT_CATEGORIES.size, 63);
});

test('every catalog category is a valid IMDF unit category, listed once, with a label, group and note', () => {
  assert.equal(new Set(UNIT_CATEGORIES).size, UNIT_CATEGORIES.length);
  for (const c of UNIT_CATEGORY_CATALOG) {
    assert.ok(IMDF_UNIT_CATEGORIES.has(c.value), `${c.value} is not an IMDF unit category`);
    assert.ok(c.label.trim() && c.note.trim(), c.value);
    assert.ok(CATEGORY_GROUPS.includes(c.group), c.value);
    assert.ok(['icon', 'named', 'imdf'].includes(c.support), c.value);
  }
  // workspace and desk are Places conventions with their own feature kinds, not unit categories to pick
  assert.ok(!isUnitCategory('workspace') && !isUnitCategory('desk'));
});

test('restrooms can be labelled and have an icon; a coffee corner is a kitchen, and no fake coffee category exists', () => {
  assert.equal(categoryInfo('restroom')?.support, 'icon');
  assert.equal(categoryInfo('elevator')?.support, 'icon');
  assert.equal(categoryInfo('stairs')?.support, 'icon');
  assert.match(categoryInfo('kitchen')!.label, /coffee/i);
  assert.ok(!isUnitCategory('coffee') && !isUnitCategory('coffeecorner'));
});

test('exportUnitCategory: catalog value stays, empty becomes room, anything else unspecified', () => {
  assert.equal(exportUnitCategory('restroom'), 'restroom');
  assert.equal(exportUnitCategory(''), 'room');
  assert.equal(exportUnitCategory(undefined), 'room');
  assert.equal(exportUnitCategory('coffee'), 'unspecified');
  assert.equal(exportUnitCategory('restroom.female'), 'unspecified'); // valid IMDF, but not offered until verified in Places
});

test('the exporter writes catalog categories as they are and warns when it has to replace one', () => {
  const floor = makeFloor();
  floor.features.push(
    feat({ id: 'u1', kind: 'unit', category: 'restroom', name: 'WC', points: rect(10, 10, 60, 60) }),
    feat({ id: 'u2', kind: 'unit', category: 'kitchen', name: 'Coffee corner', placesId: 'P-COFFEE', points: rect(80, 10, 140, 60) }),
    feat({ id: 'u3', kind: 'unit', category: 'coffee', name: 'Bar', placesId: 'P-BAR', points: rect(160, 10, 220, 60) }),
  );
  const r = buildImdf(makeOffice(), [floor], { now: NOW });
  const cats = new Map(unitCategories(r.files) as [string, string][]);
  assert.equal(cats.get('WC'), 'restroom');
  assert.equal(cats.get('Coffee corner'), 'kitchen');
  assert.equal(cats.get('Bar'), 'unspecified');
  const w = r.warnings.filter((x) => x.includes('does not support'));
  assert.equal(w.length, 1);
  assert.match(w[0], /"Bar".*"coffee"/);
  assert.ok(r.correlation.some((c) => c.name === 'Coffee corner' && c.category === 'kitchen'));
  assert.ok(r.correlation.some((c) => c.name === 'Bar' && c.category === 'unspecified'));
});

test('workspaces and desks exported as units keep their Places categories, whatever the feature says', () => {
  const floor = makeFloor();
  floor.features.push(feat({ id: 'w9', kind: 'workspace', category: 'coffee', name: 'Pool', points: rect(300, 10, 360, 60) }));
  const r = buildImdf(makeOffice(), [floor], { now: NOW });
  assert.ok(unitCategories(r.files).some(([n, c]) => n === 'Pool' && c === 'workspace'));
  assert.ok(!r.warnings.some((x) => x.includes('does not support')));
});

test('the validator warns about an unsupported unit category and stays quiet for a supported one', () => {
  const bad = makeFloor();
  bad.features.push(feat({ id: 'u3', kind: 'unit', category: 'coffee', name: 'Bar', points: rect(160, 10, 220, 60) }));
  const w = validateProject(makeOffice(), [bad]).problems.filter((p) => p.message.includes('does not support'));
  assert.equal(w.length, 1);
  assert.equal(w[0].level, 'warning');
  assert.equal(w[0].featureId, 'u3');
  const good = makeFloor();
  good.features.push(feat({ id: 'u4', kind: 'unit', category: 'lounge', name: 'Break-out', points: rect(160, 10, 220, 60) }));
  assert.equal(validateProject(makeOffice(), [good]).problems.filter((p) => p.message.includes('does not support')).length, 0);
});

test('saving a floor stores an unsupported unit category as unspecified and leaves other kinds alone', async () => {
  const repo = new Repo(new LocalStorage(await mkdtemp(join(tmpdir(), 'pb-cat-'))), NO_LIMITS);
  const office = await repo.createOffice({ name: 'HQ' });
  const floor = await repo.createFloor(office.id, { name: '1', ordinal: 1 });
  const saved = await repo.saveFloor(office.id, floor.id, {
    rev: floor.rev,
    features: [
      { id: 'a1', kind: 'unit', category: 'coffee', name: 'Bar', points: [[0, 0], [10, 0], [10, 10], [0, 10]] },
      { id: 'a2', kind: 'unit', category: 'restroom', name: 'WC', points: [[20, 0], [30, 0], [30, 10], [20, 10]] },
      { id: 'a3', kind: 'unit', category: '', name: 'Empty', points: [[40, 0], [50, 0], [50, 10], [40, 10]] },
      { id: 'a4', kind: 'desk', category: 'desk', name: 'D', points: [[60, 0], [70, 0], [70, 10], [60, 10]] },
    ],
  });
  const cat = (id: string) => saved.features.find((f) => f.id === id)?.category;
  assert.equal(cat('a1'), 'unspecified');
  assert.equal(cat('a2'), 'restroom');
  assert.equal(cat('a3'), 'room');
  assert.equal(cat('a4'), 'desk');
});
