import { useState } from 'react';
import { placesCommands } from '../shared/psCommands.ts';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copy-paste PowerShell commands for the Places side of the workflow. Runs nothing; no Graph access. */
export function PlacesCommands({ buildingPlaceId }: { buildingPlaceId?: string }) {
  const [copied, setCopied] = useState('');
  const [failed, setFailed] = useState(false);
  const groups = placesCommands({ buildingPlaceId });

  const onCopy = async (id: string, text: string) => {
    const ok = await copy(text);
    setFailed(!ok);
    setCopied(ok ? id : '');
    if (ok) setTimeout(() => setCopied((c) => (c === id ? '' : c)), 2000);
  };

  return (
    <details className="card" style={{ marginTop: 24 }}>
      <summary><strong>PowerShell commands for Places</strong></summary>
      <p className="muted">
        Copy and paste these into PowerShell 7.4 or later.{' '}
        {buildingPlaceId ? 'Your building id is filled in.' : 'Replace <building PlaceId> with the PlaceId from the first command.'}
      </p>
      {failed && <p className="warn">Copying is blocked by the browser. Select the text and copy it by hand.</p>}
      {groups.map((g) => (
        <section key={g.id}>
          <h3>{g.title}</h3>
          {g.steps.map((s) => (
            <div key={s.id}>
              <p style={{ marginBottom: 4 }}><strong>{s.title}.</strong> <span className="muted">{s.note}</span></p>
              <pre><code>{s.command}</code></pre>
              <button onClick={() => onCopy(s.id, s.command)} aria-label={`Copy: ${s.title}`}>{copied === s.id ? 'Copied' : 'Copy'}</button>
            </div>
          ))}
        </section>
      ))}
    </details>
  );
}
