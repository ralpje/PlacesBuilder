import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import type { FloorDoc, OfficeDoc, PlanFeature, GeoRef } from '../../shared/types.ts';
import { PlanPrep } from './PlanPrep.tsx';
import { Align } from './Align.tsx';
import { Trace } from './Trace.tsx';

export interface EditorCtx {
  office: OfficeDoc;
  floor: FloorDoc;
  setGeoref: (g: GeoRef) => void;
  setFeatures: (f: PlanFeature[]) => void;
  setPlanDoc: (f: FloorDoc) => void;
  setCenter: (c: [number, number]) => void;
}

type Step = 'plan' | 'align' | 'trace';

export function FloorEditor({ officeId, floorId }: { officeId: string; floorId: string }) {
  const [office, setOffice] = useState<OfficeDoc | null>(null);
  const [floor, setFloor] = useState<FloorDoc | null>(null);
  const [step, setStep] = useState<Step>('plan');
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    Promise.all([api.office(officeId), api.floor(officeId, floorId)])
      .then(([o, f]) => {
        setOffice(o); setFloor(f);
        setStep(!f.plan ? 'plan' : !f.georef ? 'align' : 'trace');
      })
      .catch((e) => setErr(e.message));
  }, [officeId, floorId]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    addEventListener('beforeunload', h);
    return () => removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!floor) return;
    setErr(''); setMsg('');
    try {
      const saved = await api.saveFloor(officeId, floorId, { rev: floor.rev, georef: floor.georef ?? null, features: floor.features });
      setFloor(saved); setDirty(false); setMsg('Saved.');
    } catch (e) { setErr((e as Error).message); }
  }, [floor, officeId, floorId]);

  const ctx = useMemo<EditorCtx | null>(() => {
    if (!office || !floor) return null;
    return {
      office, floor,
      setGeoref: (g) => { setFloor((f) => f && { ...f, georef: g }); setDirty(true); },
      setFeatures: (features) => { setFloor((f) => f && { ...f, features }); setDirty(true); },
      setPlanDoc: (f) => setFloor((cur) => (cur ? { ...cur, plan: f.plan, rev: f.rev } : f)),
      setCenter: (c) => {
        // remembered so the next floor opens on the same spot; failure is not important
        api.updateOffice(office.id, { rev: office.rev, center: c }).then(setOffice).catch(() => undefined);
      },
    };
  }, [office, floor]);

  if (!ctx) return <p>{err || 'Loading…'}</p>;
  const tab = (s: Step, label: string, disabled = false) => (
    <button className={step === s ? 'tab active' : 'tab'} disabled={disabled} onClick={() => setStep(s)}>{label}</button>
  );
  return (
    <section className="editor">
      <div className="bar">
        <a href={`#/office/${office!.id}`}>← {office!.name}</a>
        <strong>{ctx.floor.name}</strong>
        {tab('plan', '1. Plan')}
        {tab('align', '2. Position on map', !ctx.floor.plan)}
        {tab('trace', '3. Trace and match', !ctx.floor.plan || !ctx.floor.georef)}
        <span className="spacer" />
        {dirty && <span className="warn">Unsaved changes</span>}
        <button onClick={save} disabled={!dirty}>Save</button>
      </div>
      {err && <p className="error">{err}</p>}
      {msg && !dirty && <p className="ok">{msg}</p>}
      {step === 'plan' && <PlanPrep ctx={ctx} onDone={() => setStep('align')} />}
      {step === 'align' && <Align ctx={ctx} />}
      {step === 'trace' && <Trace ctx={ctx} />}
    </section>
  );
}
