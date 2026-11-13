import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { SpaceProgram, type SpacePreview } from './components/SpaceProgram';

const params = new URLSearchParams(location.search);
const shot = params.get('shot') ?? 'vab';
const view = (shot === 'ascent' || shot === 'orbit' || shot === 'launch' || shot === 'hangar' || shot === 'vab') ? shot : 'vab';
const preview: SpacePreview = { view, freeze: view === 'ascent' || view === 'orbit' || view === 'vab' || view === 'hangar' };

createRoot(document.getElementById('root')!).render(
  createElement(SpaceProgram, { me: 'Preview', onClose: () => {}, preview }),
);

(window as unknown as { __spc?: { shot: string } }).__spc = { shot: view };
