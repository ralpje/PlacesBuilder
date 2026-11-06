import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { LocalStorage } from '../src/server/storage.ts';
import { TenantWorkspaces, SingleWorkspace } from '../src/server/workspaces.ts';
import type { Workspaces } from '../src/server/workspaces.ts';
import { createApi } from '../src/server/api.ts';
import { loadExtension } from '../src/server/extension.ts';
import { audit } from '../src/server/audit.ts';
import type { Config } from '../src/server/config.ts';
import type { User } from '../src/server/auth.ts';

const TID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const oid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = (tid: string, n: number, name: string, email: string): User => ({ id: oid(n), name, roles: [], groups: [], tenantId: tid, email });
const alice = user(TID_A, 1, 'Alice Anderson', 'alice@contoso.com');
const bob = user(TID_A, 2, 'Bob Brown', 'bob@contoso.com');
const carol = user(TID_B, 3, 'Carol Clark', 'carol@fabrikam.com');
const operator = user(TID_B, 9, 'Olivia Operator', 'olivia@fabrikam.com');

async function setup() {
  const storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'pb-op-')));
  const ws = new TenantWorkspaces(storage);
  // alice owns tenant A with bob as member and a plan file; carol owns tenant B
  const a = await ws.resolve(alice);
  assert.ok(a.ok);
  await ws.operator.invite(TID_A, 'bob@contoso.com', alice);
  assert.ok((await ws.resolve(bob)).ok);
  await storage.put(`tenants/${TID_A}/data/offices/o1/floors/f1/plan.png`, Buffer.from('x'.repeat(10)), 'image/png');
  assert.ok((await ws.resolve(carol)).ok);
  return { storage, ws };
}

test('operator lists all tenants with owner hint and member count', async () => {
  const { ws } = await setup();
  const t = await ws.operator.listTenants();
  assert.deepEqual(t.map((x) => [x.tid, x.members]), [[TID_A, 2], [TID_B, 1]]);
  assert.ok(t[0].ownerNameHint.startsWith('A'));
});

test('operator sees file names and sizes, not contents', async () => {
  const { ws } = await setup();
  const f = await ws.operator.files(TID_A);
  assert.ok(f.some((e) => e.key === 'offices/o1/floors/f1/plan.png' && e.size === 10));
  assert.ok(f.every((e) => !e.key.startsWith('tenants/') && !('data' in e)));
  assert.deepEqual(await ws.operator.files(TID_B), []);
});

test('operator transfers ownership on the owner\'s behalf', async () => {
  const { ws } = await setup();
  await ws.operator.transferOwnership(TID_A, oid(2));
  const info = await ws.operator.info(TID_A);
  assert.equal(info.members.find((m) => m.oid === oid(2))?.role, 'owner');
  const r = await ws.resolve(bob);
  assert.ok(r.ok && r.workspace.role === 'owner');
  const old = await ws.resolve(alice);
  assert.ok(old.ok && old.workspace.role === 'member');
  await assert.rejects(ws.operator.transferOwnership(TID_A, oid(2)), { status: 400 });
});

test('operator cannot remove the owner, can remove a member, and invites', async () => {
  const { ws } = await setup();
  await assert.rejects(ws.operator.removeMember(TID_A, oid(1)), { status: 409 });
  await ws.operator.removeMember(TID_A, oid(2));
  const r = await ws.resolve(bob);
  assert.ok(!r.ok && r.code === 'tenant_in_use');
  const inv = await ws.operator.invite(TID_A, 'dave@contoso.com', operator);
  assert.equal((await ws.operator.info(TID_A)).invites.length, 1);
  await ws.operator.revokeInvite(TID_A, inv.id);
  assert.equal((await ws.operator.info(TID_A)).invites.length, 0);
});

test('operator acts only on the tenant it names, and rejects ids that are not tenant ids', async () => {
  const { ws, storage } = await setup();
  await ws.operator.removeMember(TID_A, oid(3)); // carol belongs to B: nothing to remove in A
  assert.ok((await ws.resolve(carol)).ok);
  assert.ok(await storage.get(`tenants/${TID_B}/tenant.json`));
  for (const bad of ['../' + TID_B, TID_B + '/x', '*', '']) {
    await assert.rejects(ws.operator.files(bad), { status: 404 });
    await assert.rejects(ws.operator.deleteTenant(bad), { status: 404 });
    await assert.rejects(ws.operator.removeMember(bad, oid(1)), { status: 404 });
  }
});

