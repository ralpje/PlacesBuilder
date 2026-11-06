import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_ID_PLACEHOLDER, placesCommands, placesScript, safePlaceId } from '../src/shared/psCommands.ts';

const all = (id?: string) => placesCommands({ buildingPlaceId: id }).flatMap((g) => g.steps);

test('building id is filled into export, remove and upload commands', () => {
  const s = placesScript({ buildingPlaceId: 'b1-2c.d@x' });
  assert.match(s, /Get-PlaceV3 -AncestorId 'b1-2c\.d@x' \| Export-Csv/);
  assert.match(s, /Remove-Map -BuildingId 'b1-2c\.d@x'/);
  assert.match(s, /New-Map -BuildingId 'b1-2c\.d@x' -FilePath/);
});

test('without an id the placeholder stays', () => {
  assert.ok(all().some((s) => s.command.includes(`'${BUILDING_ID_PLACEHOLDER}'`)));
});

test('ids with unsafe characters never reach a command', () => {
  for (const bad of ["x'; Remove-Item *; '", 'a b', '$(calc)', 'a`b', '', 'a'.repeat(129)]) {
    assert.equal(safePlaceId(bad), BUILDING_ID_PLACEHOLDER);
    assert.ok(!placesScript({ buildingPlaceId: bad }).includes(bad.trim() || '\u0000'));
  }
});

test('covers the documented cmdlets', () => {
  const s = placesScript();
  for (const c of ['Install-Module -Name MicrosoftPlaces', 'Connect-MicrosoftPlaces', "Set-PlacesSettings -EnableBuildings 'Default:true'", 'Get-PlaceV3 -Type Building', 'New-Map', 'Remove-Map', 'Import-MapCorrelations']) {
    assert.ok(s.includes(c), c);
  }
});
