import type { Config } from './config.ts';

export interface Tile {
  body: Buffer;
  contentType: string;
}

let token: { value: string; exp: number } | null = null;

async function azureToken(): Promise<string> {
  if (token && token.exp - Date.now() > 120_000) return token.value;
  const { DefaultAzureCredential } = await import('@azure/identity');
  const t = await new DefaultAzureCredential().getToken('https://atlas.microsoft.com/.default');
  token = { value: t.token, exp: t.expiresOnTimestamp };
  return token.value;
}

async function azureHeaders(cfg: Config): Promise<Record<string, string>> {
  if (cfg.azureMapsKey) return { 'subscription-key': cfg.azureMapsKey };
  return { Authorization: `Bearer ${await azureToken()}`, 'x-ms-client-id': cfg.azureMapsClientId ?? '' };
}

const int = (s: string) => (/^\d{1,8}$/.test(s) ? Number(s) : NaN);

export function validTile(z: number, x: number, y: number): boolean {
  return Number.isInteger(z) && z >= 0 && z <= 22 && x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z;
}

/** Satellite tiles through the server so keys and tokens never reach the browser. */
export async function fetchTile(cfg: Config, zs: string, xs: string, ys: string): Promise<Tile | null> {
  const z = int(zs), x = int(xs), y = int(ys);
  if (!validTile(z, x, y)) return null;
  if (cfg.basemap === 'none') return null;
  let url: string;
  let headers: Record<string, string> = { 'User-Agent': 'imdf-places-app' };
  if (cfg.basemap === 'azure') {
    url = `https://atlas.microsoft.com/map/tile?api-version=2024-04-01&tilesetId=microsoft.imagery&zoom=${z}&x=${x}&y=${y}&tileSize=256`;
    headers = { ...headers, ...(await azureHeaders(cfg)) };
  } else {
    // Development fallback only. The OSM tile policy forbids heavy or production use.
    url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Tile request failed (${res.status}).`);
  return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'image/png' };
}

export interface GeoHit {
  label: string;
  lon: number;
  lat: number;
}

export async function geocode(cfg: Config, q: string): Promise<GeoHit[]> {
  q = q.trim().slice(0, 200);
  if (!q) return [];
  if (cfg.basemap === 'azure') {
    const url = `https://atlas.microsoft.com/search/address/json?api-version=1.0&limit=5&query=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: await azureHeaders(cfg), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Search failed (${res.status}).`);
    const j = (await res.json()) as { results?: { address?: { freeformAddress?: string }; position?: { lat: number; lon: number } }[] };
    return (j.results ?? []).filter((r) => r.position).map((r) => ({ label: r.address?.freeformAddress ?? q, lon: r.position!.lon, lat: r.position!.lat }));
  }
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'imdf-places-app' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Search failed (${res.status}).`);
  const j = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return j.map((r) => ({ label: r.display_name, lon: Number(r.lon), lat: Number(r.lat) }));
}
