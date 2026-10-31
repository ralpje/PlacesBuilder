import { area, distToRing, pointInPolygon, pointOnSurface, selfIntersects } from './geometry.ts';
import { includedFloors } from './imdf.ts';
import { descendantsOfFloor } from './places.ts';
import type { FloorDoc, OfficeDoc, PlanFeature, PlacesItem, Problem, ValidationReport } from './types.ts';

const EXPECTED_TYPES: Record<string, string[] | undefined> = {
  unit: ['room'],
  section: ['section'],
  workspace: ['space', 'workspace'],
};

/** Checks everything that would make Places reject the package, plus things that are likely mistakes. */
export function validateProject(office: OfficeDoc, allFloors: FloorDoc[]): ValidationReport {
  const problems: Problem[] = [];
  const add = (level: Problem['level'], message: string, floorId?: string, featureId?: string) =>
    problems.push({ level, message, floorId, featureId });

  const places = office.places;
  const items = new Map<string, PlacesItem>((places?.items ?? []).map((i) => [i.placeId, i]));

  // Office level
  const a = office.address;
  if (!office.name.trim()) add('error', 'The office needs a name.');
  if (!a.street.trim() || !a.city.trim() || !a.postalCode.trim()) add('error', 'The address needs street, postal code and city.');
  if (!/^[A-Za-z]{2}$/.test(a.country.trim())) add('error', 'The country must be a two-letter code such as NL.');
  const buildingPlaceId = office.placesBuildingId ?? places?.buildingPlaceId;
  if (!buildingPlaceId) add('error', 'The building is not linked to a Places building. Import the Places export first.');

  const floors = includedFloors(allFloors);
  for (const f of allFloors) {
    if (!floors.includes(f)) {
      const missing = [!f.plan && 'a plan', !f.georef && 'a map position', !f.features.some((x) => x.kind === 'outline') && 'an outline']
        .filter(Boolean)
        .join(', ');
      add('warning', `Floor "${f.name}" is left out of the export. It still needs ${missing}.`, f.id);
    }
  }
  if (floors.length === 0) add('error', 'No floor is ready to export yet.');

  const ordinals = new Map<number, string>();
  const usedPlaces = new Map<string, string>();
  const stats = { floors: floors.length, units: 0, sections: 0, workspaces: 0, desks: 0, matched: 0 };

  for (const f of floors) {
    const g = f.georef!;
    if (!(g.metersPerPixel > 0.001 && g.metersPerPixel < 5)) add('error', `Floor "${f.name}": the plan scale looks wrong (${g.metersPerPixel} m per pixel).`, f.id);
    if (Math.abs(g.lat) > 85 || Math.abs(g.lon) > 180) add('error', `Floor "${f.name}": the map position is not a valid coordinate.`, f.id);
    if (!Number.isInteger(f.ordinal)) add('error', `Floor "${f.name}": the ordinal must be a whole number.`, f.id);
    const clash = ordinals.get(f.ordinal);
    if (clash) add('error', `Floors "${clash}" and "${f.name}" use the same ordinal ${f.ordinal}. Every floor needs its own number, equal to its Places SortOrder: fix the SortOrder in Places and import the export again, or change the ordinal in the floor list on the office page.`, f.id);
    ordinals.set(f.ordinal, f.name);

    if (!f.placesFloorId) {
      add('error', `Floor "${f.name}" is not linked to a Places floor. Building and all floors must be correlated.`, f.id);
    } else {
      const pf = items.get(f.placesFloorId);
      if (!pf) add('error', `Floor "${f.name}" is linked to a Places floor that is not in the imported export.`, f.id);
      else if (pf.sortOrder !== undefined && pf.sortOrder !== f.ordinal) {
        add('error', `Floor "${f.name}": ordinal ${f.ordinal} must equal the Places SortOrder ${pf.sortOrder}.`, f.id);
      }
    }

    const outlines = f.features.filter((x) => x.kind === 'outline');
    if (outlines.length > 1) add('error', `Floor "${f.name}" has ${outlines.length} outlines; keep exactly one.`, f.id);
    const outline = outlines[0];
    if (selfIntersects(outline.points)) add('error', `Floor "${f.name}": the outline crosses itself.`, f.id, outline.id);
    if (area(outline.points) < 1) add('error', `Floor "${f.name}": the outline has no area.`, f.id, outline.id);

    const sections = f.features.filter((x) => x.kind === 'section');
    for (const x of f.features) {
      if (x.kind === 'outline') continue;
      const label = `${kindLabel(x)} "${x.name || x.label || x.id.slice(0, 8)}" on floor "${f.name}"`;
      if (x.points.length < 3) {
        add('error', `${label} has fewer than 3 points.`, f.id, x.id);
        continue;
      }
      if (area(x.points) < 1) add('error', `${label} has no area.`, f.id, x.id);
      if (selfIntersects(x.points)) add('error', `${label} crosses itself.`, f.id, x.id);
      if (!inside(x.points, outline.points)) add('warning', `${label} reaches outside the floor outline.`, f.id, x.id);

      if (x.kind === 'unit') stats.units++;
      if (x.kind === 'section') stats.sections++;
      if (x.kind === 'workspace') stats.workspaces++;
      if (x.kind === 'desk') stats.desks++;

      if (x.kind === 'workspace' && !sections.some((s) => pointInPolygon(pointOnSurface(x.points), s.points))) {
        add('warning', `${label} is not inside a section. Places expects workspaces to sit in a section.`, f.id, x.id);
      }

      if (x.placesId) {
        stats.matched++;
        const it = items.get(x.placesId);
        const prev = usedPlaces.get(x.placesId);
        if (prev) add('error', `${label} uses a Places item that is already linked to ${prev}.`, f.id, x.id);
        usedPlaces.set(x.placesId, label);
        if (!it) add('error', `${label} is linked to a Places item that is not in the imported export.`, f.id, x.id);
        else {
          const expected = EXPECTED_TYPES[x.kind];
          if (expected && !expected.includes(it.type.toLowerCase())) {
            add('warning', `${label} is linked to "${it.name}", which is a ${it.type} in Places.`, f.id, x.id);
          }
        }
      }
    }

    // Places rooms on this floor that nobody mapped yet.
    if (places && f.placesFloorId) {
      const mapped = new Set(f.features.map((x) => x.placesId).filter(Boolean) as string[]);
      const open = descendantsOfFloor(places, f.placesFloorId).filter(
        (i) => i.type.toLowerCase() === 'room' && !mapped.has(i.placeId),
      );
      if (open.length) {
        const sample = open.slice(0, 5).map((i) => i.name).join(', ');
        add('warning', `Floor "${f.name}": ${open.length} Places room(s) are not mapped yet (${sample}${open.length > 5 ? ', …' : ''}).`, f.id);
      }
    }
  }

  // Places floors that have no map at all
  if (places) {
    const exported = new Set(floors.map((f) => f.placesFloorId).filter(Boolean));
    for (const i of places.items) {
      if (i.type.toLowerCase() === 'floor' && !exported.has(i.placeId)) {
        add('info', `Places floor "${i.name}" has no map in this export.`);
      }
    }
  }

  return { ok: !problems.some((p) => p.level === 'error'), problems, stats };
}

function kindLabel(x: PlanFeature): string {
  return x.kind === 'unit' ? 'Room' : x.kind === 'workspace' ? 'Workspace' : x.kind === 'section' ? 'Section' : 'Desk';
}

/** All vertices inside the outline, allowing 3 px of slack for hand-drawn edges. */
function inside(ring: PlanFeature['points'], outline: PlanFeature['points']): boolean {
  return ring.every((p) => pointInPolygon(p, outline) || distToRing(p, outline) <= 3);
}
