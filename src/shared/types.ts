// Shared data model. Keep this file free of runtime imports: it is used by server, web and tests.

export type Pt = [number, number]; // plan pixel coordinates (x right, y down)
export type LonLat = [number, number]; // WGS84 [longitude, latitude]

export interface Address {
  street: string;
  postalCode: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2, e.g. NL
  province?: string; // free text as exported by Places, e.g. Noord-Holland
}

/** Where a plan image sits on the earth. The image centre is the anchor. */
export interface GeoRef {
  lon: number;
  lat: number;
  rotationDeg: number; // clockwise rotation of the image on the map
  metersPerPixel: number;
}

export type FeatureKind = 'outline' | 'unit' | 'section' | 'workspace' | 'desk';

export interface PlanFeature {
  id: string; // uuid, becomes the IMDF feature id
  kind: FeatureKind;
  category: string; // IMDF category, e.g. room, conferenceroom, restroom
  name: string; // display name used when no Places item is linked
  label?: string; // optional text read off the plan, used for auto matching
  points: Pt[]; // polygon ring without the closing point
  rotationDeg?: number; // desks: rotation of the desk in the plan frame
  placesId?: string; // linked Places PlaceId
}

export interface PlanMeta {
  width: number;
  height: number;
  metersPerPixel?: number; // suggested from the sheet scale
  originalName?: string;
  hasOriginal: boolean;
  version: number; // bumps on every preview upload, used to bust caches
}

export interface FloorDoc {
  id: string;
  officeId: string;
  name: string;
  ordinal: number; // must equal the Places SortOrder of the linked floor
  placesFloorId?: string;
  plan?: PlanMeta;
  georef?: GeoRef;
  features: PlanFeature[];
  rev: number;
  updatedAt: string;
}

export interface FloorIndexEntry {
  id: string;
  name: string;
  ordinal: number;
  placesFloorId?: string;
}

/** Trimmed Places directory row. Everything not listed here is dropped on import. */
export interface PlacesItem {
  placeId: string;
  name: string;
  type: string; // Building, Floor, Section, Room, Space, ...
  parentId: string;
  capacity?: number;
  sortOrder?: number; // floors only, read from the Features JSON
}

export interface PlacesImport {
  importedAt: string;
  buildingPlaceId?: string;
  items: PlacesItem[];
}

export type DeskExportMode = 'fixture' | 'unit';

export interface OfficeDoc {
  id: string;
  name: string;
  address: Address;
  placesBuildingId?: string;
  places?: PlacesImport;
  center?: LonLat; // last map centre, so the map opens in the right place
  deskExport: DeskExportMode;
  floors: FloorIndexEntry[];
  rev: number;
  createdAt: string;
  updatedAt: string;
}

export interface Problem {
  level: 'error' | 'warning' | 'info';
  message: string;
  floorId?: string;
  featureId?: string;
}

export interface ValidationReport {
  ok: boolean; // true when there are no errors
  problems: Problem[];
  stats: { floors: number; units: number; sections: number; workspaces: number; desks: number; matched: number };
}

export interface CorrelationRow {
  featureId: string;
  file: string; // e.g. unit.geojson
  floor: string;
  name: string;
  placesId: string;
  placesName: string;
  placesType: string;
}

export const FEATURE_KINDS: FeatureKind[] = ['outline', 'unit', 'section', 'workspace', 'desk'];

/** IMDF unit categories offered in the editor. workspace and desk are Microsoft Places conventions. */
export const UNIT_CATEGORIES = [
  'room',
  'conferenceroom',
  'office',
  'phoneroom',
  'restroom',
  'lobby',
  'walkway',
  'stairs',
  'elevator',
  'storage',
  'serverroom',
  'foodservice',
  'opentobelow',
  'nonpublic',
  'unspecified',
] as const;
