import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { loadConfig } from './config.ts';
import { authenticate, whoami } from './auth.ts';
import { createStorage } from './storage.ts';
import { createWorkspaces } from './workspaces.ts';
import { createApi, errorReply, sendReply } from './api.ts';

const cfg = loadConfig();
const workspaces = createWorkspaces(cfg, await createStorage(cfg));
const api = createApi(cfg, workspaces);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.map': 'application/json',
  '.wasm': 'application/wasm', '.mjs': 'text/javascript; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob:; frame-ancestors 'none'",
};

const root = resolve(cfg.staticDir);

async function serveStatic(pathname: string): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = resolve(root, rel || 'index.html');
  if (file !== root && !file.startsWith(root + sep)) file = join(root, 'index.html');
  const tryRead = async (p: string) => {
    try { return await readFile(p); } catch { return null; }
  };
  let body = await tryRead(file);
  if (!body && !extname(file)) {
    file = join(root, 'index.html'); // SPA fallback
    body = await tryRead(file);
  }
  if (!body) return { status: 404, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('Not found') };
  const hashed = file.includes(`${sep}assets${sep}`);
  return {
    status: 200,
    headers: { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' },
    body,
  };
}

const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (url.pathname === '/whoami') {
      const w = whoami(req.headers, cfg);
      res.writeHead(w.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(w.body, null, 2));
      return;
    }
    const auth = authenticate(req.headers, cfg);
    if (!auth.ok) {
      res.writeHead(auth.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: auth.message }));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      sendReply(res, await api(req, url, auth.user));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    const s = await serveStatic(url.pathname);
    res.writeHead(s.status, s.headers);
    res.end(s.body);
  } catch (err) {
    if (!res.headersSent) sendReply(res, errorReply(err));
    else res.end();
  }
});

server.listen(cfg.port, () => console.log(`Listening on ${cfg.port} (${cfg.devAuth ? 'DEV AUTH' : 'Easy Auth'}, storage: ${cfg.storageAccountUrl ? 'blob' : cfg.dataDir})`));
