import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../api.ts';
import type { GeoHit } from '../api.ts';
import { bearingDeg, cornersLonLat, distanceMeters, normalizeDeg, planToLonLat } from '../../shared/georef.ts';
import type { GeoRef, LonLat } from '../../shared/types.ts';
import type { EditorCtx } from './FloorEditor.tsx';

const DEFAULT_CENTER: LonLat = [4.9, 52.37];

export function Align({ ctx }: { ctx: EditorCtx }) {
  const { office, floor } = ctx;
  const plan = floor.plan!;
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<{ c: maplibregl.Marker; r: maplibregl.Marker; s: maplibregl.Marker } | null>(null);
  const gRef = useRef<GeoRef>(initial());
  const [g, setG] = useState<GeoRef>(gRef.current);
  const [opacity, setOpacity] = useState(0.6);
  const [q, setQ] = useState(`${office.address.street} ${office.address.postalCode} ${office.address.city}`.trim());
  const [hits, setHits] = useState<GeoHit[]>([]);
  const [err, setErr] = useState('');
  const [basemap, setBasemap] = useState<'azure' | 'osm' | 'none'>('osm');
  const [others, setOthers] = useState<{ id: string; name: string; g: GeoRef }[]>([]);

  function initial(): GeoRef {
    return floor.georef ?? { lon: (office.center ?? DEFAULT_CENTER)[0], lat: (office.center ?? DEFAULT_CENTER)[1], rotationDeg: 0, metersPerPixel: plan.metersPerPixel ?? 0.1 };
  }
  const w = plan.width, h = plan.height;

  // push every change to the parent, the map and the handles
  const apply = (next: GeoRef, commit = true) => {
    gRef.current = next; setG(next);
    redraw(next);
    if (commit) ctx.setGeoref(next);
  };

  const redraw = (n: GeoRef) => {
    const map = mapRef.current; if (!map) return;
    const src = map.getSource('plan') as maplibregl.ImageSource | undefined;
    src?.setCoordinates(cornersLonLat(n, w, h) as [LonLat, LonLat, LonLat, LonLat]);
    const m = markers.current; if (!m) return;
    m.c.setLngLat([n.lon, n.lat]);
    m.r.setLngLat(planToLonLat(n, w, h, [w / 2, -h * 0.06]));
    m.s.setLngLat(planToLonLat(n, w, h, [w, h / 2]));
  };

  useEffect(() => {
    let dead = false;
    api.config().then((c) => {
      if (dead || !el.current) return;
      setBasemap(c.basemap);
      const style: maplibregl.StyleSpecification = {
        version: 8,
        sources: c.basemap === 'none' ? {} : { base: { type: 'raster', tiles: [`${location.origin}/api/tiles/{z}/{x}/{y}.png`], tileSize: 256, maxzoom: 19 } },
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dde' } }, ...(c.basemap === 'none' ? [] : [{ id: 'base', type: 'raster' as const, source: 'base' }])],
      };
      const start = gRef.current;
      const map = new maplibregl.Map({ container: el.current, style, center: [start.lon, start.lat], zoom: floor.georef ? 19 : 17, maxZoom: 21 });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.on('load', () => {
        map.addSource('plan', { type: 'image', url: api.planUrl(office.id, floor.id, plan.version), coordinates: cornersLonLat(start, w, h) as [LonLat, LonLat, LonLat, LonLat] });
        map.addLayer({ id: 'plan', type: 'raster', source: 'plan', paint: { 'raster-opacity': 0.6, 'raster-fade-duration': 0 } });
        const mk = (color: string, title: string) => {
          const d = document.createElement('div'); d.className = 'handle'; d.style.background = color; d.title = title;
          return new maplibregl.Marker({ element: d, draggable: true }).setLngLat([start.lon, start.lat]).addTo(map);
        };
        const mc = mk('#d22', 'Drag to move'), mr = mk('#27c', 'Drag to rotate'), ms = mk('#2a2', 'Drag to resize');
        markers.current = { c: mc, r: mr, s: ms };
        mc.on('drag', () => { const p = mc.getLngLat(); apply({ ...gRef.current, lon: p.lng, lat: p.lat }); });
        mr.on('drag', () => {
          const cur = gRef.current, p = mr.getLngLat();
          // handle sits above the top edge, so its bearing from the centre equals the rotation
          apply({ ...cur, rotationDeg: Math.round(normalizeDeg(bearingDeg([cur.lon, cur.lat], [p.lng, p.lat])) * 10) / 10 });
        });
        ms.on('drag', () => {
          const cur = gRef.current, p = ms.getLngLat();
          const d = distanceMeters([cur.lon, cur.lat], [p.lng, p.lat]);
          apply({ ...cur, metersPerPixel: Math.max(0.001, d / (w / 2)) });
        });
        mc.on('dragend', () => ctx.setCenter([gRef.current.lon, gRef.current.lat]));
        redraw(start);
        // rotation and scale handles are re-seated after dragging so they stay on their edges
        for (const m of [mr, ms]) m.on('dragend', () => redraw(gRef.current));
      });
    }).catch((e) => setErr(e.message));
    return () => { dead = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    mapRef.current?.getLayer('plan') && mapRef.current.setPaintProperty('plan', 'raster-opacity', opacity);
  }, [opacity]);

  useEffect(() => {
    const ids = office.floors.filter((f) => f.id !== floor.id);
    Promise.all(ids.map((f) => api.floor(office.id, f.id).catch(() => null))).then((all) =>
      setOthers(all.filter((f): f is NonNullable<typeof f> => !!f && !!f.georef && !!f.plan).map((f) => ({ id: f.id, name: f.name, g: f.georef! }))),
    );
  }, []);

  const search = async () => {
    setErr('');
    try { const r = await api.geocode(q); setHits(r); if (!r.length) setErr('Nothing found.'); } catch (e) { setErr((e as Error).message); }
  };
  const goto = (hit: GeoHit) => {
    mapRef.current?.jumpTo({ center: [hit.lon, hit.lat], zoom: 19 });
    apply({ ...gRef.current, lon: hit.lon, lat: hit.lat });
    ctx.setCenter([hit.lon, hit.lat]);
    setHits([]);
  };
  const num = (k: keyof GeoRef) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) apply({ ...gRef.current, [k]: v });
  };

  return (
    <div className="align">
      <div className="side">
        <h3>Position the plan</h3>
        <p>Find the building, then drag the red dot to move the plan, the blue dot to rotate it and the green dot to resize it. Lower the opacity to see the aerial image through the drawing.</p>
        {basemap === 'osm' && <p className="warn">Using OpenStreetMap (development). Configure Azure Maps for satellite images.</p>}
        {basemap === 'none' && <p className="warn">No basemap is configured, so you can only place the plan by numbers.</p>}
        <div className="row"><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} /><button onClick={search}>Find</button></div>
        {hits.map((hit) => <div key={hit.label + hit.lat}><a href="#" onClick={(e) => { e.preventDefault(); goto(hit); }}>{hit.label}</a></div>)}
        {err && <p className="error">{err}</p>}
        <label>Opacity<input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} /></label>
        <label>Rotation (°)<input type="number" step="0.1" value={g.rotationDeg} onChange={num('rotationDeg')} /></label>
        <label>Metres per pixel<input type="number" step="0.001" value={Number(g.metersPerPixel.toFixed(5))} onChange={num('metersPerPixel')} /></label>
        <p className="muted">Plan width on the ground: {(g.metersPerPixel * w).toFixed(1)} m, height {(g.metersPerPixel * h).toFixed(1)} m.</p>
        <label>Lat<input type="number" step="0.000001" value={Number(g.lat.toFixed(7))} onChange={num('lat')} /></label>
        <label>Lon<input type="number" step="0.000001" value={Number(g.lon.toFixed(7))} onChange={num('lon')} /></label>
        {others.length > 0 && (
          <label>Copy position from
            <select value="" onChange={(e) => { const o = others.find((x) => x.id === e.target.value); if (o) { apply({ ...o.g }); mapRef.current?.jumpTo({ center: [o.g.lon, o.g.lat] }); } }}>
              <option value="">Choose a floor…</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}
        <p className="muted">Save with the button at the top. All floors of a building should share the same position, so copy it from a floor that is already placed.</p>
      </div>
      <div ref={el} className="map" />
    </div>
  );
}
