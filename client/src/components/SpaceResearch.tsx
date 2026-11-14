import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SCANNERS, SCANNER_BY_TYPE, MAP_TYPE_INFO, SURVEY_LON, SURVEY_LAT, SURVEY_MILESTONES, SURVEY_MILESTONE_PAYOUT,
  SURVEY_ADVANCE_CAP_S, gridFromBytes, emptyGrid, cellIndex, isFilled, previewGrid, coveragePct,
  type MapType,
} from '../../../shared/spaceSurvey';
import {
  EXPERIMENTS, EXPERIMENT_BY_PART, EXPERIMENT_BY_ID, SITUATIONS, TECH_NODES, TECH_BY_ID, PART_TECH,
  SCIENCE_GRANT_DAILY_CAP, SCIENCE_GRANT_PER_POINT, situationFromState, biomeUnder, subjectBiome, subjectKey,
  scienceValue, subjectCap, flavorText, canUnlock, unlockedParts,
  type Situation, type ExperimentDef,
} from '../../../shared/spaceScience';
import { BIOMES, type BiomeId } from '../../../shared/spaceTerrain';
import { PART_BY_ID } from '../../../shared/spaceParts';
import { fmtAlt, type FlightState } from '../../../shared/spaceFlight';
import { drawSurveyMap } from '@/lib/spacePlanet';

// ───────────────────────── view data ─────────────────────────

export type SurveyMapView = { mapType: MapType; grid: string; pct: number; milestone: number; mappers: number; updatedAt: number };
export type SurveyViewData = {
  maps: SurveyMapView[];
  milestonePayouts: Record<string, number>;
  advanceCapS: number;
  mappers: Array<{ id: string; mapType: MapType; scannerId: string; peM: number; apM: number; deployedAt: number }>;
};
export type ArchiveEntry = { subject: string; experimentId: string; situation: Situation; biome: string; runs: number; points: number; ceiling: number; lastAt: number; flavor: string };
export type ScienceViewData = {
  total: number; spent: number; available: number; nodes: string[]; unlockedParts: string[];
  archive: ArchiveEntry[]; grantToday: number; grantCap: number; grantPerPoint: number;
};
export type ScienceResult = { experimentId: string; name: string; situation: Situation; biome: string; points: number; grant: number; flavor: string; subject: string };

const MAP_ORDER: MapType[] = ['visual', 'altimetry', 'biome', 'resource', 'weather'];

const b64ToBytes = (s: string) => {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return new Uint8Array(0); }
};
const bytesToB64 = (g: Uint8Array) => { let s = ''; for (const b of g) s += String.fromCharCode(b); return btoa(s); };

export function emptySurvey(): SurveyViewData {
  return {
    maps: MAP_ORDER.map((t) => ({ mapType: t, grid: '', pct: 0, milestone: 0, mappers: 0, updatedAt: 0 })),
    milestonePayouts: Object.fromEntries(Object.entries(SURVEY_MILESTONE_PAYOUT).map(([k, v]) => [k, v])),
    advanceCapS: SURVEY_ADVANCE_CAP_S, mappers: [],
  };
}
export function emptyScience(): ScienceViewData {
  return {
    total: 0, spent: 0, available: 0, nodes: ['start'], unlockedParts: [...unlockedParts(['start'])],
    archive: [], grantToday: 0, grantCap: SCIENCE_GRANT_DAILY_CAP, grantPerPoint: SCIENCE_GRANT_PER_POINT,
  };
}

/** Deterministic demo data for screenshots / preview. */
export function previewSurvey(): SurveyViewData {
  const pcts: Record<MapType, number> = { visual: 44, altimetry: 30, biome: 63, resource: 12, weather: 0 };
  const now = Date.parse('2026-11-13T18:00:00Z');
  const maps = MAP_ORDER.map((t, i) => {
    const g = pcts[t] > 0 ? previewGrid(t, pcts[t], 3 + i) : emptyGrid();
    const pct = Math.round(coveragePct(g) * 10) / 10;
    return { mapType: t, grid: bytesToB64(g), pct, milestone: SURVEY_MILESTONES.filter((m) => m <= pct).at(-1) ?? 0, mappers: pcts[t] > 0 ? 1 : 0, updatedAt: now };
  });
  return {
    ...emptySurvey(), maps,
    mappers: [
      { id: 'm1', mapType: 'visual', scannerId: 'scan-camera', peM: 118_000, apM: 142_000, deployedAt: now - 30 * 3600e3 },
      { id: 'm2', mapType: 'altimetry', scannerId: 'scan-radar', peM: 160_000, apM: 175_000, deployedAt: now - 14 * 3600e3 },
      { id: 'm3', mapType: 'biome', scannerId: 'scan-multispectral', peM: 240_000, apM: 262_000, deployedAt: now - 52 * 3600e3 },
      { id: 'm4', mapType: 'resource', scannerId: 'scan-ore', peM: 96_000, apM: 104_000, deployedAt: now - 3 * 3600e3 },
    ],
  };
}

