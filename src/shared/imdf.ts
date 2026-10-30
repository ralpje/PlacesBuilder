import { area, pointOnSurface, signedArea } from './geometry.ts';
import { normalizeDeg, planToLonLat } from './georef.ts';
import { stableUuid } from './ids.ts';
import { toCsv } from './csv.ts';
import type {
  CorrelationRow,
  DeskExportMode,
  FloorDoc,
  GeoRef,
  LonLat,
  OfficeDoc,
  PlanFeature,
  PlacesItem,
  Pt,
} from './types.ts';

/**
 * Values below are the parts of the output that come from partner documentation or from the Apple IMDF
 * spec rather than from Microsoft's own page. They are kept in one place so they can be changed after a
 * test import into a real tenant. See docs/OPEN-QUESTIONS.md.
 */
export const IMDF_ASSUMPTIONS = {
  venueCategory: 'businesscampus',
  levelCategory: 'unspecified',
  buildingCategory: 'unspecified',
  footprintCategory: 'ground',
  sectionCategory: 'unspecified',
  fixtureDeskCategory: 'desk',
  workspaceUnitCategory: 'workspace',
  deskUnitCategory: 'desk',
  unitsCarryBuildingIds: true,
} as const;

export interface ImdfOptions {
  language?: string; // language tag used for names, default "en"
  desksAs?: DeskExportMode; // default: the office setting
  includeBase?: boolean; // manifest, address and venue files; default true
  generatedBy?: string;
  now?: string; // ISO timestamp, injectable for tests
}

export interface ImdfResult {
  files: Record<string, string>; // file name -> content, written to the zip root
  correlation: CorrelationRow[];
  warnings: string[];
  includedFloorIds: string[];
}

type Geometry = { type: 'Polygon'; coordinates: LonLat[][] } | { type: 'Point'; coordinates: LonLat } | null;

interface Feature {
  type: 'Feature';
  id: string;
  feature_type: string;
  geometry: Geometry;
  properties: Record<string, unknown>;
}

const round = (n: number) => Math.round(n * 1e9) / 1e9;

const NL_PROVINCES: Record<string, string> = {
  'noord-holland': 'NL-NH',
  'zuid-holland': 'NL-ZH',
  utrecht: 'NL-UT',
  'noord-brabant': 'NL-NB',
  gelderland: 'NL-GE',
  overijssel: 'NL-OV',
  limburg: 'NL-LI',
  groningen: 'NL-GR',
  friesland: 'NL-FR',
  'fryslân': 'NL-FR',
  drenthe: 'NL-DR',
  flevoland: 'NL-FL',
  zeeland: 'NL-ZE',
};

function isoProvince(country: string, province?: string): string | null {
  if (!province) return null;
  if (/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(province)) return province;
  if (country === 'NL') return NL_PROVINCES[province.trim().toLowerCase()] ?? null;
  return null;
}

const feature = (id: string, featureType: string, geometry: Geometry, properties: Record<string, unknown>): Feature => ({
  type: 'Feature',
  id,
  feature_type: featureType,
  geometry,
  properties,
});

const collection = (features: Feature[]) => JSON.stringify({ type: 'FeatureCollection', features }, null, 2);

export function includedFloors(floors: FloorDoc[]): FloorDoc[] {
  return floors
    .filter((f) => f.plan && f.georef && f.features.some((x) => x.kind === 'outline' && x.points.length >= 3))
    .sort((a, b) => a.ordinal - b.ordinal);
}

/** Plan polygon -> closed, counter-clockwise GeoJSON polygon in lon/lat. */
function geoPolygon(g: GeoRef, w: number, h: number, points: Pt[]): { type: 'Polygon'; coordinates: LonLat[][] } {
  let ring = points.map((p) => planToLonLat(g, w, h, p));
  if (signedArea(ring as Pt[]) < 0) ring = ring.reverse();
  ring = ring.map(([x, y]) => [round(x), round(y)] as LonLat);
  ring.push([ring[0][0], ring[0][1]]);
  return { type: 'Polygon', coordinates: [ring] };
}

function geoPoint(g: GeoRef, w: number, h: number, p: Pt): { type: 'Point'; coordinates: LonLat } {
  const [x, y] = planToLonLat(g, w, h, p);
  return { type: 'Point', coordinates: [round(x), round(y)] };
}

