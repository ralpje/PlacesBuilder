import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { UNIT_CATEGORIES } from '../../shared/types.ts';
import type { FeatureKind, PlacesItem, PlanFeature, Pt } from '../../shared/types.ts';
import { descendantsOfFloor } from '../../shared/places.ts';
import { suggest } from '../../shared/match.ts';
import { rectAround } from '../../shared/geometry.ts';
import type { EditorCtx } from './FloorEditor.tsx';

type Tool = 'pan' | 'select' | 'draw' | 'rect' | 'desk';

const COLORS: Record<FeatureKind, string> = { outline: '#111', unit: '#2563eb', section: '#a21caf', workspace: '#ea580c', desk: '#16a34a' };
const DEFAULT_CATEGORY: Record<FeatureKind, string> = { outline: 'floor', unit: 'room', section: 'unspecified', workspace: 'workspace', desk: 'desk' };
const DESK_M = { w: 1.6, h: 0.8 };
const uid = () => crypto.randomUUID();

export function Trace({ ctx }: { ctx: EditorCtx }) {
  const { floor, office } = ctx;
  const plan = floor.plan!;
  const feats = floor.features;
  const [tool, setTool] = useState<Tool>('select');
  const [kind, setKind] = useState<FeatureKind>('unit');
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [deskRot, setDeskRot] = useState(0);
  const [vp, setVp] = useState({ x: 0, y: 0, k: 1 });
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<null | { type: 'pan'; sx: number; sy: number; vx: number; vy: number } | { type: 'vertex'; id: string; i: number } | { type: 'move'; id: string; last: Pt } | { type: 'rect'; a: Pt }>(null);
  const [rectNow, setRectNow] = useState<Pt | null>(null);

  const items: PlacesItem[] = useMemo(
    () => (office.places && floor.placesFloorId ? descendantsOfFloor(office.places, floor.placesFloorId) : []),
    [office.places, floor.placesFloorId],
  );
  const taken = useMemo(() => new Set(feats.map((f) => f.placesId).filter(Boolean) as string[]), [feats]);
  const selected = feats.find((f) => f.id === sel) ?? null;
  const mpp = floor.georef?.metersPerPixel ?? 0.07;

  // fit the plan into the view on first render
  useEffect(() => {
    const r = svg.current?.getBoundingClientRect();
    if (r) { const k = Math.min(r.width / plan.width, r.height / plan.height); setVp({ x: 0, y: 0, k }); }
  }, [plan.width, plan.height]);

  const toPlan = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return [(e.clientX - r.left - vp.x) / vp.k, (e.clientY - r.top - vp.y) / vp.k];
  };
  const update = (id: string, patch: Partial<PlanFeature>) => ctx.setFeatures(feats.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const add = (f: Omit<PlanFeature, 'id'>) => {
    let next = feats;
    if (f.kind === 'outline') next = feats.filter((x) => x.kind !== 'outline'); // one outline per floor
    const id = uid();
    ctx.setFeatures([...next, { ...f, id }]);
    setSel(id);
  };
  const remove = (id: string) => { ctx.setFeatures(feats.filter((f) => f.id !== id)); setSel(null); };

  const finishDraw = () => {
    if (draft.length >= 3) add({ kind, category: DEFAULT_CATEGORY[kind], name: '', points: draft });
    setDraft([]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === 'Enter') finishDraw();
      else if (e.key === 'Escape') { setDraft([]); setSel(null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) remove(sel);
      else if (e.key === 'Backspace' && draft.length) setDraft(draft.slice(0, -1));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const onWheel = (e: React.WheelEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    const k = Math.min(20, Math.max(0.05, vp.k * f));
    setVp({ k, x: mx - ((mx - vp.x) / vp.k) * k, y: my - ((my - vp.y) / vp.k) * k });
  };

  const onDown = (e: React.PointerEvent) => {
    const p = toPlan(e);
    const target = e.target as SVGElement;
    svg.current!.setPointerCapture(e.pointerId);
    if (e.button === 1 || tool === 'pan' || e.altKey) { drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y }; return; }
    const vi = target.dataset.vertex;
    if (vi !== undefined && sel) { drag.current = { type: 'vertex', id: sel, i: Number(vi) }; return; }
    if (tool === 'draw') {
      if (draft.length >= 3 && Math.hypot(draft[0][0] - p[0], draft[0][1] - p[1]) * vp.k < 10) { finishDrawLater(draft); setDraft([]); } else setDraft([...draft, p]);
      return;
    }
    if (tool === 'rect') { drag.current = { type: 'rect', a: p }; setRectNow(p); return; }
    if (tool === 'desk') {
      const hw = DESK_M.w / mpp, hh = DESK_M.h / mpp;
      add({ kind: 'desk', category: 'desk', name: '', points: rectAround(p, hw, hh, deskRot), rotationDeg: deskRot });
      return;
    }
    const fid = target.dataset.fid;
    if (fid) { setSel(fid); drag.current = { type: 'move', id: fid, last: p }; } else setSel(null);
  };
  // closing a polygon by clicking its first point
  const finishDrawLater = (pts: Pt[]) => add({ kind, category: DEFAULT_CATEGORY[kind], name: '', points: pts });

  const onMove = (e: React.PointerEvent) => {
    const p = toPlan(e);
    setCursor(p);
    const d = drag.current;
    if (!d) return;
    if (d.type === 'pan') setVp({ ...vp, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy });
    else if (d.type === 'rect') setRectNow(p);
    else if (d.type === 'vertex') {
      const f = feats.find((x) => x.id === d.id); if (!f) return;
      update(d.id, { points: f.points.map((q, i) => (i === d.i ? p : q)) });
    } else if (d.type === 'move') {
      const f = feats.find((x) => x.id === d.id); if (!f) return;
      const dx = p[0] - d.last[0], dy = p[1] - d.last[1];
      update(d.id, { points: f.points.map(([x, y]) => [x + dx, y + dy] as Pt) });
      d.last = p;
    }
  };
  const onUp = () => {
    const d = drag.current;
    if (d?.type === 'rect' && rectNow) {
      const [a, b] = [d.a, rectNow];
      if (Math.abs(a[0] - b[0]) > 4 && Math.abs(a[1] - b[1]) > 4) {
        add({ kind, category: DEFAULT_CATEGORY[kind], name: '', points: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]] });
      }
    }
    drag.current = null; setRectNow(null);
  };

  const sugg = selected && selected.kind !== 'outline' ? suggest(selected.label || selected.name, items, taken.has(selected.placesId ?? '') ? new Set([...taken].filter((t) => t !== selected.placesId)) : taken) : [];
  const linkedItem = (id?: string) => (id ? items.find((i) => i.placeId === id) : undefined);
  const path = (pts: Pt[]) => pts.map((p) => p.join(',')).join(' ');
  const unmapped = items.filter((i) => !taken.has(i.placeId));

  return (
    <div className="trace">
      <div className="tools">
        {(['select', 'pan'] as Tool[]).map((t) => <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)}>{t === 'select' ? 'Select' : 'Pan'}</button>)}
        <span>Draw:</span>
        {(['outline', 'unit', 'section', 'workspace'] as FeatureKind[]).map((k) => (
          <button key={k} className={tool !== 'select' && tool !== 'pan' && tool !== 'desk' && kind === k ? 'on' : ''} style={{ borderColor: COLORS[k] }} onClick={() => { setKind(k); setTool('draw'); setDraft([]); }}>{k}</button>
        ))}
        <button className={tool === 'desk' ? 'on' : ''} style={{ borderColor: COLORS.desk }} onClick={() => setTool('desk')}>desk</button>
        {tool === 'draw' && <button onClick={() => setTool('rect')}>Switch to rectangle</button>}
        {tool === 'rect' && <button onClick={() => setTool('draw')}>Switch to polygon</button>}
        {tool === 'desk' && <label>Desk rotation<input type="number" value={deskRot} onChange={(e) => setDeskRot(Number(e.target.value))} /></label>}
        <span className="muted">
          {tool === 'draw' ? 'Click corners; click the first point or press Enter to finish; Esc cancels.' : tool === 'rect' ? 'Drag a rectangle.' : tool === 'desk' ? `Click to place a ${DESK_M.w} × ${DESK_M.h} m desk.` : 'Scroll to zoom, Alt-drag to pan.'}
        </span>
      </div>
      <div className="canvas-wrap">
        <svg ref={svg} className="canvas" onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={() => tool === 'draw' && finishDraw()}>
          <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.k})`}>
            <image href={api.planUrl(office.id, floor.id, plan.version)} width={plan.width} height={plan.height} />
            {feats.map((f) => {
              const c = COLORS[f.kind];
              const linked = !!f.placesId;
              return (
                <polygon key={f.id} data-fid={f.id} points={path(f.points)} fill={c} fillOpacity={f.kind === 'outline' ? 0 : linked ? 0.35 : 0.15} stroke={c}
                  strokeWidth={(f.id === sel ? 3 : 1.5) / vp.k} strokeDasharray={f.kind === 'section' ? `${6 / vp.k}` : undefined} style={{ pointerEvents: f.kind === 'outline' && tool === 'select' && f.id !== sel ? 'stroke' : 'auto' }} />
              );
            })}
            {selected && selected.points.map((p, i) => <circle key={i} data-vertex={i} cx={p[0]} cy={p[1]} r={5 / vp.k} fill="#fff" stroke="#000" strokeWidth={1 / vp.k} />)}
            {draft.length > 0 && <polyline points={path(cursor ? [...draft, cursor] : draft)} fill="none" stroke={COLORS[kind]} strokeWidth={2 / vp.k} />}
            {draft.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4 / vp.k} fill={COLORS[kind]} />)}
            {rectNow && drag.current?.type === 'rect' && <rect x={Math.min(rectNow[0], drag.current.a[0])} y={Math.min(rectNow[1], drag.current.a[1])} width={Math.abs(rectNow[0] - drag.current.a[0])} height={Math.abs(rectNow[1] - drag.current.a[1])} fill="none" stroke={COLORS[kind]} strokeWidth={2 / vp.k} />}
          </g>
        </svg>
        <aside className="panel">
          {selected ? (
            <>
              <h3>{selected.kind}</h3>
              {selected.kind === 'unit' && (
                <label>Category<select value={selected.category} onChange={(e) => update(selected.id, { category: e.target.value })}>
                  {UNIT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select></label>
              )}
              <label>Kind<select value={selected.kind} onChange={(e) => update(selected.id, { kind: e.target.value as FeatureKind, category: DEFAULT_CATEGORY[e.target.value as FeatureKind] })}>
                {(['outline', 'unit', 'section', 'workspace', 'desk'] as FeatureKind[]).map((k) => <option key={k}>{k}</option>)}
              </select></label>
              <label>Name<input value={selected.name} onChange={(e) => update(selected.id, { name: e.target.value })} /></label>
              {selected.kind !== 'outline' && (
                <>
                  <label>Text on plan (for matching)<input value={selected.label ?? ''} onChange={(e) => update(selected.id, { label: e.target.value })} /></label>
                  <label>Places item
                    <select value={selected.placesId ?? ''} onChange={(e) => {
                      const it = linkedItem(e.target.value);
                      update(selected.id, { placesId: e.target.value || undefined, ...(it && !selected.name ? { name: it.name } : {}) });
                    }}>
                      <option value="">— not linked —</option>
                      {items.map((i) => <option key={i.placeId} value={i.placeId}>{i.name} ({i.type}){taken.has(i.placeId) && i.placeId !== selected.placesId ? ' •' : ''}</option>)}
                    </select>
                  </label>
                  {sugg.length > 0 && !selected.placesId && (
                    <p>Suggestions: {sugg.map((s) => <button key={s.item.placeId} onClick={() => update(selected.id, { placesId: s.item.placeId, name: selected.name || s.item.name })}>{s.item.name}</button>)}</p>
                  )}
                </>
              )}
              {selected.kind === 'desk' && <label>Rotation (°)<input type="number" value={selected.rotationDeg ?? 0} onChange={(e) => update(selected.id, { rotationDeg: Number(e.target.value) })} /></label>}
              <button className="danger" onClick={() => remove(selected.id)}>Delete</button>
            </>
          ) : (
            <p className="muted">Select a shape to edit it, or draw a new one. Start with the floor outline.</p>
          )}
          <h3>Places items without a shape ({unmapped.length})</h3>
          {!floor.placesFloorId && <p className="warn">This floor is not linked to a Places floor. Import the Places export on the office page.</p>}
          <ul className="small">
            {unmapped.map((i) => (
              <li key={i.placeId}>
                {i.name} <span className="muted">({i.type})</span>
                {selected && selected.kind !== 'outline' && !selected.placesId && <button onClick={() => update(selected.id, { placesId: i.placeId, name: selected.name || i.name })}>link</button>}
              </li>
            ))}
          </ul>
          <p className="muted">{feats.filter((f) => f.kind === 'unit').length} units, {feats.filter((f) => f.kind === 'section').length} sections, {feats.filter((f) => f.kind === 'workspace').length} workspaces, {feats.filter((f) => f.kind === 'desk').length} desks.</p>
        </aside>
      </div>
    </div>
  );
}
