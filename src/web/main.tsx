import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OfficesPage } from './pages/Offices.tsx';
import { OfficePage } from './pages/Office.tsx';
import { FloorEditor } from './editor/FloorEditor.tsx';
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
    <>
      <header className="top">
        <a href="#/">IMDF Builder for Places</a>
      </header>
      <main>{page}</main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