export function buildImdf(office: OfficeDoc, allFloors: FloorDoc[], opts: ImdfOptions = {}): ImdfResult {
  const A = IMDF_ASSUMPTIONS;
  const lang = opts.language ?? 'en';
  const desksAs: DeskExportMode = opts.desksAs ?? office.deskExport ?? 'fixture';
  const now = opts.now ?? new Date().toISOString();
  const warnings: string[] = [];
  const names = (s: string | null | undefined) => (s ? { [lang]: s } : null);

  const floors = includedFloors(allFloors);
  for (const f of allFloors) {
    if (!floors.includes(f)) warnings.push(`Floor "${f.name}" is left out: it needs a plan, a map position and an outline.`);
  }
  if (floors.length === 0) throw new Error('No floor has a plan, a map position and an outline yet.');

  const items = new Map<string, PlacesItem>((office.places?.items ?? []).map((i) => [i.placeId, i]));
  const buildingPlaceId = office.placesBuildingId ?? office.places?.buildingPlaceId;
  const ids = {
    building: stableUuid(`building:${office.id}`),
    venue: stableUuid(`venue:${office.id}`),
    address: stableUuid(`address:${office.id}`),
    footprint: stableUuid(`footprint:${office.id}`),
  };

  const correlation: CorrelationRow[] = [];
  if (buildingPlaceId) {
    const b = items.get(buildingPlaceId);
    correlation.push({
      featureId: ids.building,
      file: 'building.geojson',
      floor: '',
      name: office.name,
      placesId: buildingPlaceId,
      placesName: b?.name ?? '',
      placesType: b?.type ?? 'Building',
    });
  }

  // Footprint: the outline of the largest floor, in real-world area.
  let footprintFloor = floors[0];
  let footprintOutline = floors[0].features.find((x) => x.kind === 'outline')!;
  let best = -1;
  for (const f of floors) {
    const o = f.features.find((x) => x.kind === 'outline')!;
    const a = area(o.points) * f.georef!.metersPerPixel ** 2;
    if (a > best) {
      best = a;
      footprintFloor = f;
      footprintOutline = o;
    }
  }
  const fg = footprintFloor.georef!;
  const fw = footprintFloor.plan!.width;
  const fh = footprintFloor.plan!.height;
  const footprintGeom = geoPolygon(fg, fw, fh, footprintOutline.points);
  const footprintPoint = geoPoint(fg, fw, fh, pointOnSurface(footprintOutline.points));

  const addr = office.address;
  const country = (addr.country || '').toUpperCase();
  const addressFeature = feature(ids.address, 'address', null, {
    address: addr.street,
    unit: null,
    locality: addr.city,
    province: isoProvince(country, addr.province),
    country,
    postal_code: addr.postalCode,
    postal_code_ext: null,
    postal_code_vanity: null,
  });
  const venueFeature = feature(ids.venue, 'venue', footprintGeom, {
    category: A.venueCategory,
    restriction: null,
    name: names(office.name),
    alt_name: null,
    hours: null,
    phone: null,
    website: null,
    display_point: footprintPoint,
    address_id: ids.address,
  });
  const buildingFeature = feature(ids.building, 'building', null, {
    name: names(office.name),
    alt_name: null,
    category: A.buildingCategory,
    restriction: null,
    display_point: footprintPoint,
    address_id: ids.address,
  });
  const footprintFeature = feature(ids.footprint, 'footprint', footprintGeom, {
    category: A.footprintCategory,
    name: null,
    building_ids: [ids.building],
  });

  const levels: Feature[] = [];
  const units: Feature[] = [];
  const sections: Feature[] = [];
  const fixtures: Feature[] = [];

  for (const f of floors) {
    const g = f.georef!;
    const w = f.plan!.width;
    const h = f.plan!.height;
    const levelId = stableUuid(`level:${f.id}`);
    const outlines = f.features.filter((x) => x.kind === 'outline');
    if (outlines.length > 1) warnings.push(`Floor "${f.name}" has ${outlines.length} outlines; only the first is used.`);
    const outline = outlines[0];

    levels.push(
      feature(levelId, 'level', geoPolygon(g, w, h, outline.points), {
        category: A.levelCategory,
        restriction: null,
        outdoor: false,
        ordinal: f.ordinal,
        name: names(f.name),
        short_name: names(String(f.ordinal)),
        display_point: geoPoint(g, w, h, pointOnSurface(outline.points)),
        address_id: ids.address,
        building_ids: [ids.building],
      }),
    );
    if (f.placesFloorId) {
      const it = items.get(f.placesFloorId);
      correlation.push({
        featureId: levelId,
        file: 'level.geojson',
        floor: f.name,
        name: f.name,
        placesId: f.placesFloorId,
        placesName: it?.name ?? '',
        placesType: it?.type ?? 'Floor',
      });
    }

    const link = (x: PlanFeature, fid: string, file: string) => {
      if (!x.placesId) return undefined;
      const it = items.get(x.placesId);
      correlation.push({
        featureId: fid,
        file,
        floor: f.name,
        name: it?.name ?? x.name,
        placesId: x.placesId,
        placesName: it?.name ?? '',
        placesType: it?.type ?? '',
      });
      return it;
    };
    // A feature shown with the Places display name keeps the map and the directory consistent.
    const displayName = (x: PlanFeature) => (x.placesId ? (items.get(x.placesId)?.name ?? x.name) : x.name) || null;
    const base = (x: PlanFeature) => ({
      display_point: geoPoint(g, w, h, pointOnSurface(x.points)),
      level_id: levelId,
    });

    for (const x of f.features) {
      if (x.kind === 'outline') continue;
      if (x.points.length < 3) continue;
      const geom = geoPolygon(g, w, h, x.points);
      if (x.kind === 'section') {
        sections.push(
          feature(x.id, 'section', geom, {
            category: A.sectionCategory,
            restriction: null,
            accessibility: null,
            name: names(displayName(x)),
            alt_name: null,
            ...base(x),
          }),
        );
        link(x, x.id, 'section.geojson');
      } else if (x.kind === 'desk' && desksAs === 'fixture') {
        fixtures.push(
          feature(x.id, 'fixture', geom, {
            category: A.fixtureDeskCategory,
            name: names(displayName(x)),
            alt_name: null,
            anchor_id: null,
            rotation: Math.round(normalizeDeg((x.rotationDeg ?? 0) + g.rotationDeg) * 10) / 10,
            ...base(x),
          }),
        );
        link(x, x.id, 'fixture.geojson');
      } else {
        const category =
          x.kind === 'workspace' ? A.workspaceUnitCategory : x.kind === 'desk' ? A.deskUnitCategory : x.category || 'room';
        units.push(
          feature(x.id, 'unit', geom, {
            category,
            restriction: null,
            accessibility: null,
            name: names(displayName(x)),
            alt_name: null,
            ...base(x),
            ...(A.unitsCarryBuildingIds ? { building_ids: [ids.building] } : {}),
          }),
        );
        link(x, x.id, 'unit.geojson');
      }
    }
  }

  const files: Record<string, string> = {};
  if (opts.includeBase !== false) {
    files['manifest.json'] = JSON.stringify(
      { version: '1.0.0', created: now, language: lang, generated_by: opts.generatedBy ?? 'imdf-places-builder' },
      null,
      2,
    );
    files['address.geojson'] = collection([addressFeature]);
    files['venue.geojson'] = collection([venueFeature]);
  }
  files['building.geojson'] = collection([buildingFeature]);
  files['footprint.geojson'] = collection([footprintFeature]);
  files['level.geojson'] = collection(levels);
  files['unit.geojson'] = collection(units);
  if (sections.length) files['section.geojson'] = collection(sections);
  if (fixtures.length) files['fixture.geojson'] = collection(fixtures);

  return { files, correlation, warnings, includedFloorIds: floors.map((f) => f.id) };
}

export function correlationCsv(rows: CorrelationRow[]): string {
  return toCsv([
    ['FeatureId', 'File', 'Floor', 'Name', 'PlaceId', 'PlaceName', 'PlaceType'],
    ...rows.map((r) => [r.featureId, r.file, r.floor, r.name, r.placesId, r.placesName, r.placesType]),
  ]);
}
