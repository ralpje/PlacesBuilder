import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { detectDelimiter, parseCsv, toCsv } from '../src/shared/csv.ts';
import { descendantsOfFloor, ordinalFromName, parsePlacesCsv } from '../src/shared/places.ts';

test('parseCsv handles quotes, doubled quotes, newlines and BOM', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', 'line1\nline2'],
  ]);
});

test('detects semicolon delimiter and round-trips toCsv', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv(toCsv([['a', 'b,c'], ['"q"', 'z']])), [['a', 'b,c'], ['"q"', 'z']]);
});

const SYNTH = [
  'PlaceId,DisplayName,Type,Identity,PostalCode,CountryOrRegion,State,City,Street,ParentId,Features,Capacity,BookInPolicy',
  'B1,Scorpius,Building,x,2132 LR,NL,Noord-Holland,Hoofddorp,Scorpius 1,,"{ }",,secret-person@example.com',
  'F8,8 - Marokko,Floor,x,,,,,,B1,"{ ""SortOrder"": ""8"" }",,',
  'R1,8.1 - Casablanca,Room,mr-sc-801@example.com,,BE,,,,F8,"{ ""IsManaged"": ""True"" }",10,/o=Exchange/cn=Recipients/cn=person',
  'S1,TestSection,Section,x,,,,,,F8,"{ }",,',
  'W1,Test Desk Pool,Space,x,,,,,,S1,"{ }",6,',
].join('\r\n');

test('parsePlacesCsv keeps only needed columns and reads address and SortOrder', () => {
  const r = parsePlacesCsv(SYNTH, 'NOW');
  assert.equal(r.places.items.length, 5);
  assert.equal(r.places.buildingPlaceId, 'B1');
  assert.deepEqual(r.address, {
    street: 'Scorpius 1',
    postalCode: '2132 LR',
    city: 'Hoofddorp',
    country: 'NL',
    province: 'Noord-Holland',
  });
  const floor = r.places.items.find((i) => i.placeId === 'F8')!;
  assert.equal(floor.sortOrder, 8);
  const room = r.places.items.find((i) => i.placeId === 'R1')!;
  assert.equal(room.capacity, 10);
  // nothing from the policy/delegate/identity columns survives
  assert.ok(!JSON.stringify(r).includes('secret-person'));
  assert.ok(!JSON.stringify(r).includes('mr-sc-801'));
  assert.deepEqual(
    descendantsOfFloor(r.places, 'F8').map((i) => i.placeId).sort(),
    ['R1', 'S1', 'W1'],
  );
});

test('parsePlacesCsv rejects files that are not a Places export', () => {
  assert.throws(() => parsePlacesCsv('a,b\n1,2'), /Missing column/);
  assert.throws(() => parsePlacesCsv(''), /empty/);
});

const REAL = '/mnt/user-data/uploads/assets2.csv';
test('real Places export parses (skipped when the file is not present)', { skip: !existsSync(REAL) }, () => {
  const r = parsePlacesCsv(readFileSync(REAL, 'utf8'));
  const count = (t: string) => r.places.items.filter((i) => i.type === t).length;
  assert.equal(count('Building'), 1);
  assert.equal(count('Floor'), 7);
  assert.equal(count('Room'), 31);
  assert.equal(r.address?.city, 'Hoofddorp');
  assert.equal(r.places.items.find((i) => i.name === '8 - Marokko')?.sortOrder, 8);
  assert.ok(!JSON.stringify(r).includes('@transavia.com'));
});

test('parsePlacesCsv warns about duplicate and missing floor SortOrder', () => {
  const csv = [
    'PlaceId,DisplayName,Type,Identity,PostalCode,CountryOrRegion,State,City,Street,ParentId,Features,Capacity,BookInPolicy',
    'B1,Test,Building,x,,NL,,City,Street 1,,"{ }",,',
    'F5,5,Floor,x,,,,,,B1,"{ ""SortOrder"": ""0"" }",,',
    'F1,1,Floor,x,,,,,,B1,"{ ""SortOrder"": ""0"" }",,',
    'F2,2,Floor,x,,,,,,B1,"{ }",,',
  ].join('\r\n');
  const r = parsePlacesCsv(csv, 'NOW');
  assert.ok(r.warnings.some((w) => /"5", "1" all have SortOrder 0/.test(w)));
  assert.ok(r.warnings.some((w) => /Floor "2" has no SortOrder/.test(w)));
});

test('ordinalFromName reads a leading whole number', () => {
  assert.equal(ordinalFromName('5'), 5);
  assert.equal(ordinalFromName('8 - Marokko'), 8);
  assert.equal(ordinalFromName('-1 Parking'), -1);
  assert.equal(ordinalFromName('Ground floor'), undefined);
  assert.equal(ordinalFromName('2024 Annex'), undefined);
});
