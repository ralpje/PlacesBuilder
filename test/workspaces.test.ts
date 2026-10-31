import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { LocalStorage } from '../src/server/storage.ts';
import { PrefixedStorage, TenantWorkspaces, SingleWorkspace, maskEmail, maskName, MEMBER_LIMIT } from '../src/server/workspaces.ts';
import { createApi } from '../src/server/api.ts';
import type { Config } from '../src/server/config.ts';
import type { User } from '../src/server/auth.ts';

const TID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const oid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = (tid: string, n: number, name: string, email: string): User => ({ id: oid(n), name, roles: [], groups: [], tenantId: tid, email });

const alice = user(TID_A, 1, 'Alice Anderson', 'alice@contoso.com');
const bob = user(TID_A, 2, 'Bob Brown', 'Bob@Contoso.com');
const carol = user(TID_B, 3, 'Carol Clark', 'carol@fabrikam.com');

async function setup() {
  const storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'pb-ws-')));
  return { storage, ws: new TenantWorkspaces(storage) };
}

const cfg = { edition: 'hosted', basemap: 'none' } as unknown as Config;
function request(method: string, body?: unknown): IncomingMessage {
  const r = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(r, { method, headers: { 'x-requested-with': 'imdf-app' } });
  return r;
}
const call = (api: ReturnType<typeof createApi>, u: User, method: string, path: string, body?: unknown) =>
  api(request(method, body), new URL(`http://x${path}`), u).then(
    (r) => ({ status: r.status, body: JSON.parse(String(r.body || 'null')) as Record<string, any> }),
    (e: { status?: number; message: string; body?: unknown }) => ({ status: e.status ?? 500, body: { error: e.message, detail: e.body } as Record<string, any> }),
  );

test('the first user of a tenant becomes its owner', async () => {
  const { ws } = await setup();
  const r = await ws.resolve(alice);
  assert.ok(r.ok && r.workspace.role === 'owner' && r.workspace.id === TID_A);
});

test('two users racing for a new tenant: exactly one owner', async () => {
  const { ws } = await setup();
  const [x, y] = await Promise.all([ws.resolve(alice), ws.resolve(bob)]);
  assert.equal([x, y].filter((r) => r.ok).length, 1);
  const loser = [x, y].find((r) => !r.ok)!;
  assert.equal(!loser.ok && loser.code, 'tenant_in_use');
});

test('another user of the same tenant is refused with a masked owner hint', async () => {
  const { ws } = await setup();
  await ws.resolve(alice);
  const r = await ws.resolve(bob);
  assert.ok(!r.ok);
  assert.equal(r.code, 'tenant_in_use');
  assert.match(r.message, /already uses Places Builder/);
  assert.match(r.message, /A••• A•••/);
  assert.match(r.message, /a•••@contoso\.com/);
  assert.ok(!r.message.includes('Alice'));
  assert.ok(!r.message.includes('alice@'));
});

test('an invited user joins by e-mail (case-insensitive), the invite is used up, and they share the data', async () => {
  const { ws } = await setup();
  const a = await ws.resolve(alice);
  assert.ok(a.ok && a.workspace.admin);
  const inv = await a.workspace.admin!.invite('BOB@contoso.com', alice);
  assert.equal(inv.email, 'bob@contoso.com');
  const office = await a.workspace.repo.createOffice({ name: 'HQ' });
  const b = await ws.resolve(bob);
  assert.ok(b.ok && b.workspace.role === 'member');
  assert.equal((await b.workspace.repo.listOffices()).length, 1);
  assert.equal((await b.workspace.repo.getOffice(office.id)).name, 'HQ');
  const info = await a.workspace.admin!.info();
  assert.equal(info.invites.length, 0);
  assert.equal(info.members.length, 2);
});

test('data of one tenant is invisible to another, even with the same office id', async () => {
  const { ws } = await setup();
  const a = await ws.resolve(alice);
  const c = await ws.resolve(carol);
  assert.ok(a.ok && c.ok);
  const office = await a.workspace.repo.createOffice({ name: 'Secret HQ' });
  assert.equal((await c.workspace.repo.listOffices()).length, 0);
  await assert.rejects(c.workspace.repo.getOffice(office.id), (e: { status?: number }) => e.status === 404);
});

test('an invite for one tenant does not work in another tenant', async () => {
  const { ws } = await setup();
  const a = await ws.resolve(alice);
  assert.ok(a.ok);
  await a.workspace.admin!.invite('carol@fabrikam.com', alice);
  await ws.resolve(user(TID_B, 9, 'Dan Dunn', 'dan@fabrikam.com')); // dan owns tenant B
  const c = await ws.resolve(carol);
  assert.ok(!c.ok, 'carol is in tenant B; the invite belongs to tenant A');
});

test('only the owner can invite and remove; the owner cannot remove themselves', async () => {
  const { ws } = await setup();
  const a = await ws.resolve(alice);
  assert.ok(a.ok);
  await a.workspace.admin!.invite(bob.email!, alice);
  const b = await ws.resolve(bob);
  assert.ok(b.ok);
  await assert.rejects(b.workspace.admin!.invite('x@contoso.com', bob), (e: { status?: number }) => e.status === 403);
  await assert.rejects(b.workspace.admin!.removeMember(alice.id, bob), (e: { status?: number }) => e.status === 403);
  await assert.rejects(a.workspace.admin!.removeMember(alice.id, alice), (e: { status?: number }) => e.status === 400);
  await a.workspace.admin!.removeMember(bob.id, alice);
  assert.ok(!(await ws.resolve(bob)).ok, 'a removed member is out again, immediately');
  const info = await b.workspace.admin!.info();
  assert.equal(info.invites.length, 0, 'members do not see invitations');
});

