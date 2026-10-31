import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { APP_VERSION } from '../shared/version.ts';
import type { MeInfo } from '../shared/types.ts';
import { NoAccess } from './pages/NoAccess.tsx';

type Theme = 'auto' | 'light' | 'dark';
const KEY = 'pb-theme';

function readTheme(): Theme {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v; } catch { /* storage not available */ }
  return 'auto';
}
function applyTheme(t: Theme) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* ignore */ }
}

const icon = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

// App Service authentication (Easy Auth) clears the session cookie and signs out at Entra.
const SIGN_OUT_URL = '/.auth/logout?post_logout_redirect_uri=/';

export function Shell({ children, page }: { children: (me: MeInfo | null) => ReactNode; page?: string }) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [me, setMe] = useState<MeInfo | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const name = me?.name ?? '';
  const [serverVersion, setServerVersion] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { api.me().then(setMe).catch(() => undefined).finally(() => setMeLoaded(true)); }, []);
  useEffect(() => { api.config().then((c) => setServerVersion(c.version)).catch(() => undefined); }, []);
  const next: Theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#/">
          <span className="logo">{icon('M4 21V8l8-5 8 5v13 M9 21v-6h6v6')}</span>
          Places Builder
        </a>
        {!me?.blocked && <a className={page === 'team' ? 'nav' : 'nav active'} href="#/">{icon('M4 21V8l8-5 8 5v13 M9 21v-6h6v6')}Offices</a>}
        {me?.edition === 'hosted' && me.workspace && (
          <a className={page === 'team' ? 'nav active' : 'nav'} href="#/team">{icon('M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0z M4 21a8 8 0 0 1 16 0')}Team</a>
        )}
        <div className="grow" />
        {name && <a className="nav signout-mobile" href={SIGN_OUT_URL}>Sign out</a>}
        <button className="theme" onClick={() => setTheme(next)} title="Switch theme">Theme: {theme}</button>
        {name && (
          <div className="usermenu">
            {menuOpen && (
              <div className="popover" role="menu">
                <a role="menuitem" href={SIGN_OUT_URL}>Sign out</a>
              </div>
            )}
            <button className="user" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} onKeyDown={(e) => { if (e.key === 'Escape') setMenuOpen(false); }}>
              <span className="avatar">{initials}</span>
              <span className="who">{name}</span>
            </button>
          </div>
        )}
        <div className="version">
          Places Builder {APP_VERSION}
          {serverVersion && serverVersion !== APP_VERSION && <> (server {serverVersion})</>}
          <br />
          <a href="https://github.com/ralpje/placesbuilder/issues/new/choose" target="_blank" rel="noreferrer">Report an issue</a>
        </div>
      </aside>
      <main className="content">{!meLoaded ? <p className="muted">Loading…</p> : me?.blocked ? <NoAccess code={me.blocked.code} message={me.blocked.message} /> : children(me)}</main>
    </div>
  );
}