export function previewScience(): ScienceViewData {
  const rows: Array<[string, Situation, string, number]> = [
    ['thermo', 'pad', 'launch-site', 1], ['baro', 'pad', 'launch-site', 1], ['thermo', 'lowAtmo', 'grassland', 2],
    ['baro', 'lowAtmo', 'shores', 1], ['thermo', 'highAtmo', 'global', 1], ['baro', 'highAtmo', 'global', 2],
    ['matbay', 'lowOrbit', 'global', 1], ['geiger', 'lowOrbit', 'desert', 1], ['geiger', 'suborbital', 'global', 1],
    ['thermo', 'lowOrbit', 'global', 3], ['seismic', 'pad', 'launch-site', 1],
  ];
  const t0 = Date.parse('2026-11-13T17:00:00Z');
  const archive: ArchiveEntry[] = rows.map(([id, sit, biome, runs], i) => {
    const exp = EXPERIMENT_BY_ID.get(id)!;
    let pts = 0; for (let r = 0; r < runs; r++) pts += scienceValue(exp, sit, r);
    const b = subjectBiome(exp, sit, biome);
    return {
      subject: subjectKey(id, sit, b), experimentId: id, situation: sit, biome: b, runs,
      points: Math.round(pts * 100) / 100, ceiling: subjectCap(exp, sit) * 2, lastAt: t0 - i * 1800e3,
      flavor: flavorText(id, sit, b),
    };
  });
  const total = Math.round(archive.reduce((s, a) => s + a.points, 0) * 100) / 100;
  const nodes = ['start', 'basic-science', 'general-rocketry', 'electrics'];
  const spent = nodes.reduce((s, n) => s + (TECH_BY_ID.get(n)?.cost ?? 0), 0);
  return {
    total, spent, available: Math.max(0, Math.round((total - spent) * 100) / 100), nodes, unlockedParts: [...unlockedParts(nodes)],
    archive, grantToday: 1_340, grantCap: SCIENCE_GRANT_DAILY_CAP, grantPerPoint: SCIENCE_GRANT_PER_POINT,
  };
}

const fmtPts = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
const biomeName = (b: string) => b === 'global' ? 'Global' : BIOMES[b as BiomeId]?.name ?? b;
const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

// ───────────────────────── survey tab ─────────────────────────

