import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import type { ImportResult } from '../api.ts';
import type { OfficeDoc, ValidationReport } from '../../shared/types.ts';

export function OfficePage({ officeId }: { officeId: string }) {
  const [o, setO] = useState<OfficeDoc | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [imp, setImp] = useState<ImportResult['summary'] | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);

  const fail = (e: unknown) => setErr((e as Error).message);
  useEffect(() => { api.office(officeId).then(setO).catch(fail); }, [officeId]);
  if (!o) return <p>{err || 'Loading…'}</p>;

  const set = (patch: Partial<OfficeDoc>) => setO({ ...o, ...patch });
  const addr = o.address;
  const setAddr = (k: keyof typeof addr, v: string) => set({ address: { ...addr, [k]: v } });

  const save = async () => {
    setErr(''); setMsg('');
    try {
      setO(await api.updateOffice(o.id, { rev: o.rev, name: o.name, address: o.address, deskExport: o.deskExport }));
      setMsg('Saved.');
    } catch (e) { fail(e); }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setErr('');
    try {
      const r = await api.importPlaces(o.id, await file.text());
      setO(r.office); setImp(r.summary);
    } catch (e) { fail(e); }
  };
  const addFloor = async () => {
    const name = prompt('Floor name'); if (!name) return;
    const ord = Number(prompt('Ordinal (must equal the Places SortOrder)', String(o.floors.length + 1)));
    if (!Number.isInteger(ord)) return;
    try { await api.createFloor(o.id, name, ord); setO(await api.office(o.id)); } catch (e) { fail(e); }
  };
  const remove = async () => {
    if (!confirm(`Delete "${o.name}" with all floors and plans?`)) return;
    try { await api.deleteOffice(o.id); location.hash = '#/'; } catch (e) { fail(e); }
  };
  const check = () => api.validate(o.id).then(setReport).catch(fail);

  return (
    <section>
      <p><a href="#/">← Offices</a></p>
      <h1>{o.name}</h1>
      {err && <p className="error">{err}</p>}
      {msg && <p className="ok">{msg}</p>}

      <h2>Details</h2>
      <div className="grid">
        <label>Name<input value={o.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label>Street<input value={addr.street} onChange={(e) => setAddr('street', e.target.value)} /></label>
        <label>Postal code<input value={addr.postalCode} onChange={(e) => setAddr('postalCode', e.target.value)} /></label>
        <label>City<input value={addr.city} onChange={(e) => setAddr('city', e.target.value)} /></label>
        <label>Province<input value={addr.province ?? ''} onChange={(e) => setAddr('province', e.target.value)} /></label>
        <label>Country (ISO)<input maxLength={2} value={addr.country} onChange={(e) => setAddr('country', e.target.value)} /></label>
        <label>Desks in IMDF
          <select value={o.deskExport} onChange={(e) => set({ deskExport: e.target.value as 'fixture' | 'unit' })}>
            <option value="fixture">As fixtures (icons)</option>
            <option value="unit">As units</option>
          </select>
        </label>
      </div>
      <div className="row"><button onClick={save}>Save details</button><button className="danger" onClick={remove}>Delete office</button></div>

      <h2>Places export</h2>
      <p>Export with <code>Get-PlaceV3 -AncestorId &lt;building id&gt; | Export-Csv places.csv</code> and upload it. Only names, types, parents, capacity and floor order are kept.</p>
      <p>{o.places ? `Imported ${o.places.items.length} items on ${new Date(o.places.importedAt).toLocaleString()}.` : 'Nothing imported yet.'}</p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => upload(e.target.files?.[0])} />
      {imp && (
        <p className="ok">
          {imp.items} items. Floors created: {imp.floorsCreated}, already linked: {imp.floorsLinked}, ordinals aligned: {imp.ordinalsAligned}.
          {imp.warnings.map((w) => <span key={w} className="warn"> {w}</span>)}
        </p>
      )}

      <h2>Floors</h2>
      <table>
        <thead><tr><th>Ordinal</th><th>Name</th><th>Places</th></tr></thead>
        <tbody>
          {o.floors.map((f) => (
            <tr key={f.id}>
              <td>{f.ordinal}</td>
              <td><a href={`#/office/${o.id}/floor/${f.id}`}>{f.name}</a></td>
              <td>{f.placesFloorId ? 'linked' : 'not linked'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row"><button onClick={addFloor}>Add floor</button></div>

      <h2>Export</h2>
      <div className="row">
        <button onClick={check}>Check project</button>
        <a className="button" href={api.exportUrl(o.id)}>Download IMDF zip</a>
        <a className="button" href={api.correlationUrl(o.id)}>Download correlation CSV</a>
      </div>
      {report && (
        <>
          <p>{report.ok ? 'No errors.' : 'There are errors.'} Matched {report.stats.matched}; units {report.stats.units}, sections {report.stats.sections}, workspaces {report.stats.workspaces}, desks {report.stats.desks}.</p>
          <ul className="problems">
            {report.problems.map((p, i) => <li key={i} className={p.level}>{p.level}: {p.message}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
