import type { User } from './auth.ts';

/**
 * One JSON line per action, to the console (Log Analytics in the hosted edition).
 * `tid` is the Entra tenant of the caller, so the lines of one organization can be found.
 * `target` is the tenant an operator acted on, when that differs from the caller's own.
 */
export function audit(user: User, what: string, target?: string): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), user: user.id, tid: user.tenantId, ...(target ? { target } : {}), what }));
}