test('deleting a tenant removes all of its files and nothing else', async () => {
  const { ws, storage } = await setup();
  const n = await ws.operator.deleteTenant(TID_A);
  assert.ok(n >= 4);
  assert.deepEqual(await storage.list(`tenants/${TID_A}/`), []);
  assert.ok(await storage.get(`tenants/${TID_B}/tenant.json`));
  assert.ok((await ws.resolve(carol)).ok);
  await assert.rejects(ws.operator.deleteTenant(TID_A), { status: 404 }); // already gone
  const next = await ws.resolve(bob); // the next user from that tenant starts fresh as owner
  assert.ok(next.ok && next.workspace.role === 'owner');
});

test('the self-host edition has no operator operations', () => {
  const single: Workspaces = new SingleWorkspace(new LocalStorage(tmpdir()));
  assert.equal(single.operator, undefined);
});

// ---- extension point

const cfg = { edition: 'hosted', basemap: 'none' } as unknown as Config;
const request = (method = 'GET', headers: Record<string, string> = {}): IncomingMessage => {
  const r = Readable.from([]) as unknown as IncomingMessage;
  Object.assign(r, { method, headers: { 'x-requested-with': 'imdf-app', ...headers } });
  return r;
};

test('without an extension /api/ext answers 404, for every user', async () => {
  const { ws } = await setup();
  const api = createApi(cfg, ws);
  for (const u of [alice, operator]) await assert.rejects(api(request(), new URL('http://x/api/ext/tenants'), u), { status: 404 });
});

test('an extension is loaded from EXTENSION_MODULE and gets the operator operations', async () => {
  const { ws, storage } = await setup();
  const file = join(await mkdtemp(join(tmpdir(), 'pb-ext-')), 'ext.mjs');
  await writeFile(file, `export default (ctx) => ({
    async handle({ user, path }) {
      if (user.tenantId !== '${TID_B}' || user.id !== '${operator.id}') throw new ctx.HttpError(403, 'Not the operator.');
      if (path[0] !== 'tenants') return null;
      return { status: 200, body: JSON.stringify(await ctx.operator.listTenants()) };
    },
  });`);
  const ext = await loadExtension({ ...cfg, extensionModule: file } as Config, storage, ws);
  assert.ok(ext);
  const api = createApi(cfg, ws, ext);
  const r = await api(request(), new URL('http://x/api/ext/tenants'), operator);
  assert.equal(JSON.parse(String(r.body)).length, 2);
  await assert.rejects(api(request(), new URL('http://x/api/ext/tenants'), alice), { status: 403 }); // a tenant owner
  await assert.rejects(api(request(), new URL('http://x/api/ext/tenants'), carol), { status: 403 }); // same tenant as the operator, other user
  await assert.rejects(api(request(), new URL('http://x/api/ext/other'), operator), { status: 404 }); // not handled: 404
  await assert.rejects(api(request('POST', { 'x-requested-with': '' }), new URL('http://x/api/ext/tenants'), operator), { status: 403 }); // the CSRF check still applies
});

test('an extension module without a default function is refused at start', async () => {
  const { ws, storage } = await setup();
  const file = join(await mkdtemp(join(tmpdir(), 'pb-ext-')), 'bad.mjs');
  await writeFile(file, 'export const x = 1;');
  await assert.rejects(loadExtension({ ...cfg, extensionModule: file } as Config, storage, ws), /default export/);
  assert.equal(await loadExtension({ ...cfg, extensionModule: '' } as Config, storage, ws), null);
});

test('audit lines carry the tenant of the caller (and the target tenant of an operator)', () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (s: string) => { lines.push(s); };
  try {
    audit(alice, 'office.create o1');
    audit(operator, 'tenant.delete', TID_A);
  } finally {
    console.log = orig;
  }
  const [x, y] = lines.map((l) => JSON.parse(l));
  assert.equal(x.tid, TID_A);
  assert.equal(x.target, undefined);
  assert.equal(y.tid, TID_B);
  assert.equal(y.target, TID_A);
});
