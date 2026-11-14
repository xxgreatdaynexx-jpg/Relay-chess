import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { SpaceProgram, type SpacePreview, type SpacePreviewView } from './components/SpaceProgram';

const params = new URLSearchParams(location.search);
const shot = (params.get('shot') ?? 'vab') as SpacePreviewView;
const known: SpacePreviewView[] = [
  'vab', 'hangar', 'launch', 'ascent', 'orbit',
  'ascent-low', 'ascent-high', 'ground-track', 'missions', 'mission-complete', 'contracts',
  'survey', 'survey-altimetry', 'survey-biome', 'survey-resource', 'science', 'science-archive', 'tech-tree',
  'science-flight', 'science-orbit',
];
const view: SpacePreviewView = known.includes(shot) ? shot : 'vab';
const frozen = view === 'ascent' || view === 'orbit' || view === 'vab' || view === 'hangar'
  || view === 'ascent-low' || view === 'ascent-high' || view === 'ground-track'
  || view === 'missions' || view === 'mission-complete' || view === 'science-flight' || view === 'science-orbit';
const preview: SpacePreview = { view, freeze: frozen };

createRoot(document.getElementById('root')!).render(
  createElement(SpaceProgram, { me: 'Preview', onClose: () => {}, preview }),
);

(window as unknown as { __spc?: { shot: string } }).__spc = { shot: view };
