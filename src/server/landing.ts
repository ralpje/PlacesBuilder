import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Config } from './config.ts';

/**
 * Optional public welcome page (LANDING_PAGE=1). It is a small set of static files under `welcome/` in the web
 * build. Only that folder is ever served without a signed-in user, with a fixed list of file types, and no SPA
 * fallback: every other path still needs an identity.
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

export const SIGNIN_URL = '/.auth/login/aad?post_login_redirect_uri=%2F';

export const isWelcomePath = (pathname: string): boolean => pathname === '/welcome' || pathname.startsWith('/welcome/');

/** True when Easy Auth (or dev auth) has supplied an identity header; the real check stays in `authenticate`. */
export const hasPrincipal = (headers: Record<string, string | string[] | undefined>): boolean => {
  const v = headers['x-ms-client-principal'];
  const first = Array.isArray(v) ? v[0] : v;
  return first !== undefined && first !== '';
};

/** Maps a request path under /welcome/ to a file inside `<root>/welcome`, or null when it is not allowed. */
export function resolveWelcomeFile(root: string, pathname: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.slice('/welcome'.length));
  } catch {
    return null;
  }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  rel = rel.replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  const dir = resolve(root, 'welcome');
  const file = resolve(dir, rel);
  if (!file.startsWith(dir + sep)) return null;
  if (!(extname(file) in MIME)) return null;
  return file;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fills the page template with the links that are configured. Unset links are simply left out. */
export function renderWelcome(html: string, cfg: Pick<Config, 'donateUrl' | 'terms'>): string {
  const legal: string[] = [];
  if (cfg.terms) {
    legal.push(`<a href="${esc(cfg.terms.termsUrl)}">Terms of use</a>`, `<a href="${esc(cfg.terms.privacyUrl)}">Privacy statement</a>`);
    if (cfg.terms.dpaUrl) legal.push(`<a href="${esc(cfg.terms.dpaUrl)}">Data processing agreement</a>`);
  }
  if (cfg.donateUrl) legal.push(`<a href="${esc(cfg.donateUrl)}">Support this project</a>`);
  const donate = cfg.donateUrl ? `<a class="btn btn-ghost" href="${esc(cfg.donateUrl)}">Support the project</a>` : '';
  return html
    .replaceAll('{{SIGNIN_URL}}', esc(SIGNIN_URL))
    .replace('<!--LEGAL_LINKS-->', legal.join(''))
    .replace('<!--DONATE-->', donate);
}

export interface WelcomeReply { status: number; headers: Record<string, string>; body: Buffer }

export async function serveWelcome(root: string, pathname: string, cfg: Pick<Config, 'donateUrl' | 'terms'>): Promise<WelcomeReply> {
  const notFound = { status: 404, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('Not found') };
  const file = resolveWelcomeFile(root, pathname);
  if (!file) return notFound;
  let data: Buffer;
  try {
    data = await readFile(file);
  } catch {
    return notFound;
  }
  const type = MIME[extname(file)];
  if (extname(file) === '.html') {
    return { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' }, body: Buffer.from(renderWelcome(data.toString('utf8'), cfg)) };
  }
  return { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' }, body: data };
}

export const welcomeIndex = (root: string, cfg: Pick<Config, 'donateUrl' | 'terms'>) => serveWelcome(root, '/welcome/', cfg);
