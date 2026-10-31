import type { IncomingHttpHeaders } from 'node:http';
import type { Config } from './config.ts';

export interface User {
  id: string;
  name: string;
  roles: string[];
  groups: string[];
  tenantId?: string;
  issuer?: string;
  email?: string;
  claimTypes?: string[];
}

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; status: 401 | 403 | 503; message: string };

const ROLE_TYPES = new Set(['roles', 'role', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role']);
const OID_TYPES = new Set(['oid', 'http://schemas.microsoft.com/identity/claims/objectidentifier']);
/** The tenant behind personal Microsoft accounts (Outlook, Hotmail). Only work or school accounts are supported. */
export const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';
const EMAIL_TYPE = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress';
const TID_TYPES = new Set(['tid', 'http://schemas.microsoft.com/identity/claims/tenantid']);

/** Decodes the X-MS-CLIENT-PRINCIPAL header that App Service authentication (Easy Auth) adds to each request. */
export function decodePrincipal(headers: IncomingHttpHeaders): User | null {
  const raw = headers['x-ms-client-principal'];
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
      claims?: { typ: string; val: string }[];
      name_typ?: string;
    };
    const claims = p.claims ?? [];
    const all = (pred: (t: string) => boolean) => claims.filter((c) => pred(c.typ)).map((c) => c.val);
    const idHeader = headers['x-ms-client-principal-id'];
    const nameHeader = headers['x-ms-client-principal-name'];
    // The oid claim is the user's object id in the tenant. The header id is only a fallback.
    const id = all((t) => OID_TYPES.has(t))[0] || (typeof idHeader === 'string' && idHeader) || '';
    if (!id) return null;
    return {
      id,
      name: (typeof nameHeader === 'string' && nameHeader) || all((t) => t === (p.name_typ ?? 'name'))[0] || id,
      roles: all((t) => ROLE_TYPES.has(t)),
      groups: all((t) => t === 'groups'),
      tenantId: all((t) => TID_TYPES.has(t))[0],
      issuer: all((t) => t === 'iss')[0],
      email: (all((t) => t === 'preferred_username' || t === EMAIL_TYPE)[0] ?? '').toLowerCase() || undefined,
      claimTypes: [...new Set(claims.map((c) => c.typ))].sort(),
    };
  } catch {
    return null;
  }
}

/**
 * Tenant rules that hold whatever the access policy says. Returns a message when the user must be refused.
 * The platform has already checked the token signature; this makes sure tenant and issuer belong together.
 */
export function checkTenant(user: User, cfg: Config): string | null {
  const tid = user.tenantId?.toLowerCase();
  if (!tid) return 'Your sign-in did not include a tenant. Sign in with a work or school account.';
  if (tid === CONSUMER_TENANT_ID) return 'Personal Microsoft accounts are not supported. Sign in with a work or school account.';
  if (user.issuer) {
    const iss = user.issuer.toLowerCase();
    const ok = iss === `https://login.microsoftonline.com/${tid}/v2.0` || iss === `https://sts.windows.net/${tid}/`;
    if (!ok) return 'Your sign-in came from an unexpected issuer.';
  }
  if (cfg.allowedTenants.length > 0 && !cfg.allowedTenants.includes(tid)) return 'Your organization is not allowed to use this app.';
  return null;
}

/**
 * Second line of defence behind the Entra "Assignment required" setting.
 * Fails closed: with no policy configured nobody gets in, unless ALLOW_ANY_AUTHENTICATED=1.
 */
export function authenticate(headers: IncomingHttpHeaders, cfg: Config): AuthResult {
  if (cfg.devAuth) return { ok: true, user: { id: 'dev', name: 'Local developer', roles: ['Admin'], groups: [] } };

  // Without Easy Auth nobody strips a forged X-MS-CLIENT-PRINCIPAL header, so never trust it in that case.
  if (cfg.production && !cfg.easyAuthEnabled) {
    return { ok: false, status: 503, message: 'App Service authentication is not enabled yet. Run scripts/configure-auth.ps1.' };
  }

  const user = decodePrincipal(headers);
  if (!user) return { ok: false, status: 401, message: 'Sign-in required.' };

  const tenantProblem = checkTenant(user, cfg);
  if (tenantProblem) return { ok: false, status: 403, message: tenantProblem };

  const hasPolicy = cfg.allowedGroups.length + cfg.allowedRoles.length + cfg.allowedUsers.length > 0;
  if (!hasPolicy) {
    return cfg.allowAnyAuthenticated
      ? { ok: true, user }
      : { ok: false, status: 403, message: 'No access policy is configured. Set ALLOWED_GROUP_IDS, ALLOWED_ROLES or ALLOWED_USER_IDS.' };
  }
  const allowed =
    cfg.allowedUsers.includes(user.id) ||
    user.groups.some((g) => cfg.allowedGroups.includes(g)) ||
    user.roles.some((r) => cfg.allowedRoles.includes(r));
  return allowed ? { ok: true, user } : { ok: false, status: 403, message: 'Your account is not allowed to use this app.' };
}

/**
 * Shows the caller what the app received from App Service authentication: tenant, issuer, claim names, and whether the
 * access policy lets them in. Only the caller's own identity facts, never tokens. Handy to find out why someone is refused.
 */
export function whoami(headers: IncomingHttpHeaders, cfg: Config): { status: number; body: unknown } {
  if (cfg.devAuth) return { status: 200, body: { userId: 'dev', name: 'Local developer', allowed: true } };
  if (cfg.production && !cfg.easyAuthEnabled) return { status: 503, body: { error: 'App Service authentication is not enabled yet.' } };
  const user = decodePrincipal(headers);
  if (!user) return { status: 401, body: { error: 'Sign-in required.' } };
  const result = authenticate(headers, cfg);
  return {
    status: 200,
    body: {
      userId: user.id,
      name: user.name,
      tenantId: user.tenantId ?? null,
      issuer: user.issuer ?? null,
      claimTypes: user.claimTypes ?? [],
      groupCount: user.groups.length,
      groupsOverage: (user.claimTypes ?? []).includes('_claim_names'),
      allowed: result.ok,
      reason: result.ok ? null : result.message,
    },
  };
}
