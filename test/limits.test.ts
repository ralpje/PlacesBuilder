import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { LocalStorage } from '../src/server/storage.ts';
import { PrefixedStorage } from '../src/server/workspaces.ts';
import { HttpError, Repo } from '../src/server/repo.ts';
import { readBody } from '../src/server/api.ts';
import { loadConfig, NO_LIMITS } from '../src/server/config.ts';
import type { Limits } from '../src/server/config.ts';

const png = (size: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size)]);
const pdf = (size: number) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(size)]);
const meta = { width: 200, height: 200 };
const limits = (over: Partial<Limits>): Limits => ({ ...NO_LIMITS, ...over });

async function repoWith(over: Partial<Limits>) {
  const storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'pb-lim-')));
  return { storage, repo: new Repo(storage, limits(over)) };
}

async function rejects(p: Promise<unknown>, status: number, limit: string) {
  await assert.rejects(p, (e: unknown) => e instanceof HttpError && e.status === status && (e.body as { limit?: string })?.limit === limit);
}

test('limits are read from the environment; empty means no limit; garbage is refused', () => {
  assert.deepEqual(loadConfig({}).limits, NO_LIMITS);
  const l = loadConfig({ MAX_OFFICES: '10', MAX_FLOORS_PER_OFFICE: '20', MAX_UPLOAD_MB: '25', MAX_STORAGE_MB: '500' }).limits;
  assert.equal(l.maxOffices, 10);
  assert.equal(l.maxFloorsPerOffice, 20);
  assert.equal(l.maxUploadBytes, 25 * 1024 * 1024);
  assert.equal(l.maxStorageBytes, 500 * 1024 * 1024);
  assert.throws(() => loadConfig({ MAX_OFFICES: 'ten' }), /MAX_OFFICES/);
});

test('no limits set: nothing is refused', async () => {
  const { repo } = await repoWith({});
  for (let i = 0; i < 12; i++) await repo.createOffice({ name: `O${i}` });
  assert.equal((await repo.listOffices()).length, 12);
});

test('office limit per workspace; deleting an office frees a place', async () => {
  const { repo } = await repoWith({ maxOffices: 2 });
  const a = await repo.createOffice({ name: 'A' });
  await repo.createOffice({ name: 'B' });
  await rejects(repo.createOffice({ name: 'C' }), 403, 'offices');
  await repo.deleteOffice(a.id);
  await repo.createOffice({ name: 'C' });
});

test('floor limit per office', async () => {
  const { repo } = await repoWith({ maxFloorsPerOffice: 2 });
  const o = await repo.createOffice({ name: 'A' });
  const o2 = await repo.createOffice({ name: 'B' });
  await repo.createFloor(o.id, { name: '1', ordinal: 1 });
  await repo.createFloor(o.id, { name: '2', ordinal: 2 });
  await rejects(repo.createFloor(o.id, { name: '3', ordinal: 3 }), 403, 'floors');
  await repo.createFloor(o2.id, { name: '1', ordinal: 1 }); // another office has its own count
});

test('upload limit applies to each file', async () => {
  const { repo } = await repoWith({ maxUploadBytes: 1000 });
  const o = await repo.createOffice({ name: 'A' });
  const f = await repo.createFloor(o.id, { name: '1', ordinal: 1 });
  await rejects(repo.putPlan(o.id, f.id, png(2000), meta), 413, 'upload');
  await repo.putPlan(o.id, f.id, png(500), meta);
  await rejects(repo.putOriginal(o.id, f.id, pdf(2000), 'plan.pdf'), 413, 'upload');
});

test('storage limit counts all files of the workspace; replacing a file does not count twice', async () => {
  const { repo } = await repoWith({ maxStorageBytes: 20_000 });
  const o = await repo.createOffice({ name: 'A' });
  const f1 = await repo.createFloor(o.id, { name: '1', ordinal: 1 });
  const f2 = await repo.createFloor(o.id, { name: '2', ordinal: 2 });
  await repo.putPlan(o.id, f1.id, png(8000), meta);
  await repo.putOriginal(o.id, f1.id, pdf(8000), 'a.pdf');
  await rejects(repo.putPlan(o.id, f2.id, png(8000), meta), 403, 'storage');
  await repo.putPlan(o.id, f1.id, png(9000), meta); // replaces the 8000 byte plan of floor 1
  await repo.putPlan(o.id, f2.id, png(500), meta);
});

test('storage limit is per workspace: another workspace in the same storage is not affected', async () => {
  const storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'pb-lim-')));
  const l = limits({ maxStorageBytes: 5000 });
  const a = new Repo(new PrefixedStorage(storage, 'tenants/a/data/'), l);
  const b = new Repo(new PrefixedStorage(storage, 'tenants/b/data/'), l);
  const oa = await a.createOffice({ name: 'A' });
  const fa = await a.createFloor(oa.id, { name: '1', ordinal: 1 });
  await a.putPlan(oa.id, fa.id, png(4000), meta);
  const fa2 = await a.createFloor(oa.id, { name: '2', ordinal: 2 });
  await rejects(a.putPlan(oa.id, fa2.id, png(4000), meta), 403, 'storage');
  const ob = await b.createOffice({ name: 'B' });
  const fb = await b.createFloor(ob.id, { name: '1', ordinal: 1 });
  await b.putPlan(ob.id, fb.id, png(4000), meta);
  const sizes = await new PrefixedStorage(storage, 'tenants/a/data/').listWithSize('');
  assert.ok(sizes.every((e) => !e.key.startsWith('tenants/')), 'keys are relative to the workspace');
});

test('the request body is cut off at the limit with a clear message', async () => {
  const req = Readable.from([Buffer.alloc(2 * 1024 * 1024)]) as unknown as IncomingMessage;
  await assert.rejects(readBody(req, 1024 * 1024, 'This plan image'), (e: unknown) => e instanceof HttpError && e.status === 413 && /larger than the limit of 1 MB/.test(e.message));
});
