import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from '../api.ts';
import { metersPerPixelFromSheetScale } from '../../shared/georef.ts';
import type { EditorCtx } from './FloorEditor.tsx';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const RENDER_PX_PER_PT = 2; // 2 px per PDF point: A3 becomes about 1700 x 2400 px

export function PlanPrep({ ctx, onDone }: { ctx: EditorCtx; onDone: () => void }) {
  const { office, floor } = ctx;
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [original, setOriginal] = useState<File | null>(null);
  const [fromPdf, setFromPdf] = useState(false);
  const [rot, setRot] = useState(0);
  const [crop, setCrop] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [sheetScale, setSheetScale] = useState(200);
  const [mpp, setMpp] = useState<number>(floor.plan?.metersPerPixel ?? 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const view = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // The rotated image (before cropping), recomputed when the rotation changes.
  const rotated = useRotated(source, rot);

  useEffect(() => {
    if (!rotated || !view.current) return;
    const c = view.current;
    const k = Math.min(1, 900 / rotated.width);
    c.width = Math.round(rotated.width * k); c.height = Math.round(rotated.height * k);
    const g = c.getContext('2d')!;
    g.drawImage(rotated, 0, 0, c.width, c.height);
    if (crop) {
      g.fillStyle = 'rgba(0,0,0,.45)';
      g.fillRect(0, 0, c.width, c.height);
      const x = Math.min(crop.x0, crop.x1) * k, y = Math.min(crop.y0, crop.y1) * k;
      const w = Math.abs(crop.x1 - crop.x0) * k, h = Math.abs(crop.y1 - crop.y0) * k;
      g.drawImage(rotated, x / k, y / k, w / k, h / k, x, y, w, h);
      g.strokeStyle = '#e11'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
    }
  }, [rotated, crop]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr(''); setCrop(null); setRot(0);
    try {
      const canvas = document.createElement('canvas');
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: RENDER_PX_PER_PT });
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        const g = canvas.getContext('2d')!;
        g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: g, viewport: vp, canvas }).promise;
        setFromPdf(true);
        setMpp(metersPerPixelFromSheetScale(sheetScale, RENDER_PX_PER_PT));
        if (pdf.numPages > 1) setErr(`The PDF has ${pdf.numPages} pages. Only page 1 is used.`);
      } else {
        const bmp = await createImageBitmap(file);
        const maxSide = 6000, k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
        canvas.width = Math.round(bmp.width * k); canvas.height = Math.round(bmp.height * k);
        canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        setFromPdf(false); setMpp(0);
      }
      setSource(canvas); setOriginal(file);
    } catch (e) { setErr(`Could not read the file: ${(e as Error).message}`); }
  };

  useEffect(() => { if (fromPdf) setMpp(metersPerPixelFromSheetScale(sheetScale, RENDER_PX_PER_PT)); }, [sheetScale, fromPdf]);

  const pos = (e: React.PointerEvent) => {
    const r = view.current!.getBoundingClientRect();
    const k = rotated!.width / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  };

  const save = async () => {
    if (!rotated) return;
    setBusy(true); setErr('');
    try {
      const x = crop ? Math.round(Math.min(crop.x0, crop.x1)) : 0, y = crop ? Math.round(Math.min(crop.y0, crop.y1)) : 0;
      const w = crop ? Math.round(Math.abs(crop.x1 - crop.x0)) : rotated.width, h = crop ? Math.round(Math.abs(crop.y1 - crop.y0)) : rotated.height;
      if (w < 100 || h < 100) throw new Error('The crop is too small.');
      const out = document.createElement('canvas'); out.width = w; out.height = h;
      out.getContext('2d')!.drawImage(rotated, x, y, w, h, 0, 0, w, h);
      const blob = await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png'));
      let doc = await api.putPlan(office.id, floor.id, blob, w, h, mpp > 0 ? mpp : undefined);
      if (original) doc = await api.putOriginal(office.id, floor.id, original, original.name);
      ctx.setPlanDoc(doc);
      if (floor.georef && mpp > 0) ctx.setGeoref({ ...floor.georef, metersPerPixel: mpp });
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div>
      {floor.plan && !source && (
        <p>Current plan: {floor.plan.width} × {floor.plan.height} px{floor.plan.originalName ? `, from ${floor.plan.originalName}` : ''}. Upload a new file to replace it.</p>
      )}
      {floor.plan && floor.features.length > 0 && <p className="warn">Replacing the plan with a different crop or rotation shifts the traced shapes. Replace only when the new image has the same framing.</p>}
      <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => pick(e.target.files?.[0])} />
      {err && <p className="error">{err}</p>}
      {rotated && (
        <>
          <div className="row">
            <button onClick={() => { setRot((r) => (r + 90) % 360); setCrop(null); }}>Rotate 90° clockwise</button>
            <button onClick={() => setCrop(null)}>Clear crop</button>
            {fromPdf ? (
              <label>Sheet scale 1:<input type="number" min={1} value={sheetScale} onChange={(e) => setSheetScale(Number(e.target.value))} /></label>
            ) : null}
            <label>Metres per pixel<input type="number" step="0.001" min={0} value={mpp || ''} onChange={(e) => setMpp(Number(e.target.value))} /></label>
          </div>
          <p>Drag a rectangle around the floor plan to cut away the title block and legend. Rotate first if the drawing is sideways. For an image, enter the metres per pixel if you know it; you can also fix the scale on the map in step 2.</p>
          <canvas
            ref={view}
            className="prep"
            onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); const p = pos(e); drag.current = p; setCrop({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
            onPointerMove={(e) => { if (drag.current) { const p = pos(e); setCrop({ x0: drag.current.x, y0: drag.current.y, x1: p.x, y1: p.y }); } }}
            onPointerUp={() => { drag.current = null; }}
          />
          <div className="row"><button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Use this plan'}</button></div>
        </>
      )}
    </div>
  );
}

function useRotated(src: HTMLCanvasElement | null, deg: number): HTMLCanvasElement | null {
  const [out, setOut] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!src) { setOut(null); return; }
    const c = document.createElement('canvas');
    const swap = deg === 90 || deg === 270;
    c.width = swap ? src.height : src.width; c.height = swap ? src.width : src.height;
    const g = c.getContext('2d')!;
    g.translate(c.width / 2, c.height / 2); g.rotate((deg * Math.PI) / 180);
    g.drawImage(src, -src.width / 2, -src.height / 2);
    setOut(c);
  }, [src, deg]);
  return out;
}