test('invite limits and validation', async () => {
  const { ws } = await setup();
  const a = await ws.resolve(alice);
  assert.ok(a.ok);
  await assert.rejects(a.workspace.admin!.invite('not-an-email', alice), (e: { status?: number }) => e.status === 400);
  for (let i = 0; i < MEMBER_LIMIT - 1; i++) await a.workspace.admin!.invite(`u${i}@contoso.com`, alice);
  await assert.rejects(a.workspace.admin!.invite('one-too-many@contoso.com', alice), (e: { status?: number }) => e.status === 409);
});

test('identities that are not GUIDs never reach storage', async () => {
  const { ws } = await setup();
  const r = await ws.resolve({ ...alice, tenantId: '../../etc' });
  assert.ok(!r.ok && r.code === 'invalid_identity');
  const r2 = await ws.resolve({ ...alice, id: 'not-a-guid' });
  assert.ok(!r2.ok && r2.code === 'invalid_identity');
});

test('a prefixed storage cannot leave its prefix', async () => {
  const { storage } = await setup();
  const p = new PrefixedStorage(storage, 'tenants/a/data/');
  await assert.rejects(p.get('../../b/data/x.json'));
  await assert.rejects(p.put('../x.json', Buffer.from('x'), 'text/plain'));
  assert.throws(() => new PrefixedStorage(storage, '../'));
});

test('masking shows only the first letter of the name and the e-mail domain', () => {
  assert.equal(maskName('Alex Sample'), 'A••• S•••');
  assert.equal(maskName(''), '•••');
  assert.equal(maskEmail('alex.sample@contoso.com'), 'a•••@contoso.com');
  assert.equal(maskEmail('nonsense'), '');
});

test('API: blocked users get a clear 403 on data routes and a readable /api/me', async () => {
  const { ws } = await setup();
  const api = createApi(cfg, ws);
  await call(api, alice, 'GET', '/api/me');
  const me = await call(api, bob, 'GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.workspace, null);
  assert.equal(me.body.blocked.code, 'tenant_in_use');
  const offices = await call(api, bob, 'GET', '/api/offices');
  assert.equal(offices.status, 403);
  assert.equal(offices.body.detail.code, 'tenant_in_use');
  assert.equal((await call(api, bob, 'GET', '/api/workspace')).status, 403);
});

test('API: cross-tenant isolation on office routes', async () => {
  const { ws } = await setup();
  const api = createApi(cfg, ws);
  const created = await call(api, alice, 'POST', '/api/offices', { name: 'HQ' });
  assert.equal(created.status, 201);
  const id = created.body.id as string;
  assert.equal((await call(api, alice, 'GET', `/api/offices/${id}`)).status, 200);
  for (const [m, p] of [['GET', `/api/offices/${id}`], ['GET', `/api/offices/${id}/validate`], ['GET', `/api/offices/${id}/export.zip`]] as const) {
    const r = await call(api, carol, m, p);
    assert.equal(r.status, 404, `${m} ${p} must be 404 for another tenant`);
  }
  // Deleting is idempotent here (an unknown id is "already gone"); what matters is that tenant A's data survives.
  const del = await call(api, carol, 'DELETE', `/api/offices/${id}`);
  assert.ok(del.status === 200 || del.status === 404);
  assert.equal((await call(api, carol, 'PUT', `/api/offices/${id}`, { rev: 1, name: 'Hijacked' })).status, 404);
  assert.equal((await call(api, alice, 'GET', `/api/offices/${id}`)).status, 200, 'still there');
  assert.deepEqual((await call(api, carol, 'GET', '/api/offices')).body, []);
});

test('API: the owner manages members through /api/workspace', async () => {
  const { ws } = await setup();
  const api = createApi(cfg, ws);
  const inv = await call(api, alice, 'POST', '/api/workspace/invites', { email: 'bob@contoso.com' });
  assert.equal(inv.status, 201);
  const mine = await call(api, bob, 'GET', '/api/workspace');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.role, 'member');
  assert.equal((await call(api, bob, 'POST', '/api/workspace/invites', { email: 'x@contoso.com' })).status, 403);
  assert.equal((await call(api, alice, 'DELETE', `/api/workspace/members/${bob.id}`)).status, 200);
  assert.equal((await call(api, bob, 'GET', '/api/workspace')).status, 403);
});

test('self-host edition: one shared workspace, no member management', async () => {
  const { storage } = await setup();
  const api = createApi({ ...cfg, edition: 'selfhost' } as Config, new SingleWorkspace(storage));
  assert.equal((await call(api, alice, 'POST', '/api/offices', { name: 'HQ' })).status, 201);
  assert.equal((await call(api, carol, 'GET', '/api/offices')).body.length, 1, 'everyone who is let in shares the data');
  assert.equal((await call(api, alice, 'GET', '/api/workspace')).status, 404);
  const me = await call(api, alice, 'GET', '/api/me');
  assert.equal(me.body.workspace.canManageMembers, false);
});
