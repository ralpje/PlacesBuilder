import { parseCsv } from './csv.ts';
import type { Address, PlacesImport, PlacesItem } from './types.ts';

export interface ParsedPlaces {
  places: PlacesImport;
  buildingName?: string;
  address?: Partial<Address>;
  warnings: string[];
}

const REQUIRED = ['placeid', 'displayname', 'type', 'parentid'];

/**
 * Reads the CSV written by `Get-PlaceV3 -AncestorId <building> | Export-Csv`.
 * Columns are found by header name. Only the columns the app needs are kept: the export also contains
 * booking policies, delegates and user names, which are dropped here and never stored.
 */
export function parsePlacesCsv(text: string, now: string = new Date().toISOString()): ParsedPlaces {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The CSV file is empty.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) {
    throw new Error(`This does not look like a Get-PlaceV3 export. Missing column(s): ${missing.join(', ')}.`);
  }
  const col = (name: string) => header.indexOf(name);
  const idx = {
    id: col('placeid'),
    name: col('displayname'),
    type: col('type'),
    parent: col('parentid'),
    features: col('features'),
    capacity: col('capacity'),
    street: col('street'),
    postal: col('postalcode'),
    city: col('city'),
    country: col('countryorregion'),
    state: col('state'),
  };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');

  const warnings: string[] = [];
  const items: PlacesItem[] = [];
  let buildingRow: string[] | undefined;
  const buildings: string[] = [];

  for (const r of rows.slice(1)) {
    const placeId = get(r, idx.id);
    if (!placeId) continue;
    const type = get(r, idx.type);
    const item: PlacesItem = { placeId, name: get(r, idx.name), type, parentId: get(r, idx.parent) };
    const cap = parseInt(get(r, idx.capacity), 10);
    if (Number.isFinite(cap)) item.capacity = cap;
    if (type.toLowerCase() === 'floor') {
      const so = readSortOrder(get(r, idx.features));
      if (so !== undefined) item.sortOrder = so;
      else warnings.push(`Floor "${item.name}" has no SortOrder in the export. Set one in Places (it must be unique per floor) and export again; until then the number in the floor name is used, if it has one.`);
    }
    if (type.toLowerCase() === 'building') {
      buildings.push(placeId);
      buildingRow ??= r;
    }
    items.push(item);
  }
  if (items.length === 0) throw new Error('No rows with a PlaceId were found.');
  const bySort = new Map<number, string[]>();
  for (const i of items) {
    if (i.type.toLowerCase() === 'floor' && i.sortOrder !== undefined) bySort.set(i.sortOrder, [...(bySort.get(i.sortOrder) ?? []), i.name]);
  }
  for (const [so, names] of bySort) {
    if (names.length > 1) {
      warnings.push(`Floors ${names.map((n) => `"${n}"`).join(', ')} all have SortOrder ${so} in the export. Give each floor its own SortOrder in Places and export again, because the IMDF level ordinal must equal it.`);
    }
  }
  if (buildings.length > 1) {
    warnings.push(`The export contains ${buildings.length} buildings. Export one building at a time; the first one is used.`);
  }

  const result: ParsedPlaces = {
    places: { importedAt: now, items },
    warnings,
  };
  if (buildingRow) {
    result.places.buildingPlaceId = get(buildingRow, idx.id);
    result.buildingName = get(buildingRow, idx.name);
    result.address = {
      street: get(buildingRow, idx.street),
      postalCode: get(buildingRow, idx.postal),
      city: get(buildingRow, idx.city),
      country: get(buildingRow, idx.country).toUpperCase(),
      province: get(buildingRow, idx.state),
    };
  } else {
    warnings.push('The export has no Building row, so the address could not be read.');
  }
  return result;
}

function readSortOrder(features: string): number | undefined {
  if (!features) return undefined;
  try {
    const o = JSON.parse(features) as Record<string, unknown>;
    const v = o.SortOrder ?? o.sortOrder;
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

/** Children of a Places item, optionally filtered by type (case-insensitive). */
export function childrenOf(places: PlacesImport, parentId: string, ...types: string[]): PlacesItem[] {
  const t = types.map((x) => x.toLowerCase());
  return places.items.filter((i) => i.parentId === parentId && (t.length === 0 || t.includes(i.type.toLowerCase())));
}

/**
 * Every item below a floor: its rooms, its sections and what sits in those sections.
 * Used to offer only relevant Places items in the editor.
 */
export function descendantsOfFloor(places: PlacesImport, floorPlaceId: string): PlacesItem[] {
  const out: PlacesItem[] = [];
  const queue = [floorPlaceId];
  const seen = new Set<string>(queue);
  while (queue.length) {
    const p = queue.shift()!;
    for (const i of places.items) {
      if (i.parentId === p && !seen.has(i.placeId)) {
        seen.add(i.placeId);
        out.push(i);
        queue.push(i.placeId);
      }
    }
  }
  return out;
}

/** Best guess for a floor ordinal when Places gives none: the leading whole number in the name ("5", "8 - Marokko"). */
export function ordinalFromName(name: string): number | undefined {
  const m = /^\s*(-?\d{1,3})(?!\d)/.exec(name);
  return m ? parseInt(m[1]!, 10) : undefined;
}
