import { useState } from 'react';
import { api } from '../api.ts';
import type { TermsInfo } from '../../shared/types.ts';

export function TermsGate({ terms }: { terms: TermsInfo }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const accept = async () => {
    setBusy(true); setErr('');
    try { await api.acceptTerms(terms.version); location.reload(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const link = (href: string, text: string) => <a href={href} target="_blank" rel="noreferrer">{text}</a>;
  return (
    <section className="center">
      <div className="card" style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 24 }}>Before you start</h1>
        <p>Please read these documents:</p>
        <ul>
          <li>{link(terms.termsUrl, 'Terms of use')}</li>
          <li>{link(terms.privacyUrl, 'Privacy statement')}</li>
          {terms.dpaUrl && <li>{link(terms.dpaUrl, 'Data processing agreement')}</li>}
        </ul>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '16px 0' }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ marginTop: 4 }} />
          <span>
            {terms.owner
              ? 'I have read these documents and accept them. I confirm that I am authorised to accept the terms and the data processing agreement on behalf of my organization.'
              : 'I have read the terms of use and the privacy statement and I accept the terms.'}
          </span>
        </label>
        {err && <p className="error">{err}</p>}
        <div className="row">
          <button className="primary" disabled={!ok || busy} onClick={accept}>Accept and continue</button>
        </div>
      </div>
    </section>
  );
}
