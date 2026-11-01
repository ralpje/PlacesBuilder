import type { IncomingMessage, ServerResponse } from 'node:http';
import { NO_LIMITS } from './config.ts';
import type { Config } from './config.ts';
import { APP_VERSION } from '../shared/version.ts';
import type { User } from './auth.ts';
import { HttpError } from './repo.ts';
import type { Workspaces } from './workspaces.ts';
import { fetchTile, geocode } from './maps.ts';
import { RateLimiter } from './rateLimit.ts';
import { createZip } from './zip.ts';
import { buildImdf, correlationCsv, mapFeaturesCsv } from '../shared/imdf.ts';
import { validateProject } from '../shared/validate.ts';

export interface Reply {
  status: number;
  headers?: Record<string, string>;
  body: Buffer | string;
}

const json = (status: number, data: unknown): Reply => ({
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(data),
});

export async function readBody(req: IncomingMessage, limit: number, what = 'The upload'): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, `${what} is larger than the limit of ${Math.round((limit / (1024 * 1024)) * 10) / 10} MB.`, { code: 'quota', limit: 'upload' });
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage, limit = 2_000_000): Promise<Record<string, unknown>> {
  const buf = await readBody(req, limit);
  try {
    const v = JSON.parse(buf.toString('utf8') || '{}');
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'office';

const tooMany = (wait: number, what: string): Reply => ({
  status: 429,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': String(wait) },
  body: JSON.stringify({ error: `Too many ${what}. Try again in ${wait} seconds.`, code: 'rate_limit', retryAfter: wait }),
});

export function createApi(cfg: Config, workspaces: Workspaces) {
  const lim = cfg.limits ?? NO_LIMITS;
  const requestLimiter = new RateLimiter(lim.requestsPerMinute, 60_000);
  const tileLimiter = new RateLimiter(lim.tilesPerHour, 3_600_000);
  return async function handle(req: IncomingMessage, url: URL, user: User): Promise<Reply> {
    const method = req.method ?? 'GET';
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const mutating = method !== 'GET' && method !== 'HEAD';
    if (mutating && req.headers['x-requested-with'] !== 'imdf-app') throw new HttpError(403, 'Missing X-Requested-With header.');
    const audit = (what: string) => console.log(JSON.stringify({ t: new Date().toISOString(), user: user.id, what }));
    const [a, b, c, d, e] = parts;
    if (a !== 'config') {
      const key = user.tenantId ? `${user.tenantId}/${user.id}` : user.id;
      const wait = a === 'tiles' ? tileLimiter.hit(key) : requestLimiter.hit(key);
      if (wait) return tooMany(wait, a === 'tiles' ? 'map tile requests' : 'requests');
    }
    const limits = cfg.limits ?? NO_LIMITS;
    // The built-in ceiling for a file, lowered by the optional limit.
    const uploadMax = (hard: number) => (limits.maxUploadBytes ? Math.min(hard, limits.maxUploadBytes) : hard);

    if (a === 'config' && method === 'GET') return json(200, { basemap: cfg.basemap, version: APP_VERSION, limits });

    const resolved = await workspaces.resolve(user);
    if (a === 'me' && method === 'GET') {
      return json(200, {
        id: user.id,
        name: user.name,
        edition: cfg.edition,
        workspace: resolved.ok ? { id: resolved.workspace.id, role: resolved.workspace.role, canManageMembers: !!resolved.workspace.admin } : null,
        blocked: resolved.ok ? null : { code: resolved.code, message: resolved.message },
      });
    }
    if (!resolved.ok) throw new HttpError(403, resolved.message, { code: resolved.code });
    const { workspace } = resolved;
    const repo = workspace.repo;

    if (a === 'workspace') {
      const admin = workspace.admin;
      if (!admin) throw new HttpError(404, 'Not found');
      if (!b && method === 'GET') return json(200, await admin.info());
      if (b === 'invites' && !c && method === 'POST') {
        const body = await readJson(req, 10_000);
        const inv = await admin.invite(typeof body.email === 'string' ? body.email : '', user);
        audit(`invite ${inv.id}`);
        return json(201, inv);
      }
      if (b === 'invites' && c && method === 'DELETE') {
        await admin.revokeInvite(c);
        audit(`invite.revoke ${c}`);
        return json(200, { ok: true });
      }
      if (b === 'members' && c && method === 'DELETE') {
        await admin.removeMember(c, user);
        audit(`member.remove ${c}`);
        return json(200, { ok: true });
      }
      throw new HttpError(404, 'Not found');
    }

    if (a === 'tiles' && method === 'GET') {
      const t = await fetchTile(cfg, b ?? '', c ?? '', (d ?? '').replace(/\.\w+$/, ''));
      if (!t) return json(404, { error: 'No tile.' });
      return { status: 200, headers: { 'Content-Type': t.contentType, 'Cache-Control': 'private, max-age=86400' }, body: t.body };
    }
    if (a === 'geocode' && method === 'GET') return json(200, await geocode(cfg, url.searchParams.get('q') ?? ''));

    if (a !== 'offices') throw new HttpError(404, 'Not found');

    if (!b) {
      if (method === 'GET') return json(200, await repo.listOffices());
      if (method === 'POST') {
        const o = await repo.createOffice(await readJson(req));
        audit(`office.create ${o.id}`);
        return json(201, o);
      }
      throw new HttpError(405, 'Method not allowed');
    }
    const officeId = b;

    if (!c) {
      if (method === 'GET') return json(200, await repo.getOffice(officeId));
      if (method === 'PUT') {
        const o = await repo.updateOffice(officeId, await readJson(req));
        audit(`office.update ${officeId}`);
        return json(200, o);
      }
      if (method === 'DELETE') {
        await repo.deleteOffice(officeId);
        audit(`office.delete ${officeId}`);
        return json(200, { ok: true });
      }
      throw new HttpError(405, 'Method not allowed');
    }

    if (c === 'places' && method === 'POST') {
      const csv = (await readBody(req, 5_000_000)).toString('utf8');
      const r = await repo.importPlaces(officeId, csv);
      audit(`places.import ${officeId} items=${r.summary.items}`);
      return json(200, r);
    }

    if (c === 'validate' && method === 'GET') {
      const office = await repo.getOffice(officeId);
      return json(200, validateProject(office, await repo.getFloors(office)));
    }
    if ((c === 'export.zip' || c === 'correlation.csv' || c === 'mapfeatures.csv') && method === 'GET') {
      const office = await repo.getOffice(officeId);
      const floors = await repo.getFloors(office);
      const report = validateProject(office, floors);
      if (!report.ok && url.searchParams.get('force') !== '1') {
        return json(422, { error: 'The project has errors. Fix them or export with force=1.', report });
      }
      let res;
      try {
        res = buildImdf(office, floors);
      } catch (err) {
        throw new HttpError(422, (err as Error).message);
      }
      audit(`export ${officeId}`);
      if (c === 'mapfeatures.csv') {
        return { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${safeName(office.name)}-mapfeatures.csv"` }, body: mapFeaturesCsv(res.correlation) };
      }
      if (c === 'correlation.csv') {
        return { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${safeName(office.name)}-correlation.csv"` }, body: correlationCsv(res.correlation) };
      }
      const zip = createZip(Object.entries(res.files).map(([name, data]) => ({ name, data: Buffer.from(data, 'utf8') })));
      return { status: 200, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${safeName(office.name)}-imdf.zip"`, 'X-Imdf-Warnings': String(res.warnings.length) }, body: zip };
    }

    if (c === 'floors') {
      if (!d) {
        if (method === 'POST') {
          const f = await repo.createFloor(officeId, await readJson(req));
          audit(`floor.create ${officeId}/${f.id}`);
          return json(201, f);
        }
        if (method === 'GET') {
          const office = await repo.getOffice(officeId);
          return json(200, await repo.getFloors(office));
        }
        throw new HttpError(405, 'Method not allowed');
      }
      const floorId = d;
      if (!e) {
        if (method === 'GET') return json(200, await repo.getFloor(officeId, floorId));
        if (method === 'PUT') {
          const f = await repo.saveFloor(officeId, floorId, await readJson(req, 5_000_000));
          return json(200, f);
        }
        if (method === 'DELETE') {
          await repo.deleteFloor(officeId, floorId);
          audit(`floor.delete ${officeId}/${floorId}`);
          return json(200, { ok: true });
        }
        throw new HttpError(405, 'Method not allowed');
      }
      if (e === 'plan') {
        if (method === 'GET') {
          const img = await repo.getPlanImage(officeId, floorId);
          if (!img) throw new HttpError(404, 'No plan image.');
          return { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable' }, body: img };
        }
        if (method === 'PUT') {
          const q = url.searchParams;
          const mpp = Number(q.get('mpp'));
          const f = await repo.putPlan(officeId, floorId, await readBody(req, uploadMax(25_000_000), 'This plan image'), {
            width: Number(q.get('w')),
            height: Number(q.get('h')),
            ...(mpp > 0 ? { metersPerPixel: mpp } : {}),
          });
          audit(`plan.put ${officeId}/${floorId}`);
          return json(200, f);
        }
      }
      if (e === 'original') {
        if (method === 'GET') {
          const o = await repo.getOriginal(officeId, floorId);
          if (!o) throw new HttpError(404, 'No original.');
          return { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment' }, body: o };
        }
        if (method === 'PUT') {
          const f = await repo.putOriginal(officeId, floorId, await readBody(req, uploadMax(40_000_000), 'This file'), url.searchParams.get('name') ?? 'plan');
          return json(200, f);
        }
      }
    }
    throw new HttpError(404, 'Not found');
  };
}

export function errorReply(err: unknown): Reply {
  if (err instanceof HttpError) return json(err.status, { error: err.message, ...(err.body ? { detail: err.body } : {}) });
  console.error(err);
  return json(500, { error: 'Something went wrong on the server.' });
}

export function sendReply(res: ServerResponse, r: Reply): void {
  res.writeHead(r.status, { 'Cache-Control': 'no-store', ...r.headers });
  res.end(r.body);
}
