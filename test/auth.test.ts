import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, decodePrincipal, whoami } from '../src/server/auth.ts';
import type { Config } from '../src/server/config.ts';

const principal = (claims: { typ: string; val: string }[]) => ({
  'x-ms-client-principal': Buffer.from(JSON.stringify({ claims, name_typ: 'name' })).toString('base64'),
});
const cfg = (over: Partial<Config> = {}) =>
  ({ devAuth: false, production: true, easyAuthEnabled: true, allowedGroups: ['g1'], allowedRoles: [], allowedUsers: [], allowAnyAuthenticated: false, ...over }) as unknown as Config;

const CLAIMS = [
  { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: 'oid-1' },
  { typ: 'http://schemas.microsoft.com/identity/claims/tenantid', val: 'tid-1' },
  { typ: 'iss', val: 'https://login.microsoftonline.com/tid-1/v2.0' },
  { typ: 'name', val: 'Alex' },
];

test('decodePrincipal reads user, tenant and issuer', () => {
  const u = decodePrincipal(principal(CLAIMS))!;
  assert.equal(u.id, 'oid-1');
  assert.equal(u.tenantId, 'tid-1');
  assert.equal(u.issuer, 'https://login.microsoftonline.com/tid-1/v2.0');
  assert.ok(u.claimTypes!.includes('iss'));
});

test('a user outside the allowed groups is refused, and whoami explains why without leaking tokens', () => {
  assert.equal(authenticate(principal(CLAIMS), cfg()).ok, false);
  const w = whoami(principal(CLAIMS), cfg());
  assert.equal(w.status, 200);
  const b = w.body as Record<string, unknown>;
  assert.equal(b.tenantId, 'tid-1');
  assert.equal(b.allowed, false);
  assert.match(String(b.reason), /not allowed/);
  assert.ok(!JSON.stringify(b).includes('Bearer'));
});

test('whoami needs Easy Auth in production and a principal', () => {
  assert.equal(whoami(principal(CLAIMS), cfg({ easyAuthEnabled: false })).status, 503);
  assert.equal(whoami({}, cfg()).status, 401);
});