export function SurveyPanel({ survey, signedIn, busy, onSync, initialType, now }: {
  survey: SurveyViewData; signedIn: boolean; busy: boolean; onSync: () => void; initialType?: MapType; now: number;
}) {
  const [type, setType] = useState<MapType>(initialType ?? 'visual');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const map = survey.maps.find((m) => m.mapType === type) ?? { mapType: type, grid: '', pct: 0, milestone: 0, mappers: 0, updatedAt: 0 };
  const grid = useMemo(() => map.grid ? gridFromBytes(b64ToBytes(map.grid)) : emptyGrid(), [map.grid]);
  const sc = SCANNER_BY_TYPE.get(type)!;
  const node = PART_TECH.get(sc.partId);

  useEffect(() => {
    const draw = () => {
      const c = canvasRef.current; if (!c) return;
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.max(1, Math.floor(r.width * dpr)); c.height = Math.max(1, Math.floor(r.height * dpr));
      const ctx = c.getContext('2d'); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSurveyMap(ctx, type, { w: r.width, h: r.height, lonCells: SURVEY_LON, latCells: SURVEY_LAT, isCovered: (i, j) => isFilled(grid, cellIndex(i, j)) });
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [type, grid]);

  return (
    <div className="spc-body">
      <div className="spc-survey" data-testid="spc-survey">
        <aside className="spc-col spc-maplist">
          <h2>Planetary survey</h2>
          {MAP_ORDER.map((t) => {
            const m = survey.maps.find((x) => x.mapType === t);
            return (
              <button key={t} type="button" className={'spc-maptype' + (t === type ? ' on' : '')} onClick={() => setType(t)} data-testid={`spc-map-${t}`}>
                <span className="t">{MAP_TYPE_INFO[t].title}</span>
                <span className="pct">{(m?.pct ?? 0).toFixed(1)}%</span>
                <span className="bar"><i style={{ width: `${Math.min(100, m?.pct ?? 0)}%` }} /></span>
                <small>{m?.mappers ? `${m.mappers} mapper${m.mappers === 1 ? '' : 's'} in orbit` : 'No mapper yet'}</small>
              </button>
            );
          })}
          <button type="button" className="spc-btn primary" disabled={busy || !signedIn} onClick={onSync} data-testid="spc-survey-sync">Download survey data</button>
          <p className="spc-fine">Scanners keep mapping while you are away. Each download plays back at most {Math.round(survey.advanceCapS / 3600)} h of orbit; longer gaps are not credited.</p>
        </aside>
        <section className="spc-mapwrap">
          <div className="spc-maphead">
            <div>
              <h2>{MAP_TYPE_INFO[type].title} map</h2>
              <p>{MAP_TYPE_INFO[type].blurb}</p>
            </div>
            <div className="big" data-testid="spc-map-pct">{map.pct.toFixed(1)}%</div>
          </div>
          <div className="spc-mapframe">
            <canvas ref={canvasRef} data-testid="spc-survey-map" />
            <div className="lat n">90°N</div><div className="lat e">0°</div><div className="lat s">90°S</div>
          </div>
          <MapLegend type={type} />
          <div className="spc-miles" data-testid="spc-milestones">
            {SURVEY_MILESTONES.map((m) => {
              const got = map.milestone >= m;
              const reached = map.pct >= m;
              return (
                <div key={m} className={'mile' + (got ? ' got' : reached ? ' due' : '')}>
                  <b>{m}%</b>
                  <span>🪙 {(survey.milestonePayouts[String(m)] ?? SURVEY_MILESTONE_PAYOUT[m] ?? 0).toLocaleString('en-US')}</span>
                  <small>{got ? 'Paid' : reached ? 'Download to claim' : 'Not yet'}</small>
                </div>
              );
            })}
          </div>
        </section>
        <aside className="spc-col spc-mapinfo">
          <h2>Scanner</h2>
          <div className="spc-read">
            <div className="row"><span>Part</span><b>{PART_BY_ID.get(sc.partId)?.short ?? sc.name}</b></div>
            <div className="row"><span>Best altitude</span><b>{sc.minAlt / 1000}–{sc.maxAlt / 1000} km</b></div>
            <div className="row"><span>Swath</span><b>{sc.swathDeg}°</b></div>
            <div className="row"><span>Polar orbit</span><b>{sc.inclinationDeg}° modelled</b></div>
            <div className="row"><span>Research</span><b>{node ? TECH_BY_ID.get(node)?.name : 'Starter'}</b></div>
          </div>
          <p className="spc-fine">Coverage is fastest inside the band. Below it the swath narrows quickly; above it the scanner loses resolution and stops at {Math.round(sc.maxAlt * 1.6 / 1000)} km.</p>
          <h2>Mappers in orbit</h2>
          <div className="spc-mappers" data-testid="spc-mappers">
            {survey.mappers.length === 0 && <p className="spc-fine">Fly a scanner into its band and deploy it. Scanners deploy like satellites (T).</p>}
            {survey.mappers.map((m) => (
              <div key={m.id} className={'mapper' + (m.mapType === type ? ' on' : '')}>
                <b>{MAP_TYPE_INFO[m.mapType].title}</b>
                <span>{fmtAlt(m.peM)} × {fmtAlt(m.apM)}</span>
                <small>Up {ago(now - m.deployedAt)}</small>
              </div>
            ))}
          </div>
          <h2>All scanners</h2>
          <table className="spc-scantable">
            <thead><tr><th>Map</th><th>Band</th><th>Swath</th></tr></thead>
            <tbody>
              {SCANNERS.map((s) => <tr key={s.id} className={s.mapType === type ? 'on' : ''}><td>{MAP_TYPE_INFO[s.mapType].title}</td><td>{s.minAlt / 1000}–{s.maxAlt / 1000} km</td><td>{s.swathDeg}°</td></tr>)}
            </tbody>
          </table>
        </aside>
      </div>
    </div>
  );
}

function MapLegend({ type }: { type: MapType }) {
  if (type === 'biome') {
    return (
      <div className="spc-legend">
        {(Object.keys(BIOMES) as BiomeId[]).map((b) => <span key={b}><i style={{ background: BIOMES[b].color }} />{BIOMES[b].name}</span>)}
      </div>
    );
  }
  const ramps: Record<Exclude<MapType, 'biome'>, [string, string, string]> = {
    altimetry: ['linear-gradient(90deg,#0a2a6a,#2a7ac0,#3aa060,#c8b060,#a05a30,#fff)', 'Deep ocean', 'Peaks'],
    resource: ['linear-gradient(90deg,#10141c,#3a1a5a,#b02a5a,#f08030,#ffe070)', 'Trace', 'Rich ore'],
    visual: ['linear-gradient(90deg,#123a6a,#2c6a3a,#c8a060,#eef4fa)', 'Sea', 'Ice'],
    weather: ['linear-gradient(90deg,#14304a,#5a7a90,#cfd8e0,#ffffff)', 'Clear', 'Storm'],
  };
  const [bg, lo, hi] = ramps[type];
  return <div className="spc-legend ramp"><small>{lo}</small><i style={{ background: bg }} /><small>{hi}</small></div>;
}

// ───────────────────────── science tab ─────────────────────────

const SIT_ORDER: Situation[] = ['pad', 'lowAtmo', 'highAtmo', 'suborbital', 'lowOrbit', 'highOrbit'];

export function SciencePanel({ science, signedIn, busy, initial, onUnlock }: {
  science: ScienceViewData; signedIn: boolean; busy: boolean; initial?: 'archive' | 'tech'; onUnlock: (id: string) => void;
}) {
  const [tab, setTab] = useState<'archive' | 'tech'>(initial ?? 'archive');
  return (
    <div className="spc-body">
      <div className="spc-science" data-testid="spc-science">
        <div className="spc-scihead">
          <div className="pts"><b data-testid="spc-sci-available">{fmtPts(science.available)}</b><small>science available</small></div>
          <div className="pts"><b>{fmtPts(science.total)}</b><small>earned</small></div>
          <div className="pts"><b>{fmtPts(science.spent)}</b><small>spent on research</small></div>
          <div className="pts"><b>🪙 {science.grantToday.toLocaleString('en-US')} / {science.grantCap.toLocaleString('en-US')}</b><small>research grants today</small></div>
          <nav className="spc-subtabs">
            <button type="button" className={tab === 'archive' ? 'on' : ''} onClick={() => setTab('archive')} data-testid="spc-sci-archive-tab">Archive</button>
            <button type="button" className={tab === 'tech' ? 'on' : ''} onClick={() => setTab('tech')} data-testid="spc-sci-tech-tab">R&amp;D</button>
          </nav>
        </div>
        {tab === 'archive' ? <Archive science={science} /> : <TechTree science={science} signedIn={signedIn} busy={busy} onUnlock={onUnlock} />}
      </div>
    </div>
  );
}

function Archive({ science }: { science: ScienceViewData }) {
  const bestBySit = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of science.archive) {
      const k = `${a.experimentId}@${a.situation}`;
      m.set(k, (m.get(k) ?? 0) + a.runs);
    }
    return m;
  }, [science.archive]);
  const owned = new Set(science.unlockedParts);
  return (
    <div className="spc-archive">
      <section className="spc-panel">
        <h2>Experiments × situations</h2>
        <p className="spc-fine">Each cell is the first-run value. Repeats of the same subject earn half of what is left; biome-tagged cells (◆) count each biome separately. Grants pay 🪙 {science.grantPerPoint}/point up to 🪙 {science.grantCap.toLocaleString('en-US')} a day.</p>
        <table className="spc-matrix" data-testid="spc-sci-matrix">
          <thead><tr><th>Experiment</th>{SIT_ORDER.map((s) => <th key={s}>{SITUATIONS[s].name}<small>×{SITUATIONS[s].mult}</small></th>)}</tr></thead>
          <tbody>
            {EXPERIMENTS.map((e) => (
              <tr key={e.id} className={owned.has(e.partId) ? '' : 'locked'}>
                <td><b>{e.name}</b><small>{owned.has(e.partId) ? `base ${e.base}` : `🔒 ${TECH_BY_ID.get(PART_TECH.get(e.partId) ?? '')?.name ?? ''}`}</small></td>
                {SIT_ORDER.map((s) => {
                  if (!e.situations.includes(s)) return <td key={s} className="na">—</td>;
                  const runs = bestBySit.get(`${e.id}@${s}`) ?? 0;
                  return (
                    <td key={s} className={runs ? 'done' : ''}>
                      {fmtPts(subjectCap(e, s))}{e.biomeIn.includes(s) ? ' ◆' : ''}
                      {runs > 0 && <small>{runs}×</small>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="spc-panel">
        <h2>Science archive</h2>
        {science.archive.length === 0 && <p className="spc-fine">No results yet. Put a thermometer or barometer on a rocket and run it on the pad — that already counts.</p>}
        <div className="spc-results" data-testid="spc-sci-archive">
          {science.archive.map((a) => {
            const exp = EXPERIMENT_BY_ID.get(a.experimentId);
            const frac = a.ceiling > 0 ? Math.min(1, a.points / a.ceiling) : 0;
            return (
              <article key={a.subject} className="spc-result">
                <header>
                  <b>{exp?.name ?? a.experimentId}</b>
                  <span>{SITUATIONS[a.situation]?.name}{a.biome !== 'global' ? ` · ${biomeName(a.biome)}` : ''}</span>
                </header>
                <p>“{a.flavor}”</p>
                <footer>
                  <span className="bar"><i style={{ width: `${frac * 100}%` }} /></span>
                  <small>{fmtPts(a.points)} / {fmtPts(a.ceiling)} pts · {a.runs} run{a.runs === 1 ? '' : 's'}</small>
                </footer>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const TREE_POS: Record<string, [number, number]> = {
  start: [0, 3],
  stability: [1, 0.6], 'basic-science': [1, 2.6], 'general-rocketry': [1, 4.8],
  aerodynamics: [2, 0], 'flight-control': [2, 1], electrics: [2, 2.1], miniaturization: [2, 3.1], 'advanced-rocketry': [2, 4.3], 'propulsion-systems': [2, 5.4],
  'command-modules': [3, 0.4], 'electric-power': [3, 1.5], 'science-tech': [3, 2.5], communications: [3, 3.5], 'heavier-rocketry': [3, 4.6],
  'advanced-exploration': [4, 1.6], optics: [4, 2.8], 'heavy-rocketry': [4, 4.1], 'nuclear-propulsion': [4, 5.3],
  'space-stations': [5, 0.6], 'nuclear-power': [5, 2.4], 'advanced-propulsion': [5, 4.6],
  'ion-propulsion': [6, 3.4],
};
const COL_W = 214, ROW_H = 118, CARD_W = 186, CARD_H = 104;

function TechTree({ science, signedIn, busy, onUnlock }: { science: ScienceViewData; signedIn: boolean; busy: boolean; onUnlock: (id: string) => void }) {
  const have = new Set(science.nodes);
  const W = 7 * COL_W, H = Math.ceil(Math.max(...Object.values(TREE_POS).map(([, r]) => r)) * ROW_H + CARD_H + 16);
  const pos = (id: string) => { const [c, r] = TREE_POS[id] ?? [0, 0]; return { x: 8 + c * COL_W, y: 8 + r * ROW_H }; };
  return (
    <div className="spc-techwrap">
      <div className="spc-tree" style={{ width: W, height: H }} data-testid="spc-tech-tree">
        <svg width={W} height={H} className="links" aria-hidden>
          {TECH_NODES.flatMap((n) => n.requires.map((r) => {
            const a = pos(r), b = pos(n.id);
            const x1 = a.x + CARD_W, y1 = a.y + CARD_H / 2, x2 = b.x, y2 = b.y + CARD_H / 2;
            const mx = (x1 + x2) / 2;
            return <path key={`${r}-${n.id}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} className={have.has(r) && have.has(n.id) ? 'on' : have.has(r) ? 'next' : ''} />;
          }))}
        </svg>
        {TECH_NODES.map((n) => {
          const p = pos(n.id);
          const owned = have.has(n.id);
          const why = owned ? null : canUnlock(n.id, have, science.available);
          const ready = !owned && !why;
          const prereqOk = n.requires.every((r) => have.has(r));
          return (
            <div key={n.id} className={'spc-node' + (owned ? ' owned' : ready ? ' ready' : prereqOk ? ' afford' : ' locked')} style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }} data-testid={`spc-node-${n.id}`}>
              <header><b>{n.name}</b><span>{owned ? '✓' : `${n.cost} ⚗`}</span></header>
              <div className="parts">{n.unlocks.map((u) => <span key={u} title={PART_BY_ID.get(u)?.description}>{PART_BY_ID.get(u)?.short ?? u}</span>)}</div>
              {n.requires.length > 0 && <small className="req">Requires {n.requires.map((r) => TECH_BY_ID.get(r)?.name ?? r).join(' + ')}</small>}
              {!owned && (
                <button type="button" className="spc-btn" disabled={!ready || busy || !signedIn} onClick={() => onUnlock(n.id)} title={why ?? ''}>
                  {ready ? 'Research' : prereqOk ? `Need ${fmtPts(n.cost - science.available)} more` : 'Locked'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="spc-fine">Starter parts — every engine, tank, booster and decoupler you already had — stay unlocked. Research only adds parts. Science is never converted back to chips.</p>
    </div>
  );
}

// ───────────────────────── in-flight experiments ─────────────────────────

export function flightMetS(s: FlightState): number {
  return s.phase === 'pad' || s.phase === 'countdown' ? 0 : Math.max(0, s.t - s.met0);
}

export function ExperimentsPanel({ flight, science, done, onRun, busy }: {
  flight: FlightState; science: ScienceViewData; done: Set<string>; busy: boolean;
  onRun: (partUid: string, exp: ExperimentDef, situation: Situation, biome: string) => void;
}) {
  const sit = situationFromState(flight);
  const biome = biomeUnder(flight);
  const parts = flight.parts.filter((p) => p.attached && p.def.category === 'science');
  const seen = new Set<string>();
  const runsOf = (subject: string) => science.archive.find((a) => a.subject === subject)?.runs ?? 0;
  if (!parts.length) return null;
  return (
    <div className="spc-exps" data-testid="spc-experiments">
      <h2>Experiments <small>{SITUATIONS[sit].name} · {biomeName(biome)}</small></h2>
      {parts.map((p) => {
        const exp = EXPERIMENT_BY_PART.get(p.partId);
        if (!exp || seen.has(exp.id)) return null;
        seen.add(exp.id);
        const allowed = exp.situations.includes(sit);
        const b = subjectBiome(exp, sit, biome);
        const subject = subjectKey(exp.id, sit, b);
        const value = allowed ? scienceValue(exp, sit, runsOf(subject)) : 0;
        const ran = done.has(subject);
        return (
          <div key={p.uid} className={'exp' + (allowed && !ran ? ' live' : '')}>
            <span><b>{exp.name}</b><small>{ran ? 'Recorded this flight' : allowed ? `${fmtPts(value)} pts${b !== 'global' ? ` · ${biomeName(b)}` : ''}` : 'Not useful here'}</small></span>
            <button type="button" className="spc-btn" disabled={!allowed || ran || busy || value <= 0} onClick={() => onRun(p.uid, exp, sit, biome)} data-testid={`spc-run-${exp.id}`}>Run</button>
          </div>
        );
      })}
    </div>
  );
}

export function ResultCard({ r, onClose }: { r: ScienceResult; onClose: () => void }) {
  return (
    <div className="spc-sciresult" role="status" data-testid="spc-sci-result">
      <header><span>⚗</span><b>{r.name}</b><button type="button" onClick={onClose} aria-label="Dismiss">✕</button></header>
      <div className="where">{SITUATIONS[r.situation]?.name}{r.biome !== 'global' ? ` · ${biomeName(r.biome)}` : ''}</div>
      <p>“{r.flavor}”</p>
      <footer><b>+{fmtPts(r.points)} science</b>{r.grant > 0 ? <span>Grant 🪙 {r.grant.toLocaleString('en-US')}</span> : <span>Grant cap reached</span>}</footer>
    </div>
  );
}

export function techLabelFor(partId: string): string | null {
  const n = PART_TECH.get(partId);
  return n ? TECH_BY_ID.get(n)?.name ?? n : null;
}
