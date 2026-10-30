import type { FloorDoc, OfficeDoc, PlanFeature, Pt } from '../src/shared/types.ts';

export const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

export function makeOffice(over: Partial<OfficeDoc> = {}): OfficeDoc {
  return {
    id: 'off1',
    name: 'Scorpius',
    address: { street: 'Scorpius 1', postalCode: '2132 LR', city: 'Hoofddorp', country: 'NL', province: 'Noord-Holland' },
    placesBuildingId: 'B',
    places: {
      importedAt: '2026-10-30T00:00:00Z',
      buildingPlaceId: 'B',
      items: [
        { placeId: 'B', name: 'Scorpius', type: 'Building', parentId: '' },
        { placeId: 'F8', name: '8 - Marokko', type: 'Floor', parentId: 'B', sortOrder: 8 },
        { placeId: 'F1', name: '1 - Bases', type: 'Floor', parentId: 'B', sortOrder: 1 },
        { placeId: 'R1', name: '8.1 - Casablanca', type: 'Room', parentId: 'F8' },
        { placeId: 'R2', name: '8.2 - Marrakesh', type: 'Room', parentId: 'F8' },
        { placeId: 'S1', name: 'TestSection', type: 'Section', parentId: 'F8' },
        { placeId: 'W1', name: 'Test Desk Pool', type: 'Space', parentId: 'S1', capacity: 6 },
      ],
    },
    deskExport: 'fixture',
    floors: [],
    rev: 1,
    createdAt: '2026-10-30T00:00:00Z',
    updatedAt: '2026-10-30T00:00:00Z',
    ...over,
  };
}

export const feat = (over: Partial<PlanFeature> & Pick<PlanFeature, 'id' | 'kind' | 'points'>): PlanFeature => ({
  category: 'room',
  name: '',
  ...over,
});

export function makeFloor(over: Partial<FloorDoc> = {}): FloorDoc {
  return {
    id: 'fl8',
    officeId: 'off1',
    name: '8 - Marokko',
    ordinal: 8,
    placesFloorId: 'F8',
    plan: { width: 1000, height: 600, hasOriginal: true, version: 1 },
    georef: { lon: 4.69, lat: 52.3, rotationDeg: 30, metersPerPixel: 0.07 },
    features: [
      feat({ id: 'outline8', kind: 'outline', category: 'unspecified', points: rect(0, 0, 1000, 600) }),
      feat({ id: 'u1', kind: 'unit', points: rect(100, 100, 300, 250), placesId: 'R1' }),
      feat({ id: 'sec1', kind: 'section', category: 'unspecified', name: 'Zone A', points: rect(400, 100, 900, 500), placesId: 'S1' }),
      feat({ id: 'ws1', kind: 'workspace', category: 'workspace', points: rect(450, 150, 700, 300), placesId: 'W1' }),
      feat({ id: 'd1', kind: 'desk', category: 'desk', name: 'Desk 1', points: rect(500, 200, 530, 215), rotationDeg: 10 }),
    ],
    rev: 1,
    updatedAt: '2026-10-30T00:00:00Z',
    ...over,
  };
}
