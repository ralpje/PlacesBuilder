import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Config {
  port: number;
  production: boolean;
  dataDir: string; // local storage folder, used when STORAGE_ACCOUNT_URL is not set
  storageAccountUrl?: string; // https://<account>.blob.core.windows.net
  container: string;
  basemap: 'azure' | 'osm' | 'none';
  azureMapsClientId?: string; // needed with Entra authentication
  azureMapsKey?: string; // alternative: key authentication
  devAuth: boolean; // local development only: skips Easy Auth
  allowedGroups: string[];
  allowedRoles: string[];
  allowedUsers: string[];
  allowedTenants: string[]; // when set, only users of these Entra tenants (tid) are let in
  allowAnyAuthenticated: boolean; // rely on Entra "Assignment required" alone
  staticDir: string;
  edition: 'selfhost' | 'hosted'; // hosted = one workspace per Entra tenant, selfhost = one shared workspace
  easyAuthEnabled: boolean; // App Service sets WEBSITE_AUTH_ENABLED=True when authentication is switched on
}

const list = (v?: string) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const devAuth = env.DEV_AUTH === '1';
  if (production && devAuth) throw new Error('DEV_AUTH must not be set in production.');

  const azureMapsClientId = env.AZURE_MAPS_CLIENT_ID || undefined;
  const azureMapsKey = env.AZURE_MAPS_KEY || undefined;
  const wanted = env.BASEMAP as Config['basemap'] | undefined;
  const basemap: Config['basemap'] =
    wanted ?? (azureMapsClientId || azureMapsKey ? 'azure' : production ? 'none' : 'osm');

  const here = import.meta.dirname;
  const candidates = [env.STATIC_DIR, resolve(here, '../web'), resolve(here, '../../dist/web')].filter(Boolean) as string[];
  const staticDir = candidates.find((p) => existsSync(p)) ?? candidates[candidates.length - 1];

  return {
    port: Number(env.PORT) || 3000,
    production,
    dataDir: resolve(env.DATA_DIR || '.data'),
    storageAccountUrl: env.STORAGE_ACCOUNT_URL || undefined,
    container: env.STORAGE_CONTAINER || 'imdf',
    basemap,
    azureMapsClientId,
    azureMapsKey,
    devAuth,
    allowedGroups: list(env.ALLOWED_GROUP_IDS),
    allowedRoles: list(env.ALLOWED_ROLES),
    allowedUsers: list(env.ALLOWED_USER_IDS),
    allowedTenants: list(env.ALLOWED_TENANT_IDS).map((t) => t.toLowerCase()),
    allowAnyAuthenticated: env.ALLOW_ANY_AUTHENTICATED === '1',
    staticDir,
    edition: env.EDITION === 'hosted' ? 'hosted' : 'selfhost',
    easyAuthEnabled: env.WEBSITE_AUTH_ENABLED === 'True',
  };
}
