import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { APP_VERSION } from '../shared/version.ts';

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

export function Shell({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [name, setName] = useState('');
  const [serverVersion, setServerVersion] = useState('');
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { api.me().then((m) => setName(m.name)).catch(() => undefined); }, []);
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
        <a className="nav active" href="#/">{icon('M4 21V8l8-5 8 5v13 M9 21v-6h6v6')}Offices</a>
        <div className="grow" />
        <button className="theme" onClick={() => setTheme(next)} title="Switch theme">Theme: {theme}</button>
        {name && (
          <div className="user">
            <span className="avatar">{initials}</span>
            <span className="who">{name}</span>
          </div>
        )}
        <div className="version">
          Places Builder {APP_VERSION}
          {serverVersion && serverVersion !== APP_VERSION && <> (server {serverVersion})</>}
          <br />
          <a href="https://github.com/ralpje/placesbuilder/issues/new/choose" target="_blank" rel="noreferrer">Report an issue</a>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
