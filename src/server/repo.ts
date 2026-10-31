import { randomUUID } from 'node:crypto';
import { FEATURE_KINDS } from '../shared/types.ts';
import type { Address, FeatureKind, FloorDoc, FloorIndexEntry, GeoRef, OfficeDoc, PlanFeature, Pt } from '../shared/types.ts';
import { ordinalFromName, parsePlacesCsv } from '../shared/places.ts';
import { normalizeDeg } from '../shared/georef.ts';
import { PreconditionError } from './storage.ts';
import type { Storage } from './storage.ts';

export class HttpError extends Error {
  status: number;
  body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const checkId = (id: string): string => {
  if (!UUID.test(id)) throw new HttpError(404, 'Not found');
  return id;
};

const K = {
  office: (o: string) => `offices/${o}/office.json`,
  floor: (o: string, f: string) => `offices/${o}/floors/${f}/floor.json`,
  plan: (o: string, f: string) => `offices/${o}/floors/${f}/plan.png`,
  original: (o: string, f: string) => `offices/${o}/floors/${f}/original.bin`,
  prefix: (o: string) => `offices/${o}/`,
  floorPrefix: (o: string, f: string) => `offices/${o}/floors/${f}/`,
};

const LIMITS = { features: 3000, pointsPerFeature: 3000, coord: 1e6, text: 200 };
const now = () => new Date().toISOString();

const text = (v: unknown, max = LIMITS.text): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export interface OfficeSummary {
  id: string;
  name: string;
  city: string;
  floors: number;
  updatedAt: string;
}

export interface PlacesImportSummary {
  items: number;
  floorsCreated: number;
  floorsLinked: number;
  ordinalsAligned: number;
  warnings: string[];
}

export function isPng(b: Buffer): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

export function sniffOriginal(b: Buffer): 'pdf' | 'png' | 'jpeg' | null {
  if (b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (isPng(b)) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  return null;
}

function cleanAddress(input: unknown, base: Address): Address {
  const a = (typeof input === 'object' && input ? input : {}) as Record<string, unknown>;
  const pick = (k: keyof Address, fallback: string | undefined) => (k in a ? text(a[k], 120) : (fallback ?? ''));
  const country = pick('country', base.country).toUpperCase().slice(0, 2);
  const province = pick('province', base.province);
  return {
    street: pick('street', base.street),
    postalCode: pick('postalCode', base.postalCode),
    city: pick('city', base.city),
    country,
    ...(province ? { province } : {}),
  };
}

function cleanPoints(v: unknown): Pt[] | null {
  if (!Array.isArray(v) || v.length < 3 || v.length > LIMITS.pointsPerFeature) return null;
  const out: Pt[] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const x = num(p[0]);
    const y = num(p[1]);
    if (x === undefined || y === undefined || Math.abs(x) > LIMITS.coord || Math.abs(y) > LIMITS.coord) return null;
    out.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  }
  return out;
}

function cleanFeatures(v: unknown): PlanFeature[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'features must be a list.');
  if (v.length > LIMITS.features) throw new HttpError(400, `Too many features (max ${LIMITS.features}).`);
  const seen = new Set<string>();
  return v.map((raw, i) => {
    const x = (raw ?? {}) as Record<string, unknown>;
    const id = text(x.id, 64);
    if (!/^[\w-]{1,64}$/.test(id) || seen.has(id)) throw new HttpError(400, `Feature ${i + 1} has a missing or duplicate id.`);
    seen.add(id);
    if (!FEATURE_KINDS.includes(x.kind as FeatureKind)) throw new HttpError(400, `Feature ${i + 1} has an unknown kind.`);
    const points = cleanPoints(x.points);
    if (!points) throw new HttpError(400, `Feature ${i + 1} has invalid points.`);
    const f: PlanFeature = {
      id,
      kind: x.kind as FeatureKind,
      category: text(x.category, 40) || 'room',
      name: text(x.name, 120),
      points,
    };
    const label = text(x.label, 120);
    if (label) f.label = label;
    const rot = num(x.rotationDeg);
    if (rot !== undefined) f.rotationDeg = Math.round(normalizeDeg(rot) * 10) / 10;
    const pid = text(x.placesId, 64);
    if (pid) f.placesId = pid;
    return f;
  });
}

