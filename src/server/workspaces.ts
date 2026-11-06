import { createHash } from 'node:crypto';
import type { User } from './auth.ts';
import { NO_LIMITS } from './config.ts';
import type { Config, Limits, Terms } from './config.ts';
import { HttpError, Repo } from './repo.ts';
import { PreconditionError } from './storage.ts';
import type { PutOptions, Storage, Stored } from './storage.ts';
import type { InviteInfo, MemberInfo, TermsInfo, WorkspaceInfo } from '../shared/types.ts';

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
  | { ok: false; code: 'tenant_in_use' | 'invalid_identity'; message: string; ownerHint?: string }
  | { ok: false; code: 'terms_required'; message: string; terms: TermsInfo };

export interface Workspaces {
  resolve(user: User): Promise<Resolved>;
  /** Records that the user accepted this version of the terms. Only the multi-organisation edition has it. */
  acceptTerms?(user: User, version: string): Promise<void>;
  /** Operations on all tenants, for the operator of the hosted edition. Reached through the extension point only. */
  readonly operator?: OperatorOps;
}

export interface TenantSummary {
  tid: string;
  ownerNameHint: string;
  ownerEmailHint: string;
  createdAt: string;
  members: number;
}

/** What the operator of a hosted service may do with a tenant. The caller must have been authorized by the extension. */
export interface OperatorOps {
  listTenants(): Promise<TenantSummary[]>;
  /** Members, open invitations and limit of one tenant. */
  info(tid: string): Promise<WorkspaceInfo>;
  /** Key and size of every file of the tenant's data (offices, floors, plans). File contents are not exposed. */
  files(tid: string): Promise<{ key: string; size: number }[]>;
  invite(tid: string, email: string, by: User): Promise<InviteInfo>;
  revokeInvite(tid: string, id: string): Promise<void>;
  /** The current owner cannot be removed; transfer ownership first. */
  removeMember(tid: string, oid: string): Promise<void>;
  transferOwnership(tid: string, oid: string): Promise<void>;
  /** Removes every file of the tenant, including its members and invitations. Returns the number of files removed. */
  deleteTenant(tid: string): Promise<number>;
}

export type { InviteInfo, MemberInfo, WorkspaceInfo };

export interface WorkspaceAdmin {
  info(): Promise<WorkspaceInfo>;
  invite(email: string, by: User): Promise<InviteInfo>;
  revokeInvite(id: string): Promise<void>;
  removeMember(oid: string, by: User): Promise<void>;
  /** The owner hands ownership to another member and becomes a normal member. */
  transferOwnership(oid: string, by: User): Promise<void>;
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
interface MemberDoc { oid: string; name: string; email: string; role: 'owner' | 'member'; joinedAt: string; termsVersion?: string; termsAt?: string }
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
  private terms: Terms | null;
  constructor(storage: Storage, limits: Limits = NO_LIMITS, terms: Terms | null = null) {
    this.storage = storage;
    this.limits = limits;
    this.terms = terms;
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
    if (this.terms && member.termsVersion !== this.terms.version) {
      const { version, termsUrl, privacyUrl, dpaUrl } = this.terms;
      return {
        ok: false,
        code: 'terms_required',
        message: 'Please read and accept the terms of use and the privacy statement to continue.',
        terms: { version, termsUrl, privacyUrl, dpaUrl, owner: tenant.ownerOid === oid },
      };
    }
    // The tenant document is the only authority on who owns the organization; the role in a member file is for display.
    const role = tenant.ownerOid === oid ? 'owner' : 'member';
    const workspace: Workspace = { id: tid, role, repo: this.repoFor(tid), admin: this.adminFor(tid, role) };
    this.cache.set(cacheKey, { ws: workspace, until: Date.now() + CACHE_MS });
    return { ok: true, workspace };
  }

  async acceptTerms(user: User, version: string): Promise<void> {
    if (!this.terms) throw new HttpError(404, 'Not found');
    const tid = (user.tenantId ?? '').toLowerCase();
    const oid = user.id.toLowerCase();
    if (!GUID.test(tid) || !GUID.test(oid)) throw new HttpError(403, 'Your sign-in could not be matched to an organization.');
    if (version !== this.terms.version) throw new HttpError(409, 'The terms were updated. Reload the page to read the current version.');
    const member = await readDoc<MemberDoc>(this.storage, K.member(tid, oid));
    if (!member) throw new HttpError(403, 'You are not a member of this organization.');
    await this.storage.put(K.member(tid, oid), enc({ ...member, termsVersion: version, termsAt: now() }), 'application/json');
    this.cache.delete(`${tid}/${oid}`);
  }

