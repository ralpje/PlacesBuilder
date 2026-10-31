import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import type { OfficeSummary } from '../api.ts';

export function OfficesPage() {
  const [list, setList] = useState<OfficeSummary[] | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const load = () => api.offices().then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim()) return;
    try {
      const o = await api.createOffice(name.trim());
      location.hash = `#/office/${o.id}`;
    } catch (e) { setErr((e as Error).message); }
  };

  const floors = (list ?? []).reduce((n, o) => n + o.floors, 0);
  const latest = (list ?? []).map((o) => o.updatedAt).sort().pop();

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Your offices</h1>
          <p>Each office is one building in Microsoft Places.</p>
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      {list === null ? <p className="muted">Loading…</p> : (
        <>
          <div className="stats">
            <div className="card stat"><div className="label">Offices</div><div className="value">{list.length}</div></div>
            <div className="card stat"><div className="label">Floors</div><div className="value">{floors}</div></div>
            <div className="card stat"><div className="label">Last change</div><div className="value" style={{ fontSize: 18 }}>{latest ? new Date(latest).toLocaleString() : '-'}</div></div>
          </div>
          <div className="cards">
            {list.map((o) => (
              <a key={o.id} className="card office" href={`#/office/${o.id}`}>
                <div className="top">
                  <div>
                    <div className="name">{o.name}</div>
                    <div className="sub">{o.city || 'No city yet'}</div>
                  </div>
                  <span className="pill">{o.floors} {o.floors === 1 ? 'floor' : 'floors'}</span>
                </div>
                <p className="muted" style={{ marginBottom: 0 }}>Updated {new Date(o.updatedAt).toLocaleString()}</p>
              </a>
            ))}
            <div className="card add-card">
              <strong>{list.length === 0 ? 'Add your first office' : 'Add an office'}</strong>
              <div className="row">
                <input placeholder="Office name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
                <button className="primary" onClick={add}>Add office</button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
