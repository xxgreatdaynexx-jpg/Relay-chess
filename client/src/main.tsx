import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces/wght.css';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/outfit';
import { App } from './App';
import { ErrorBoundary, reportClientError } from './components/ErrorBoundary';
import './index.css';
import { initSettings } from './lib/settings';
import { installChunkReload } from './lib/chunkReload';

import { xmasOn } from '../../shared/holiday';

initSettings();
// Christmas theme (request #17): festive UI accent until shared/holiday.ts XMAS_END.
if (xmasOn()) document.documentElement.classList.add('xmas');
installChunkReload();
window.addEventListener('error', (e) => { if (e.error) reportClientError('window', e.error); });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="app" kind="app"><App /></ErrorBoundary>
  </StrictMode>,
);
