import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, decodePrincipal, whoami } from '../src/server/auth.ts';
import type { Config } from '../src/server/config.ts';

const principal = (claims: { typ: string; val: string }[]) => ({
  'x-ms-client-principal': Buffer.from(JSON.stringify({ claims, name_typ: 'name' })).toString('base64'),
});
const cfg = (over: Partial<Config> = {}) =>
  ({ devAuth: false, production: true, easyAuthEnabled: true, allowedGroups: ['g1'], allowedRoles: [], allowedUsers: [], allowedTenants: [], allowAnyAuthenticated: false, ...over }) as unknown as Config;

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

const withClaims = (over: Record<string, string>) =>
  principal(CLAIMS.map((c) => (over[c.typ] ? { ...c, val: over[c.typ]! } : c)));
const TID = 'http://schemas.microsoft.com/identity/claims/tenantid';
const open = () => cfg({ allowedGroups: [], allowAnyAuthenticated: true, allowedTenants: [] });

test('the user id is the oid claim, even when the header carries another id', () => {
  const h = { ...principal(CLAIMS), 'x-ms-client-principal-id': 'pairwise-sub' };
  assert.equal(decodePrincipal(h)!.id, 'oid-1');
});

test('personal Microsoft accounts are refused', () => {
  const h = withClaims({ [TID]: '9188040d-6c67-4c5b-b112-36a304b66dad', iss: 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0' });
  const r = authenticate(h, open());
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /Personal Microsoft accounts/);
});

test('an issuer that does not belong to the tenant is refused', () => {
  const r = authenticate(withClaims({ iss: 'https://login.microsoftonline.com/other-tenant/v2.0' }), open());
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /unexpected issuer/);
});

test('ALLOWED_TENANT_IDS limits access to the listed tenants (case-insensitive)', () => {
  assert.equal(authenticate(principal(CLAIMS), { ...open(), allowedTenants: ['tid-1'] } as Config).ok, true);
  const r = authenticate(principal(CLAIMS), { ...open(), allowedTenants: ['other'] } as Config);
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /organization is not allowed/);
});

test('a sign-in without a tenant claim is refused', () => {
  const r = authenticate(principal(CLAIMS.filter((c) => c.typ !== TID)), open());
  assert.equal(r.ok, false);
});
