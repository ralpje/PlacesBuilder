import type { IncomingHttpHeaders } from 'node:http';
import type { Config } from './config.ts';

export interface User {
  id: string;
  name: string;
  roles: string[];
  groups: string[];
}

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; status: 401 | 403; message: string };

const ROLE_TYPES = new Set(['roles', 'role', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role']);
const OID_TYPES = new Set(['oid', 'http://schemas.microsoft.com/identity/claims/objectidentifier']);

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
    const id = (typeof idHeader === 'string' && idHeader) || all((t) => OID_TYPES.has(t))[0] || '';
    if (!id) return null;
    return {
      id,
      name: (typeof nameHeader === 'string' && nameHeader) || all((t) => t === (p.name_typ ?? 'name'))[0] || id,
      roles: all((t) => ROLE_TYPES.has(t)),
      groups: all((t) => t === 'groups'),
    };
  } catch {
    return null;
  }
}

/**
 * Second line of defence behind the Entra "Assignment required" setting.
 * Fails closed: with no policy configured nobody gets in, unless ALLOW_ANY_AUTHENTICATED=1.
 */
export function authenticate(headers: IncomingHttpHeaders, cfg: Config): AuthResult {
  if (cfg.devAuth) return { ok: true, user: { id: 'dev', name: 'Local developer', roles: ['Admin'], groups: [] } };

  const user = decodePrincipal(headers);
  if (!user) return { ok: false, status: 401, message: 'Sign-in required.' };

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
