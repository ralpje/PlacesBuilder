import { createHash } from 'node:crypto';
import type { User } from './auth.ts';
import { NO_LIMITS } from './config.ts';
import type { Config, Limits } from './config.ts';
import { HttpError, Repo } from './repo.ts';
import { PreconditionError } from './storage.ts';
import type { PutOptions, Storage, Stored } from './storage.ts';
import type { InviteInfo, MemberInfo, WorkspaceInfo } from '../shared/types.ts';

/**
 * A workspace is the unit of data separation. In the self-host edition there is one shared workspace.
 * In the hosted edition there is one per Entra tenant (tid). Isolation is structural: a workspace only
 * gets a Repo whose storage is confined to its own key prefix, so code that handles a request cannot name
 * another workspace's keys.
 */
export interface Workspace {
  id: string;
  role: 'owner' | 'member';
  repo: Repo;
  admin?: WorkspaceAdmin;
}

export type Resolved =
  | { ok: true; workspace: Workspace }
  | { ok: false; code: 'tenant_in_use' | 'invalid_identity'; message: string; ownerHint?: string };

export interface Workspaces {
  resolve(user: User): Promise<Resolved>;
}

export type { InviteInfo, MemberInfo, WorkspaceInfo };

export interface WorkspaceAdmin {
  info(): Promise<WorkspaceInfo>;
  invite(email: string, by: User): Promise<InviteInfo>;
  revokeInvite(id: string): Promise<void>;
  removeMember(oid: string, by: User): Promise<void>;
}

/** Storage confined to a key prefix. */
export class PrefixedStorage implements Storage {
  private inner: Storage;
  private prefix: string;
  constructor(inner: Storage, prefix: string) {
    if (prefix && (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\/$/.test(prefix) || prefix.split('/').some((s) => s === '.' || s === '..'))) {
      throw new Error(`Invalid prefix: ${prefix}`);
    }
    this.inner = inner;
    this.prefix = prefix;
  }
  get(key: string): Promise<Stored | null> { return this.inner.get(this.prefix + key); }
  put(key: string, data: Buffer, contentType: string, opts?: PutOptions): Promise<string> { return this.inner.put(this.prefix + key, data, contentType, opts); }
  delete(key: string): Promise<void> { return this.inner.delete(this.prefix + key); }
  async list(prefix: string): Promise<string[]> {
    return (await this.inner.list(this.prefix + prefix)).map((k) => k.slice(this.prefix.length));
  }
  async listWithSize(prefix: string): Promise<{ key: string; size: number }[]> {
    return (await this.inner.listWithSize(this.prefix + prefix)).map((e) => ({ key: e.key.slice(this.prefix.length), size: e.size }));
  }
}

/** Self-host edition: one shared workspace, data where it has always been. No migration needed. */
export class SingleWorkspace implements Workspaces {
  private ws: Workspace;
  constructor(storage: Storage, limits: Limits = NO_LIMITS) {
    this.ws = { id: 'default', role: 'owner', repo: new Repo(storage, limits) };
  }
  async resolve(): Promise<Resolved> {
    return { ok: true, workspace: this.ws };
  }
}

// ---- hosted edition ----

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MEMBER_LIMIT = 25; // members plus open invites
const CACHE_MS = 20_000;

interface TenantDoc { tid: string; ownerOid: string; ownerNameHint: string; ownerEmailHint: string; createdAt: string }
interface MemberDoc { oid: string; name: string; email: string; role: 'owner' | 'member'; joinedAt: string }
interface InviteDoc { email: string; invitedBy: string; createdAt: string }

const now = () => new Date().toISOString();
const enc = (v: unknown) => Buffer.from(JSON.stringify(v));

/** "Alex Sample" -> "A••• S•••". Only the first letter of each word is shown. */
export function maskName(name: string): string {
  const words = name.split(/\s+/).filter(Boolean).slice(0, 3);
  if (words.length === 0) return '•••';
  return words.map((w) => `${[...w][0]}•••`).join(' ');
}

/** "alex.sample@contoso.com" -> "a•••@contoso.com". The domain stays: it is the caller's own organization. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '';
  return `${[...email][0]}•••${email.slice(at)}`;
}

export const emailKey = (email: string): string => createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);

const K = {
  tenant: (t: string) => `tenants/${t}/tenant.json`,
  member: (t: string, o: string) => `tenants/${t}/members/${o}.json`,
  members: (t: string) => `tenants/${t}/members/`,
  invite: (t: string, h: string) => `tenants/${t}/invites/${h}.json`,
  invites: (t: string) => `tenants/${t}/invites/`,
  data: (t: string) => `tenants/${t}/data/`,
};

async function readDoc<T>(s: Storage, key: string): Promise<T | null> {
  const r = await s.get(key);
  return r ? (JSON.parse(r.data.toString('utf8')) as T) : null;
}

/** Hosted edition: the first user of a tenant owns it and invites the others. */
export class TenantWorkspaces implements Workspaces {
  private storage: Storage;
  private repos = new Map<string, Repo>();
  // Positive results only, for a short time, so that the map (many tile requests) does not read storage every time.
  private cache = new Map<string, { ws: Workspace; until: number }>();
  private limits: Limits;
  constructor(storage: Storage, limits: Limits = NO_LIMITS) {
    this.storage = storage;
    this.limits = limits;
  }

