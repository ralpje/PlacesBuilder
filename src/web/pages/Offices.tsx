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

  return (
    <section>
      <h1>Offices</h1>
      {err && <p className="error">{err}</p>}
      {list === null ? <p>Loading…</p> : list.length === 0 ? <p>No offices yet. Add the first one below.</p> : (
        <table>
          <thead><tr><th>Name</th><th>City</th><th>Floors</th><th>Updated</th></tr></thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id}>
                <td><a href={`#/office/${o.id}`}>{o.name}</a></td>
                <td>{o.city}</td>
                <td>{o.floors}</td>
                <td>{new Date(o.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <input placeholder="New office name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add}>Add office</button>
      </div>
    </section>
  );
}