function cleanGeoref(v: unknown): GeoRef | undefined {
  if (v === null || v === undefined) return undefined;
  const g = v as Record<string, unknown>;
  const lon = num(g.lon);
  const lat = num(g.lat);
  const rot = num(g.rotationDeg);
  const mpp = num(g.metersPerPixel);
  if (lon === undefined || lat === undefined || rot === undefined || mpp === undefined) throw new HttpError(400, 'georef is incomplete.');
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) throw new HttpError(400, 'georef is outside the valid range.');
  if (!(mpp > 0.0005 && mpp < 10)) throw new HttpError(400, 'georef scale is outside the valid range.');
  return { lon, lat, rotationDeg: normalizeDeg(rot), metersPerPixel: mpp };
}

export class Repo {
  private s: Storage;
  constructor(storage: Storage) {
    this.s = storage;
  }

  private async read<T>(key: string): Promise<{ value: T; etag: string } | null> {
    const got = await this.s.get(key);
    if (!got) return null;
    return { value: JSON.parse(got.data.toString('utf8')) as T, etag: got.etag };
  }

  private write(key: string, value: unknown, opts?: Parameters<Storage['put']>[3]) {
    return this.s.put(key, Buffer.from(JSON.stringify(value)), 'application/json', opts);
  }

  // ---- offices -------------------------------------------------------------------------------