  private repoFor(tid: string): Repo {
    let r = this.repos.get(tid);
    if (!r) {
      r = new Repo(new PrefixedStorage(this.storage, K.data(tid)), this.limits);
      this.repos.set(tid, r);
    }
    return r;
  }

  async resolve(user: User): Promise<Resolved> {
    const tid = (user.tenantId ?? '').toLowerCase();
    const oid = user.id.toLowerCase();
    if (!GUID.test(tid) || !GUID.test(oid)) {
      return { ok: false, code: 'invalid_identity', message: 'Your sign-in could not be matched to an organization.' };
    }
    const cacheKey = `${tid}/${oid}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.until > Date.now()) return { ok: true, workspace: hit.ws };

    const s = this.storage;
    const person = { name: user.name, email: user.email ?? '' };

    let tenant = await readDoc<TenantDoc>(s, K.tenant(tid));
    if (!tenant) {
      const doc: TenantDoc = { tid, ownerOid: oid, ownerNameHint: maskName(user.name), ownerEmailHint: maskEmail(user.email ?? ''), createdAt: now() };
      try {
        await s.put(K.tenant(tid), enc(doc), 'application/json', { ifNoneMatch: '*' }); // exactly one first user wins
        tenant = doc;
      } catch (e) {
        if (!(e instanceof PreconditionError)) throw e;
        tenant = await readDoc<TenantDoc>(s, K.tenant(tid));
        if (!tenant) throw e;
      }
    }

    let member = await readDoc<MemberDoc>(s, K.member(tid, oid));
    if (!member && tenant.ownerOid === oid) {
      member = { oid, ...person, role: 'owner', joinedAt: now() }; // also repairs an owner whose member file was never written
      await s.put(K.member(tid, oid), enc(member), 'application/json');
    }
    if (!member && user.email) {
      const invite = await readDoc<InviteDoc>(s, K.invite(tid, emailKey(user.email)));
      if (invite) {
        member = { oid, ...person, role: 'member', joinedAt: now() };
        await s.put(K.member(tid, oid), enc(member), 'application/json');
        await s.delete(K.invite(tid, emailKey(user.email)));
      }
    }
    if (!member) {
      const hint = [tenant.ownerNameHint, tenant.ownerEmailHint].filter(Boolean).join(', ');
      return {
        ok: false,
        code: 'tenant_in_use',
        ownerHint: hint,
        message: `Your organization already uses Places Builder. Ask the owner${hint ? ` (${hint})` : ''} to invite you.`,
      };
    }
    const workspace: Workspace = { id: tid, role: member.role, repo: this.repoFor(tid), admin: this.adminFor(tid, member.role) };
    this.cache.set(cacheKey, { ws: workspace, until: Date.now() + CACHE_MS });
    return { ok: true, workspace };
  }

  private adminFor(tid: string, role: 'owner' | 'member'): WorkspaceAdmin {
    const s = this.storage;
    const needOwner = () => {
      if (role !== 'owner') throw new HttpError(403, 'Only the owner can do this.');
    };
    return {
      info: async () => {
        const members: MemberInfo[] = [];
        for (const k of await s.list(K.members(tid))) {
          const m = await readDoc<MemberDoc>(s, k);
          if (m) members.push(m);
        }
        const invites: InviteInfo[] = [];
        if (role === 'owner') {
          for (const k of await s.list(K.invites(tid))) {
            const i = await readDoc<InviteDoc>(s, k);
            if (i) invites.push({ id: k.slice(k.lastIndexOf('/') + 1).replace(/\.json$/, ''), email: i.email, createdAt: i.createdAt });
          }
        }
        members.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
        return { role, members, invites, limit: MEMBER_LIMIT };
      },
      invite: async (email, by) => {
        needOwner();
        const e = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) throw new HttpError(400, 'Enter a valid e-mail address (the one the person signs in with).');
        const used = (await s.list(K.members(tid))).length + (await s.list(K.invites(tid))).length;
        if (used >= MEMBER_LIMIT) throw new HttpError(409, `An organization can have at most ${MEMBER_LIMIT} members and open invitations.`);
        const id = emailKey(e);
        const doc: InviteDoc = { email: e, invitedBy: by.id, createdAt: now() };
        await s.put(K.invite(tid, id), enc(doc), 'application/json');
        return { id, email: e, createdAt: doc.createdAt };
      },
      revokeInvite: async (id) => {
        needOwner();
        if (!/^[0-9a-f]{32}$/.test(id)) throw new HttpError(404, 'Not found');
        await s.delete(K.invite(tid, id));
      },
      removeMember: async (oid, by) => {
        needOwner();
        const o = oid.toLowerCase();
        if (!GUID.test(o)) throw new HttpError(404, 'Not found');
        if (o === by.id.toLowerCase()) throw new HttpError(400, 'The owner cannot remove themselves.');
        await s.delete(K.member(tid, o));
        this.cache.delete(`${tid}/${o}`);
      },
    };
  }
}

export function createWorkspaces(cfg: Config, storage: Storage): Workspaces {
  const limits = cfg.limits ?? NO_LIMITS;
  return cfg.edition === 'hosted' ? new TenantWorkspaces(storage, limits) : new SingleWorkspace(storage, limits);
}
