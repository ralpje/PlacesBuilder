import type { IncomingMessage } from 'node:http';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Config } from './config.ts';
import type { User } from './auth.ts';
import type { Reply } from './api.ts';
import type { Storage } from './storage.ts';
import type { OperatorOps, Workspaces } from './workspaces.ts';
import { HttpError } from './repo.ts';
import { audit } from './audit.ts';

/**
 * Extension point for code that does not belong in this repository (the hosted edition's operator tools).
 * Set EXTENSION_MODULE to a JavaScript module whose default export is `(ctx) => Extension`.
 * Without it nothing is loaded and `/api/ext/*` answers 404.
 *
 * The extension is trusted code that runs in the same process, with the same storage access as the app.
 * It decides for itself who may call its routes: the core only authenticates the user (Easy Auth, tenant rules,
 * access policy) and applies the rate limit and the X-Requested-With check before the request gets here.
 */
export interface ExtensionContext {
  cfg: Config;
  storage: Storage;
  workspaces: Workspaces;
  /** Operations on all tenants. Only the hosted edition has them; the extension must check for undefined. */
  operator: OperatorOps | undefined;
  /** Writes an audit line (with the caller's tid). `target` is the tenant acted on. */
  audit: (user: User, what: string, target?: string) => void;
  HttpError: typeof HttpError;
}

export interface ExtensionRequest {
  req: IncomingMessage;
  url: URL;
  user: User;
  /** The path after `/api/ext/`, split and decoded. */
  path: string[];
}

export interface Extension {
  /** Return a reply, or null for "not mine" (the core then answers 404). Throw HttpError for errors. */
  handle(r: ExtensionRequest): Promise<Reply | null>;
}

export type ExtensionFactory = (ctx: ExtensionContext) => Extension | Promise<Extension>;

export async function loadExtension(cfg: Config, storage: Storage, workspaces: Workspaces): Promise<Extension | null> {
  if (!cfg.extensionModule) return null;
  const file = isAbsolute(cfg.extensionModule) ? cfg.extensionModule : resolve(process.cwd(), cfg.extensionModule);
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
  if (typeof mod.default !== 'function') throw new Error(`EXTENSION_MODULE ${cfg.extensionModule} must export a function as its default export.`);
  const ext = await (mod.default as ExtensionFactory)({
    cfg,
    storage,
    workspaces,
    operator: workspaces.operator,
    audit,
    HttpError,
  });
  if (!ext || typeof ext.handle !== 'function') throw new Error('The extension must return an object with a handle() function.');
  console.log(`Extension loaded from ${cfg.extensionModule}`);
  return ext;
}
