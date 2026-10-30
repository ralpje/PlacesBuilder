import type { FloorDoc, OfficeDoc, ValidationReport, Address, DeskExportMode } from '../shared/types.ts';

export class ApiError extends Error {
  status: number;
  detail?: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function call<T>(method: string, path: string, body?: BodyInit | null, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`/api/${path}`, { method, body, headers: { 'X-Requested-With': 'imdf-app', ...headers } });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    let detail: unknown;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
      detail = j.detail ?? j.report;
    } catch { /* not json */ }
    throw new ApiError(res.status, msg, detail);
  }
  return (await res.json()) as T;
}
const jsonBody = (v: unknown) => JSON.stringify(v);
const JSON_H = { 'Content-Type': 'application/json' };

export interface OfficeSummary { id: string; name: string; city: string; floors: number; updatedAt: string }
export interface ImportResult {
  office: OfficeDoc;
  summary: { items: number; floorsCreated: number; floorsLinked: number; ordinalsAligned: number; warnings: string[] };
}
export interface GeoHit { label: string; lon: number; lat: number }

export const api = {
  config: () => call<{ basemap: 'azure' | 'osm' | 'none' }>('GET', 'config'),
  me: () => call<{ id: string; name: string }>('GET', 'me'),
  offices: () => call<OfficeSummary[]>('GET', 'offices'),
  createOffice: (name: string) => call<OfficeDoc>('POST', 'offices', jsonBody({ name }), JSON_H),
  office: (id: string) => call<OfficeDoc>('GET', `offices/${id}`),
  updateOffice: (id: string, patch: { rev: number; name?: string; address?: Address; deskExport?: DeskExportMode; center?: [number, number] }) =>
    call<OfficeDoc>('PUT', `offices/${id}`, jsonBody(patch), JSON_H),
  deleteOffice: (id: string) => call<{ ok: true }>('DELETE', `offices/${id}`),
  importPlaces: (id: string, csv: string) => call<ImportResult>('POST', `offices/${id}/places`, csv, { 'Content-Type': 'text/csv' }),
  floor: (o: string, f: string) => call<FloorDoc>('GET', `offices/${o}/floors/${f}`),
  createFloor: (o: string, name: string, ordinal: number) => call<FloorDoc>('POST', `offices/${o}/floors`, jsonBody({ name, ordinal }), JSON_H),
  saveFloor: (o: string, f: string, patch: Record<string, unknown>) => call<FloorDoc>('PUT', `offices/${o}/floors/${f}`, jsonBody(patch), JSON_H),
  deleteFloor: (o: string, f: string) => call<{ ok: true }>('DELETE', `offices/${o}/floors/${f}`),
  putPlan: (o: string, f: string, png: Blob, w: number, h: number, mpp?: number) =>
    call<FloorDoc>('PUT', `offices/${o}/floors/${f}/plan?w=${w}&h=${h}${mpp ? `&mpp=${mpp}` : ''}`, png, { 'Content-Type': 'image/png' }),
  putOriginal: (o: string, f: string, file: Blob, name: string) =>
    call<FloorDoc>('PUT', `offices/${o}/floors/${f}/original?name=${encodeURIComponent(name)}`, file, { 'Content-Type': 'application/octet-stream' }),
  planUrl: (o: string, f: string, v: number) => `/api/offices/${o}/floors/${f}/plan?v=${v}`,
  originalUrl: (o: string, f: string) => `/api/offices/${o}/floors/${f}/original`,
  validate: (o: string) => call<ValidationReport>('GET', `offices/${o}/validate`),
  exportUrl: (o: string, force = false) => `/api/offices/${o}/export.zip${force ? '?force=1' : ''}`,
  correlationUrl: (o: string) => `/api/offices/${o}/correlation.csv?force=1`,
  geocode: (q: string) => call<GeoHit[]>('GET', `geocode?q=${encodeURIComponent(q)}`),
};
