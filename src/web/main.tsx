import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OfficesPage } from './pages/Offices.tsx';
import { OfficePage } from './pages/Office.tsx';
import { FloorEditor } from './editor/FloorEditor.tsx';
import { Shell } from './Shell.tsx';
import { TeamPage } from './pages/Team.tsx';
import './styles.css';

function useHash(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return parts;
}

function App() {
  const [a, b, c, d] = useHash();
  let page = <OfficesPage />;
  if (a === 'office' && b && c === 'floor' && d) page = <FloorEditor key={d} officeId={b} floorId={d} />;
  else if (a === 'office' && b) page = <OfficePage key={b} officeId={b} />;
  return (
    <Shell page={a}>
      {(me) => (a === 'team' && me?.workspace ? <TeamPage myId={me.id} /> : page)}
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