  async listOffices(): Promise<OfficeSummary[]> {
    const keys = (await this.s.list('offices/')).filter((k) => /^offices\/[^/]+\/office\.json$/.test(k));
    const out: OfficeSummary[] = [];
    for (const k of keys) {
      const o = await this.read<OfficeDoc>(k);
      if (o) out.push({ id: o.value.id, name: o.value.name, city: o.value.address.city, floors: o.value.floors.length, updatedAt: o.value.updatedAt });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getOffice(id: string): Promise<OfficeDoc> {
    const o = await this.read<OfficeDoc>(K.office(checkId(id)));
    if (!o) throw new HttpError(404, 'Office not found.');
    return o.value;
  }

  async createOffice(input: { name?: unknown; address?: unknown }): Promise<OfficeDoc> {
    const name = text(input.name, 120);
    if (!name) throw new HttpError(400, 'Give the office a name.');
    const t = now();
    const doc: OfficeDoc = {
      id: randomUUID(),
      name,
      address: cleanAddress(input.address, { street: '', postalCode: '', city: '', country: 'NL' }),
      deskExport: 'fixture',
      floors: [],
      rev: 1,
      createdAt: t,
      updatedAt: t,
    };
    await this.write(K.office(doc.id), doc, { ifNoneMatch: '*' });
    return doc;
  }

  /** Read-modify-write with the etag. With expectedRev the caller's view must still be current. */
  private async mutateOffice(id: string, fn: (o: OfficeDoc) => void, expectedRev?: number): Promise<OfficeDoc> {
    const conflict = (rev?: number) =>
      new HttpError(409, 'Someone else changed this office. Reload and try again.', { currentRev: rev });
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await this.read<OfficeDoc>(K.office(checkId(id)));
      if (!cur) throw new HttpError(404, 'Office not found.');
      if (expectedRev !== undefined && cur.value.rev !== expectedRev) throw conflict(cur.value.rev);
      const next = structuredClone(cur.value);
      fn(next);
      next.rev = cur.value.rev + 1;
      next.updatedAt = now();
      try {
        await this.write(K.office(id), next, { ifMatch: cur.etag });
        return next;
      } catch (e) {
        if (!(e instanceof PreconditionError)) throw e;
        if (expectedRev !== undefined) throw conflict();
      }
    }
    throw new HttpError(409, 'Could not save. Please try again.');
  }

  async updateOffice(id: string, body: Record<string, unknown>): Promise<OfficeDoc> {
    const rev = num(body.rev);
    if (rev === undefined) throw new HttpError(400, 'rev is required.');
    return this.mutateOffice(
      id,
      (o) => {
        if ('name' in body) {
          const n = text(body.name, 120);
          if (!n) throw new HttpError(400, 'The name cannot be empty.');
          o.name = n;
        }
        if ('address' in body) o.address = cleanAddress(body.address, o.address);
        if (body.deskExport === 'fixture' || body.deskExport === 'unit') o.deskExport = body.deskExport;
        if (Array.isArray(body.center) && body.center.length === 2) {
          const lon = num(body.center[0]);
          const lat = num(body.center[1]);
          if (lon !== undefined && lat !== undefined && Math.abs(lat) <= 85 && Math.abs(lon) <= 180) o.center = [lon, lat];
        }
      },
      rev,
    );
  }

  async deleteOffice(id: string): Promise<void> {
    checkId(id);
    for (const k of await this.s.list(K.prefix(id))) await this.s.delete(k);
  }

  // ---- Places import ------------------------------------------------------------------------

  async importPlaces(id: string, csv: string): Promise<{ office: OfficeDoc; summary: PlacesImportSummary }> {
    let parsed;
    try {
      parsed = parsePlacesCsv(csv);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const summary: PlacesImportSummary = {
      items: parsed.places.items.length,
      floorsCreated: 0,
      floorsLinked: 0,
      ordinalsAligned: 0,
      warnings: parsed.warnings,
    };
    const placesFloors = parsed.places.items.filter((i) => i.type.toLowerCase() === 'floor' && i.parentId === parsed.places.buildingPlaceId);

    // Make sure a floor document exists for every Places floor, and that ordinals follow SortOrder.
    const current = await this.getOffice(id);
    const toWrite: FloorDoc[] = [];
    const indexUpdates: FloorIndexEntry[] = [];
    for (const pf of placesFloors) {
      const existing = current.floors.find((f) => f.placesFloorId === pf.placeId);
      if (existing) {
        summary.floorsLinked++;
        if (pf.sortOrder !== undefined && existing.ordinal !== pf.sortOrder) {
          const doc = await this.getFloor(id, existing.id);
          doc.ordinal = pf.sortOrder;
          toWrite.push(doc);
          indexUpdates.push({ ...existing, ordinal: pf.sortOrder });
          summary.ordinalsAligned++;
        }
      } else {
        const t = now();
        const doc: FloorDoc = {
          id: randomUUID(),
          officeId: id,
          name: pf.name,
          ordinal: pf.sortOrder ?? ordinalFromName(pf.name) ?? 0,
          placesFloorId: pf.placeId,
          features: [],
          rev: 1,
          updatedAt: t,
        };
        toWrite.push(doc);
        indexUpdates.push({ id: doc.id, name: doc.name, ordinal: doc.ordinal, placesFloorId: pf.placeId });
        summary.floorsCreated++;
      }
    }
    for (const d of toWrite) {
      const prev = await this.read<FloorDoc>(K.floor(id, d.id));
      if (prev) d.rev = prev.value.rev + 1;
      await this.write(K.floor(id, d.id), d, prev ? { ifMatch: prev.etag } : { ifNoneMatch: '*' });
    }

    const office = await this.mutateOffice(id, (o) => {
      o.places = parsed.places;
      o.placesBuildingId = parsed.places.buildingPlaceId;
      if (parsed.address) {
        // Fill what is empty; never overwrite what the user typed.
        const a = parsed.address;
        o.address = {
          street: o.address.street || a.street || '',
          postalCode: o.address.postalCode || a.postalCode || '',
          city: o.address.city || a.city || '',
          country: o.address.country || a.country || 'NL',
          ...(o.address.province || a.province ? { province: o.address.province || a.province } : {}),
        };
      }
      for (const u of indexUpdates) {
        const i = o.floors.findIndex((f) => f.id === u.id);
        if (i >= 0) o.floors[i] = u;
        else o.floors.push(u);
      }
      o.floors.sort((a, b) => a.ordinal - b.ordinal);
    });
    return { office, summary };
  }

  // ---- floors -------------------------------------------------------------------------------

  async getFloor(officeId: string, floorId: string): Promise<FloorDoc> {
    const f = await this.read<FloorDoc>(K.floor(checkId(officeId), checkId(floorId)));
    if (!f) throw new HttpError(404, 'Floor not found.');
    return f.value;
  }

  async getFloors(office: OfficeDoc): Promise<FloorDoc[]> {
    return Promise.all(office.floors.map((f) => this.getFloor(office.id, f.id)));
  }

  async createFloor(officeId: string, body: Record<string, unknown>): Promise<FloorDoc> {
    await this.getOffice(officeId);
    const name = text(body.name, 120);
    if (!name) throw new HttpError(400, 'Give the floor a name.');
    const ordinal = num(body.ordinal) ?? 0;
    if (!Number.isInteger(ordinal) || ordinal < -50 || ordinal > 300) throw new HttpError(400, 'The ordinal must be a whole number.');
    const doc: FloorDoc = { id: randomUUID(), officeId, name, ordinal, features: [], rev: 1, updatedAt: now() };
    await this.write(K.floor(officeId, doc.id), doc, { ifNoneMatch: '*' });
    await this.mutateOffice(officeId, (o) => {
      o.floors.push({ id: doc.id, name, ordinal });
      o.floors.sort((a, b) => a.ordinal - b.ordinal);
    });
    return doc;
  }

  private async mutateFloor(
    officeId: string,
    floorId: string,
    fn: (f: FloorDoc) => void,
    expectedRev?: number,
  ): Promise<FloorDoc> {
    checkId(officeId);
    checkId(floorId);
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await this.read<FloorDoc>(K.floor(officeId, floorId));
      if (!cur) throw new HttpError(404, 'Floor not found.');
      if (expectedRev !== undefined && cur.value.rev !== expectedRev) {
        throw new HttpError(409, 'Someone else changed this floor. Reload and try again.', { currentRev: cur.value.rev });
      }
      const next = structuredClone(cur.value);
      fn(next);
      next.rev = cur.value.rev + 1;
      next.updatedAt = now();
      try {
        await this.write(K.floor(officeId, floorId), next, { ifMatch: cur.etag });
        return next;
      } catch (e) {
        if (!(e instanceof PreconditionError)) throw e;
        if (expectedRev !== undefined) throw new HttpError(409, 'Someone else changed this floor. Reload and try again.');
      }
    }
    throw new HttpError(409, 'Could not save. Please try again.');
  }

  async saveFloor(officeId: string, floorId: string, body: Record<string, unknown>): Promise<FloorDoc> {
    const rev = num(body.rev);
    if (rev === undefined) throw new HttpError(400, 'rev is required.');
    const patch: { name?: string; ordinal?: number; placesFloorId?: string | null; georef?: GeoRef | undefined; features?: PlanFeature[]; hasGeoref: boolean } = {
      hasGeoref: 'georef' in body,
    };
    if ('name' in body) {
      patch.name = text(body.name, 120);
      if (!patch.name) throw new HttpError(400, 'The name cannot be empty.');
    }
    if ('ordinal' in body) {
      const o = num(body.ordinal);
      if (o === undefined || !Number.isInteger(o) || o < -50 || o > 300) throw new HttpError(400, 'The ordinal must be a whole number.');
      patch.ordinal = o;
    }
    if ('placesFloorId' in body) patch.placesFloorId = text(body.placesFloorId, 64) || null;
    if (patch.hasGeoref) patch.georef = cleanGeoref(body.georef);
    if ('features' in body) patch.features = cleanFeatures(body.features);

    const saved = await this.mutateFloor(
      officeId,
      floorId,
      (f) => {
        if (patch.name !== undefined) f.name = patch.name;
        if (patch.ordinal !== undefined) f.ordinal = patch.ordinal;
        if (patch.placesFloorId !== undefined) {
          if (patch.placesFloorId) f.placesFloorId = patch.placesFloorId;
          else delete f.placesFloorId;
        }
        if (patch.hasGeoref) {
          if (patch.georef) f.georef = patch.georef;
          else delete f.georef;
        }
        if (patch.features) f.features = patch.features;
      },
      rev,
    );
    if (patch.name !== undefined || patch.ordinal !== undefined || patch.placesFloorId !== undefined) {
      await this.mutateOffice(officeId, (o) => {
        const i = o.floors.findIndex((x) => x.id === floorId);
        const entry: FloorIndexEntry = { id: floorId, name: saved.name, ordinal: saved.ordinal, ...(saved.placesFloorId ? { placesFloorId: saved.placesFloorId } : {}) };
        if (i >= 0) o.floors[i] = entry;
        else o.floors.push(entry);
        o.floors.sort((a, b) => a.ordinal - b.ordinal);
      });
    }
    return saved;
  }

  async deleteFloor(officeId: string, floorId: string): Promise<void> {
    checkId(officeId);
    checkId(floorId);
    for (const k of await this.s.list(K.floorPrefix(officeId, floorId))) await this.s.delete(k);
    await this.mutateOffice(officeId, (o) => {
      o.floors = o.floors.filter((f) => f.id !== floorId);
    });
  }

  // ---- plan images --------------------------------------------------------------------------

  async putPlan(officeId: string, floorId: string, png: Buffer, meta: { width: number; height: number; metersPerPixel?: number }): Promise<FloorDoc> {
    if (!isPng(png)) throw new HttpError(415, 'The plan image must be a PNG.');
    if (!(meta.width >= 100 && meta.width <= 20000 && meta.height >= 100 && meta.height <= 20000)) {
      throw new HttpError(400, 'The plan image has an invalid size.');
    }
    await this.getFloor(officeId, floorId);
    await this.s.put(K.plan(officeId, floorId), png, 'image/png');
    return this.mutateFloor(officeId, floorId, (f) => {
      f.plan = {
        width: Math.round(meta.width),
        height: Math.round(meta.height),
        hasOriginal: f.plan?.hasOriginal ?? false,
        version: (f.plan?.version ?? 0) + 1,
        ...(meta.metersPerPixel ? { metersPerPixel: meta.metersPerPixel } : {}),
        ...(f.plan?.originalName ? { originalName: f.plan.originalName } : {}),
      };
    });
  }

  async putOriginal(officeId: string, floorId: string, data: Buffer, name: string): Promise<FloorDoc> {
    if (!sniffOriginal(data)) throw new HttpError(415, 'Upload a PDF, PNG or JPEG file.');
    const f = await this.getFloor(officeId, floorId);
    if (!f.plan) throw new HttpError(409, 'Upload the plan image first.');
    await this.s.put(K.original(officeId, floorId), data, 'application/octet-stream');
    return this.mutateFloor(officeId, floorId, (d) => {
      if (d.plan) {
        d.plan.hasOriginal = true;
        d.plan.originalName = name.replace(/[^\w. -]/g, '_').slice(0, 120);
      }
    });
  }

  async getPlanImage(officeId: string, floorId: string): Promise<Buffer | null> {
    checkId(officeId);
    checkId(floorId);
    return (await this.s.get(K.plan(officeId, floorId)))?.data ?? null;
  }

  async getOriginal(officeId: string, floorId: string): Promise<Buffer | null> {
    checkId(officeId);
    checkId(floorId);
    return (await this.s.get(K.original(officeId, floorId)))?.data ?? null;
  }
}