  readonly operator: OperatorOps = {
    listTenants: async () => {
      const out: TenantSummary[] = [];
      for (const k of await this.storage.list('tenants/')) {
        const m = /^tenants\/([0-9a-f-]{36})\/tenant\.json$/.exec(k);
        if (!m) continue;
        const t = await readDoc<TenantDoc>(this.storage, k);
        if (!t) continue;
        const members = (await this.storage.list(K.members(m[1]))).length;
        out.push({ tid: t.tid, ownerNameHint: t.ownerNameHint, ownerEmailHint: t.ownerEmailHint, createdAt: t.createdAt, members });
      }
      return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    info: async (tid) => this.operatorAdmin(tid).info(),
    files: async (tid) => {
      this.checkTid(tid);
      const p = K.data(tid);
      return (await this.storage.listWithSize(p)).map((e) => ({ key: e.key.slice(p.length), size: e.size }));
    },
    invite: async (tid, email, by) => this.operatorAdmin(tid).invite(email, by),
    revokeInvite: async (tid, id) => this.operatorAdmin(tid).revokeInvite(id),
    removeMember: async (tid, oid) => this.operatorAdmin(tid).removeMember(oid, { id: '', name: '', roles: [], groups: [] }),
    transferOwnership: async (tid, oid) => this.operatorAdmin(tid).transferOwnership(oid, { id: '', name: '', roles: [], groups: [] }),
    deleteTenant: async (tid) => {
      this.checkTid(tid);
      if (!(await readDoc<TenantDoc>(this.storage, K.tenant(tid)))) throw new HttpError(404, 'Not found');
      const keys = await this.storage.list(`tenants/${tid}/`);
      for (const k of keys) await this.storage.delete(k);
      this.repos.delete(tid);
      for (const c of [...this.cache.keys()]) if (c.startsWith(`${tid}/`)) this.cache.delete(c);
      return keys.length;
    },
  };

  private checkTid(tid: string): void {
    if (!GUID.test(tid)) throw new HttpError(404, 'Not found');
  }

  private operatorAdmin(tid: string): WorkspaceAdmin {
    this.checkTid(tid);
    return this.adminFor(tid, 'owner', true);
  }

  private adminFor(tid: string, role: 'owner' | 'member', operator = false): WorkspaceAdmin {
    const s = this.storage;
    const needOwner = () => {
      if (role !== 'owner') throw new HttpError(403, 'Only the owner can do this.');
    };
    return {
      info: async () => {
        const members: MemberInfo[] = [];
        const ownerOid = (await readDoc<TenantDoc>(s, K.tenant(tid)))?.ownerOid;
        for (const k of await s.list(K.members(tid))) {
          const m = await readDoc<MemberDoc>(s, k);
          if (m) members.push({ ...m, role: m.oid.toLowerCase() === ownerOid ? 'owner' : 'member' });
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
        if (operator) {
          if ((await readDoc<TenantDoc>(s, K.tenant(tid)))?.ownerOid === o) throw new HttpError(409, 'That person owns the organization. Transfer ownership first.');
        } else if (o === by.id.toLowerCase()) throw new HttpError(400, 'The owner cannot remove themselves.');
        await s.delete(K.member(tid, o));
        this.cache.delete(`${tid}/${o}`);
      },
      transferOwnership: async (oid, by) => {
        needOwner();
        const target = oid.toLowerCase();
        if (!GUID.test(target)) throw new HttpError(404, 'Not found');
        const stored = await s.get(K.tenant(tid));
        const tenant = stored ? (JSON.parse(stored.data.toString('utf8')) as TenantDoc) : null;
        if (!stored || !tenant) throw new HttpError(404, 'Not found');
        // The owner hands over; the operator hands over on the owner's behalf, so the previous owner is whoever the tenant says.
        const me = operator ? tenant.ownerOid : by.id.toLowerCase();
        if (target === me) throw new HttpError(400, operator ? 'That person already owns the organization.' : 'You are already the owner.');
        const member = await readDoc<MemberDoc>(s, K.member(tid, target));
        if (!member) throw new HttpError(404, 'That person is not a member of this organization.');
        if (!operator && tenant.ownerOid !== me) throw new HttpError(403, 'Only the owner can do this.');
        const next: TenantDoc = { ...tenant, ownerOid: target, ownerNameHint: maskName(member.name), ownerEmailHint: maskEmail(member.email) };
        try {
          await s.put(K.tenant(tid), enc(next), 'application/json', { ifMatch: stored.etag }); // this single write is the transfer
        } catch (e) {
          if (e instanceof PreconditionError) throw new HttpError(409, 'The organization changed while you were doing this. Reload and try again.');
          throw e;
        }
        // The member files only show the role; they are updated for display and repaired by the tenant document if this fails.
        for (const [o, role] of [[target, 'owner'], [me, 'member']] as const) {
          const m = await readDoc<MemberDoc>(s, K.member(tid, o));
          if (m) await s.put(K.member(tid, o), enc({ ...m, role }), 'application/json').catch(() => undefined);
          this.cache.delete(`${tid}/${o}`);
        }
      },
    };
  }
}

export function createWorkspaces(cfg: Config, storage: Storage): Workspaces {
  const limits = cfg.limits ?? NO_LIMITS;
  return cfg.edition === 'hosted' ? new TenantWorkspaces(storage, limits, cfg.terms ?? null) : new SingleWorkspace(storage, limits);
}
