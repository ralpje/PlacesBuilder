import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasPrincipal, isWelcomePath, renderWelcome, resolveWelcomeFile, serveWelcome, SIGNIN_URL } from '../src/server/landing.ts';
import { loadConfig } from '../src/server/config.ts';

const ROOT = resolve(import.meta.dirname, '../src/web/public');

test('LANDING_PAGE is off by default and on only with 1', () => {
  assert.equal(loadConfig({}).landingPage, false);
  assert.equal(loadConfig({ LANDING_PAGE: 'true' }).landingPage, false);
  assert.equal(loadConfig({ LANDING_PAGE: '1' }).landingPage, true);
});

test('only /welcome and below counts as a welcome path', () => {
  assert.equal(isWelcomePath('/welcome'), true);
  assert.equal(isWelcomePath('/welcome/'), true);
  assert.equal(isWelcomePath('/welcome/welcome.css'), true);
  for (const p of ['/', '/welcomed', '/api/offices', '/assets/x.js', '/whoami', '/welcome.html']) assert.equal(isWelcomePath(p), false, p);
});

test('resolveWelcomeFile stays inside the welcome folder and allows only listed file types', () => {
  assert.ok(resolveWelcomeFile(ROOT, '/welcome/')!.endsWith('welcome/index.html'));
  assert.ok(resolveWelcomeFile(ROOT, '/welcome')!.endsWith('welcome/index.html'));
  assert.ok(resolveWelcomeFile(ROOT, '/welcome/welcome.css')!.endsWith('welcome/welcome.css'));
  const bad = [
    '/welcome/../index.html', '/welcome/%2e%2e/index.html', '/welcome/..%2findex.html', '/welcome/%2e%2e%2fapi',
    '/welcome/..%5cindex.html', '/welcome/%00.css', '/welcome/%E0%A4%A', '/welcome/a.js', '/welcome/a.json', '/welcome/noext', '/welcome//etc/passwd',
  ];
  for (const p of bad) assert.equal(resolveWelcomeFile(ROOT, p), null, p);
});

test('serveWelcome returns 404 for anything that is not a welcome file, and never the SPA index', async () => {
  const cfg = { donateUrl: '', terms: null };
  assert.equal((await serveWelcome(ROOT, '/welcome/missing.css', cfg)).status, 404);
  assert.equal((await serveWelcome(ROOT, '/welcome/../index.html', cfg)).status, 404);
  const ok = await serveWelcome(ROOT, '/welcome/', cfg);
  assert.equal(ok.status, 200);
  assert.match(ok.headers['Content-Type'], /text\/html/);
});

test('hasPrincipal only looks for a non-empty identity header', () => {
  assert.equal(hasPrincipal({}), false);
  assert.equal(hasPrincipal({ 'x-ms-client-principal': '' }), false);
  assert.equal(hasPrincipal({ 'x-ms-client-principal': 'abc' }), true);
});

test('renderWelcome fills the sign-in link and only the links that are configured, escaped', () => {
  const tpl = '<a href="{{SIGNIN_URL}}">in</a><!--LEGAL_LINKS--><!--DONATE-->';
  const none = renderWelcome(tpl, { donateUrl: '', terms: null });
  assert.ok(none.includes(SIGNIN_URL.replace(/&/g, '&amp;')));
  assert.ok(!none.includes('Terms of use') && !none.includes('Support'));
  const all = renderWelcome(tpl, {
    donateUrl: 'https://github.com/sponsors/x?a=1&b="2"',
    terms: { version: '1', termsUrl: 'https://e.test/t', privacyUrl: 'https://e.test/p', dpaUrl: 'https://e.test/d' },
  });
  assert.ok(all.includes('Terms of use') && all.includes('Privacy statement') && all.includes('Data processing agreement') && all.includes('Support the project'));
  assert.ok(all.includes('a=1&amp;b=&quot;2&quot;'));
  assert.ok(!all.includes('{{') && !all.includes('<!--'));
});

test('the welcome page template is self-contained: no external scripts, styles, fonts, images or frames', () => {
  const html = readFileSync(resolve(ROOT, 'welcome/index.html'), 'utf8');
  const css = readFileSync(resolve(ROOT, 'welcome/welcome.css'), 'utf8');
  assert.ok(!/<script/i.test(html), 'no scripts');
  assert.ok(!/<iframe|<frame|<object|<embed/i.test(html));
  assert.ok(!/(src|srcset)=["']?https?:/i.test(html), 'no external src');
  assert.ok(!/<link[^>]+href=["']https?:/i.test(html), 'no external link');
  assert.ok(!/url\(\s*["']?https?:/i.test(css) && !/@import/i.test(css), 'no external css');
  // every local file it refers to exists
  const refs = [...html.matchAll(/(?:src|href)=["'](\/[^"'#?]+)/g)].map((m) => m[1]).filter((r) => !r.startsWith('/.auth'));
  for (const r of refs) assert.ok(existsSync(resolve(ROOT, r.slice(1))), `missing ${r}`);
  for (const m of css.matchAll(/url\(([^)]+)\)/g)) assert.ok(existsSync(resolve(ROOT, 'welcome', m[1].replace(/["']/g, ''))), `missing css ${m[1]}`);
});
