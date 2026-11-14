import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '@/lib/net';
import {
  SPACE_PARTS, PART_CATEGORIES, PART_GROUPS, PART_SIZES, sizeClassesOf, clusterCounts, LIMIT_MIN, PART_BY_ID, courierI, scoutI, goliathHeavy, STOCK_DESIGNS, cloneDesign,
  makeDesign, newPartUid, defaultStageFor, designCost, validateDesign, hasErrors, parseDesign,
  type VesselDesign, type PlacedPart, type PartCategory, type PartDef,
} from '../../../shared/spaceParts';
import {
  analyzeDesign, launchState, stepFlight, activateStage, abortFlight, tryDeploy, shouldAutoStage,
  computeGuidance, scriptedAscent, orbitalElements, altitudeOf, inertialSpeed, surfaceSpeed,
  liveDv, fmtAlt, fmtVel, fmtDv, fmtMass, fmtMet, PLANET, LEO_DV_BUDGET, MIN_LIFTOFF_TWR,
  SPACE_PAYOUT, SPACE_MAX_PAID, TARGET_PE,
  type FlightState, type FlightLogEntry, type DesignStats,
} from '../../../shared/spaceFlight';
import { drawVab, hitVab, drawMission, drawOrbitMap, primeDebris, type PartBox, type McCamera, type FleetMarker } from '@/lib/spaceDraw';
import {
  dailyBoard, utcDay, criteriaOnly, designMeetsMission, MISSION_DAILY_CAP, MISSION_MAX_ACTIVE,
  type MissionDef,
} from '../../../shared/spaceMissions';
import { SpaceContracts, type MissionViewData, type MissionCompleteNote } from './SpaceContracts';
import {
  SurveyPanel, SciencePanel, ExperimentsPanel, ResultCard, techLabelFor, flightMetS,
  emptySurvey, emptyScience, previewSurvey, previewScience,
  type SurveyViewData, type ScienceViewData, type ScienceResult,
} from './SpaceResearch';
import {
  isPartUnlocked, TECH_NODES, scienceValue, EXPERIMENT_BY_ID, subjectBiome, subjectKey, flavorText, situationFromState, biomeUnder,
  type Situation, type ExperimentDef,
} from '../../../shared/spaceScience';
import type { MapType } from '../../../shared/spaceSurvey';
import '../spaceSim.css';

export type SpaceView = 'hangar' | 'vab' | 'launch' | 'contracts' | 'survey' | 'science';
export type SpacePreviewView = SpaceView | 'ascent' | 'orbit' | 'ascent-low' | 'ascent-high' | 'ground-track'
  | 'pad' | 'ascent-mid' | 'ascent-handoff' | 'staging' | 'deploy' | 'survey-weather' | 'missions' | 'mission-complete'
  | 'survey-altimetry' | 'survey-biome' | 'survey-resource' | 'science-archive' | 'tech-tree' | 'science-flight' | 'science-orbit'
  | 'vab-heavy' | 'heavy-ascent' | 'heavy-staging';
export type SpacePreview = { view: SpacePreviewView; freeze?: boolean };

type ViewData = {
  signedIn: boolean; chips: number | null;
  designs: Array<{ id: string; name: string; design: VesselDesign; updatedAt: number }>;
  sats: Array<{ id: string; satName: string; designName: string; peM: number; apM: number; payout: number; paid: boolean; deployedAt: number; ownerName?: string }>;
  board: Array<{ name: string; sats: number; lastAt: number }>;
  rules: { payout: number; maxPaid: number; paid: number; remainingPaid: number; cooldownLeft: number; leoDv: number; minTwr: number };
  missions: MissionViewData;
  science: ScienceViewData;
  survey: SurveyViewData;
  social: SocialView;
};

/** Shared, cross-player view: everyone's satellites, recent launches, leaderboards. */
export type SocialView = {
  fleet: Array<{ id: string; ownerName: string; satName: string; designName: string; peM: number; apM: number; periodS: number | null; deployedAt: number }>;
  feed: Array<{ id: string; ownerName: string; designName: string; missionTitle: string | null; at: number; deployed: boolean }>;
  leaders: { sats: Array<{ name: string; sats: number; lastAt: number }>; science: Array<{ name: string; points: number }>; survey: Array<{ name: string; pct: number }> };
  at: number;
};
const emptySocial = (): SocialView => ({ fleet: [], feed: [], leaders: { sats: [], science: [], survey: [] }, at: 0 });
/** Poll interval for the shared view while the Space Center is open and visible. */
const SOCIAL_POLL_MS = 90_000;

function previewSocial(): SocialView {
  const t0 = Date.parse('2026-11-13T18:00:00Z');
  const pilots = ['Vega', 'Orion', 'Lyra', 'Preview'];
  const fleet = [
    { id: 'p1', ownerName: 'Vega', satName: 'CommSat', designName: 'Courier I', peM: 81_000, apM: 84_000, periodS: 1_990, deployedAt: t0 - 3_600_000 },
    { id: 'p2', ownerName: 'Orion', satName: 'SciSat', designName: 'Heavy Lifter', peM: 120_000, apM: 135_000, periodS: 2_300, deployedAt: t0 - 7_200_000 },
    { id: 'p3', ownerName: 'Lyra', satName: 'WeatherSat', designName: 'Scout I', peM: 95_000, apM: 99_000, periodS: 2_090, deployedAt: t0 - 1_800_000 },
    { id: 'p4', ownerName: 'Vega', satName: 'CommSat', designName: 'Courier II', peM: 150_000, apM: 160_000, periodS: 2_520, deployedAt: t0 - 600_000 },
    { id: 'p5', ownerName: 'Preview', satName: 'CommSat', designName: 'Courier I', peM: 75_700, apM: 89_400, periodS: 1_980, deployedAt: t0 - 300_000 },
  ];
  return {
    fleet,
    feed: [
      { id: 'f1', ownerName: 'Lyra', designName: 'Scout I', missionTitle: 'Weather watch', at: t0 - 120_000, deployed: true },
      { id: 'f2', ownerName: 'Vega', designName: 'Courier II', missionTitle: null, at: t0 - 600_000, deployed: true },
      { id: 'f3', ownerName: 'Orion', designName: 'Heavy Lifter', missionTitle: 'High orbit relay', at: t0 - 1_500_000, deployed: false },
      { id: 'f4', ownerName: 'Vega', designName: 'Courier I', missionTitle: null, at: t0 - 3_700_000, deployed: true },
    ],
    leaders: {
      sats: [{ name: 'Vega', sats: 2, lastAt: t0 }, { name: 'Orion', sats: 1, lastAt: t0 }, { name: 'Lyra', sats: 1, lastAt: t0 }, { name: 'Preview', sats: 1, lastAt: t0 }],
      science: pilots.map((name, i) => ({ name, points: [412, 288, 190, 96][i]! })),
      survey: pilots.map((name, i) => ({ name, pct: [38.5, 22.1, 12.4, 6.2][i]! })),
    },
    at: t0,
  };
}

/** "3 min ago" style relative time for the feed. */
function ago(at: number, now = Date.now()): string {
  const d = Math.max(0, now - at) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86_400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86_400)} d ago`;
}

/** Map markers from the shared fleet (positions are display-only). */
function fleetMarkers(social: SocialView, me: string | null | undefined): FleetMarker[] {
  return social.fleet.slice(0, 40).map((f) => {
    let h = 0;
    for (let i = 0; i < f.id.length; i++) h = (h * 31 + f.id.charCodeAt(i)) >>> 0;
    return {
      id: f.id, label: f.ownerName, altM: (f.peM + f.apM) / 2, periodS: f.periodS ?? 2_000,
      seed: (h % 1000) / 1000, mine: !!me && f.ownerName.toLowerCase() === me.toLowerCase(),
    };
  });
}

const previewDay = '2026-11-13';
function previewMissions(complete = false): MissionViewData {
  const board = dailyBoard(previewDay);
  const pick = board.find((m) => m.templateId === 'deploy-250') ?? board.find((m) => m.kind === 'deploy-orbit') ?? board[0]!;
  const accepted = complete
    ? [{ missionId: pick.id, acceptedAt: Date.parse(previewDay + 'T12:00:00Z'), completedAt: Date.parse(previewDay + 'T12:10:00Z'), payout: pick.payout }]
    : [{ missionId: pick.id, acceptedAt: Date.parse(previewDay + 'T12:00:00Z'), completedAt: null, payout: 0 }];
  return {
    day: previewDay, board, accepted,
    completedIds: complete ? [pick.id] : [],
    paidToday: complete ? pick.payout : 0,
    dailyCap: MISSION_DAILY_CAP,
    remainingCap: complete ? MISSION_DAILY_CAP - pick.payout : MISSION_DAILY_CAP,
    maxActive: MISSION_MAX_ACTIVE,
  };
}

const emptyView = (preview?: SpacePreview): ViewData => ({
  signedIn: !!preview, chips: preview ? 42_000 : null, designs: [], sats: [], board: [],
  rules: { payout: SPACE_PAYOUT, maxPaid: SPACE_MAX_PAID, paid: 0, remainingPaid: SPACE_MAX_PAID, cooldownLeft: 0, leoDv: LEO_DV_BUDGET, minTwr: MIN_LIFTOFF_TWR },
  missions: preview?.view === 'mission-complete' ? previewMissions(true)
    : preview?.view === 'missions' ? previewMissions(false)
    : { day: utcDay(Date.now()), board: dailyBoard(utcDay(Date.now())), accepted: [], completedIds: [], paidToday: 0, dailyCap: MISSION_DAILY_CAP, remainingCap: MISSION_DAILY_CAP, maxActive: MISSION_MAX_ACTIVE },
  science: preview ? previewScience() : emptyScience(),
  survey: preview ? previewSurvey() : emptySurvey(),
  social: preview ? previewSocial() : emptySocial(),
});

/** Courier I with a science package bolted on (preview flights). */
function sciCourier(): VesselDesign {
  const base = courierI();
  const pod = base.parts.find((p) => p.partId === 'probe-okto') ?? base.parts[0]!;
  return {
    ...base, name: 'Courier I Sci',
    parts: [
      ...base.parts,
      ...['sci-thermo', 'sci-baro', 'sci-geiger', 'sci-mag', 'sci-matbay'].map((id, i) => ({ uid: `sci${i}`, partId: id, stage: 15, radial: true, angle: i * 72, attachTo: pod.uid })),
    ],
  };
}
const PREVIEW_SURVEY: Record<string, MapType> = { survey: 'visual', 'survey-altimetry': 'altimetry', 'survey-biome': 'biome', 'survey-resource': 'resource', 'survey-weather': 'weather' };

type FrozenKind = 'ascent' | 'orbit' | 'ascent-low' | 'ascent-high' | 'science-flight' | 'science-orbit' | 'pad' | 'ascent-mid' | 'ascent-handoff' | 'staging' | 'deploy' | 'heavy-ascent' | 'heavy-staging';
const FROZEN_VIEWS: string[] = ['ascent', 'orbit', 'ascent-low', 'ascent-high', 'ground-track', 'science-flight', 'science-orbit', 'pad', 'ascent-mid', 'ascent-handoff', 'staging', 'deploy', 'heavy-ascent', 'heavy-staging'];
const HEAVY_VIEWS: string[] = ['vab-heavy', 'heavy-ascent', 'heavy-staging'];
const HEAVY_OPTS = { dt: 0.05, targetAp: 400_000, targetPe: 380_000 };

function freezeAscent(kind: FrozenKind): FlightState {
  // Heavy lifter: boosters and the quad cluster burning together, then just after the boosters separate.
  if (kind === 'heavy-ascent') return scriptedAscent(goliathHeavy(), { ...HEAVY_OPTS, maxTime: 38 }).state;
  if (kind === 'heavy-staging') return scriptedAscent(goliathHeavy(), { ...HEAVY_OPTS, maxTime: 62.6 }).state;
  if (kind === 'pad') return scriptedAscent(courierI(), { dt: 0.05, maxTime: 60, stopAtAltitude: 25 }).state;
  if (kind === 'ascent-mid') return scriptedAscent(courierI(), { dt: 0.05, maxTime: 200, stopAtAltitude: 24_000 }).state;
  if (kind === 'ascent-handoff') return scriptedAscent(courierI(), { dt: 0.05, maxTime: 280, stopAtAltitude: 64_000 }).state;
  if (kind === 'staging') return scriptedAscent(courierI(), { dt: 0.05, maxTime: 221.6 }).state;
  if (kind === 'deploy') {
    // Payload released a few seconds ago (display only).
    const s = scriptedAscent(courierI(), { dt: 0.05, maxTime: 900 }).state;
    s.t += 3.5;
    return s;
  }
  if (kind === 'science-flight') return scriptedAscent(sciCourier(), { dt: 0.05, maxTime: 280, stopAtAltitude: 46_000 }).state;
  if (kind === 'science-orbit') return scriptedAscent(sciCourier(), { dt: 0.05, maxTime: 900 }).state;
  if (kind === 'orbit') return scriptedAscent(courierI(), { dt: 0.05, maxTime: 900 }).state;
  if (kind === 'ascent-low') return scriptedAscent(courierI(), { dt: 0.05, maxTime: 200, stopAtAltitude: 18_000 }).state;
  if (kind === 'ascent-high') return scriptedAscent(courierI(), { dt: 0.05, maxTime: 280, stopAtAltitude: 57_000 }).state;
  return scriptedAscent(courierI(), { dt: 0.05, maxTime: 90 }).state;
}

function previewCamera(view?: SpacePreviewView): McCamera {
  if (view === 'ascent-low' || view === 'ascent') return 'horizon';
  if (view === 'pad' || view === 'ascent-mid' || view === 'staging' || view === 'heavy-ascent' || view === 'heavy-staging') return 'horizon';
  if (view === 'deploy') return 'globe';
  if (view === 'ground-track') return 'track';
  if (view === 'orbit') return 'globe';
  if (view === 'science-flight') return 'horizon';
  if (view === 'science-orbit') return 'globe';
  return 'auto';
}

export function SpaceProgram({ me, onClose, preview }: { me?: string | null; onClose: () => void; preview?: SpacePreview }) {
  const launchViews = ['launch', ...FROZEN_VIEWS];
  const initialView: SpaceView = preview?.view && launchViews.includes(preview.view) ? 'launch'
    : preview?.view === 'vab' || preview?.view === 'vab-heavy' ? 'vab'
    : preview?.view && preview.view in PREVIEW_SURVEY ? 'survey'
    : preview?.view === 'science' || preview?.view === 'science-archive' || preview?.view === 'tech-tree' ? 'science'
    : preview?.view === 'missions' || preview?.view === 'mission-complete' || preview?.view === 'contracts' ? 'contracts'
    : preview?.view === 'hangar' ? 'hangar' : 'hangar';
  const [view, setView] = useState<SpaceView>(initialView);
  const [data, setData] = useState<ViewData>(() => {
    const d = emptyView(preview);
    // Heavy previews show a fully researched program so every part is available.
    if (preview && HEAVY_VIEWS.includes(preview.view)) d.science = { ...d.science, nodes: TECH_NODES.map((n) => n.id) };
    return d;
  });
  const sciPreview = preview?.view === 'science-flight' || preview?.view === 'science-orbit';
  const [design, setDesign] = useState<VesselDesign>(() => cloneDesign(preview && HEAVY_VIEWS.includes(preview.view) ? goliathHeavy() : sciPreview ? sciCourier() : courierI()));
  const [selected, setSelected] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [missionId, setMissionId] = useState<string | null>(() => {
    if (preview?.view === 'missions' || preview?.view === 'mission-complete') {
      const m = emptyView(preview).missions;
      return m.accepted[0]?.missionId ?? m.board[0]?.id ?? null;
    }
    return null;
  });
  const [completeNote, setCompleteNote] = useState<MissionCompleteNote | null>(() => {
    if (preview?.view === 'mission-complete') {
      const m = emptyView(preview).missions;
      const def = m.board.find((x) => x.id === m.completedIds[0]) ?? m.board[0]!;
      return { mission: def, payout: def.payout };
    }
    return null;
  });
  const [flight, setFlight] = useState<FlightState | null>(() => {
    if (preview?.view === 'ground-track' || (preview?.view === 'launch' && preview.freeze)) return freezeAscent('orbit');
    if (preview && FROZEN_VIEWS.includes(preview.view)) {
      if (preview.view === 'staging') primeDebris(scriptedAscent(courierI(), { dt: 0.05, maxTime: 220.85 }).state);
      if (preview.view === 'heavy-staging') primeDebris(scriptedAscent(goliathHeavy(), { ...HEAVY_OPTS, maxTime: 61.2 }).state);
      return freezeAscent(preview.view as FrozenKind);
    }
    return null;
  });
  const [guidance, setGuidance] = useState(true);
  const [warp, setWarp] = useState(1);
  const [countdown, setCountdown] = useState<number | null>(preview ? null : null);
  const [launchId, setLaunchId] = useState<string | null>(preview ? 'preview' : null);
  const [paidNote, setPaidNote] = useState<string | null>(null);
  const trail = useRef<Array<[number, number]>>([]);
  const previewResult = useMemo<ScienceResult | null>(() => {
    if (!sciPreview) return null;
    const f = freezeAscent(preview!.view as 'science-flight' | 'science-orbit');
    const sit = situationFromState(f);
    const exp = EXPERIMENT_BY_ID.get(sit === 'highAtmo' ? 'geiger' : 'magneto')!;
    const b = subjectBiome(exp, sit, biomeUnder(f));
    const subject = subjectKey(exp.id, sit, b);
    const runs = emptyView(preview).science.archive.find((a) => a.subject === subject)?.runs ?? 0;
    const points = scienceValue(exp, sit, runs);
    return { experimentId: exp.id, name: exp.name, situation: sit, biome: b, points, grant: Math.round(points * 20), flavor: flavorText(exp.id, sit, b), subject };
  }, [sciPreview, preview]);
  const [sciDone, setSciDone] = useState<Set<string>>(() => new Set(previewResult ? [previewResult.subject] : []));
  const [sciResult, setSciResult] = useState<ScienceResult | null>(previewResult);

  const load = useCallback(async () => {
    if (preview) return;
    const r = await request('space_view') as { ok: boolean } & Partial<ViewData>;
    if (r.ok) setData({
      signedIn: !!r.signedIn, chips: r.chips ?? null,
      designs: r.designs ?? [], sats: r.sats ?? [], board: r.board ?? [],
      rules: { ...emptyView().rules, ...(r.rules ?? {}) },
      missions: { ...emptyView().missions, ...(r.missions ?? {}) },
      science: { ...emptyScience(), ...(r.science ?? {}) },
      survey: { ...emptySurvey(), ...(r.survey ?? {}) },
      social: { ...emptySocial(), ...(r.social ?? {}) },
    });
  }, [preview]);
  useEffect(() => { void load(); }, [load]);
  // Shared view: a light poll (server-cached), only while this tab is visible.
  useEffect(() => {
    if (preview) return;
    let stop = false;
    let last = Date.now();
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      last = Date.now();
      const r = await request('space_social') as { ok: boolean; social?: SocialView };
      if (!stop && r.ok && r.social) setData((d) => ({ ...d, social: { ...emptySocial(), ...r.social } }));
    };
    const id = window.setInterval(() => void tick(), SOCIAL_POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - last > SOCIAL_POLL_MS) void tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop = true; window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [preview]);
  const fleet = useMemo(() => fleetMarkers(data.social, preview ? 'Preview' : me), [data.social, me, preview]);

  const stats = useMemo(() => analyzeDesign(design), [design]);
  const nodes = data.science.nodes;

  const syncSurvey = useCallback(async (quiet = false) => {
    if (preview || !me) return;
    setBusy(true);
    const r = await request('space_survey_sync') as { ok: boolean; error?: string; paid?: number; survey?: SurveyViewData; payouts?: Array<{ mapType: MapType; at: number; payout: number }> };
    setBusy(false);
    if (!r.ok) { if (!quiet) setMsg(r.error ?? 'Survey download failed.'); return; }
    if (r.survey) setData((d) => ({ ...d, survey: { ...emptySurvey(), ...r.survey } }));
    if (r.paid && r.paid > 0) setPaidNote(`Survey milestones paid 🪙 ${r.paid.toLocaleString('en-US')}.`);
    else if (!quiet) setMsg('Survey data downloaded.');
    void load();
  }, [preview, me, load]);
  useEffect(() => { if (view === 'survey') void syncSurvey(true); }, [view, syncSurvey]);

  const runScience = useCallback(async (s: FlightState, partUid: string, exp: ExperimentDef, situation: Situation, biome: string) => {
    const b = subjectBiome(exp, situation, biome);
    const subject = subjectKey(exp.id, situation, b);
    if (preview || !launchId || launchId === 'preview') {
      const runs = data.science.archive.find((a) => a.subject === subject)?.runs ?? 0;
      const points = scienceValue(exp, situation, runs);
      setSciDone((d) => new Set(d).add(subject));
      setSciResult({ experimentId: exp.id, name: exp.name, situation, biome: b, points, grant: Math.round(points * 20), flavor: flavorText(exp.id, situation, b), subject });
      return;
    }
    const el = orbitalElements(s.x, s.y, s.vx, s.vy);
    setBusy(true);
    const r = await request('space_science', {
      launchId, experimentId: exp.id, partUid, situation, biome,
      metS: flightMetS(s), alt: altitudeOf(s), peM: el.peAltitude, apM: el.apAltitude,
    }) as { ok: boolean; error?: string; points?: number; grant?: number; result?: { flavor: string; name: string; biome: string; subject: string } };
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? 'The experiment result was not accepted.'); return; }
    setSciDone((d) => new Set(d).add(subject));
    setSciResult({
      experimentId: exp.id, name: r.result?.name ?? exp.name, situation, biome: r.result?.biome ?? b,
      points: r.points ?? 0, grant: r.grant ?? 0, flavor: r.result?.flavor ?? flavorText(exp.id, situation, b), subject,
    });
    void load();
  }, [preview, launchId, data.science.archive, load]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="spc" data-testid="space-program" role="dialog" aria-label="Space Center">
      <header className="spc-head">
        <div className="spc-mark" aria-hidden>🚀</div>
        <h1>Chud Space Center<small>Vehicle Assembly · Mission Control</small></h1>
        <nav className="spc-tabs">
          <button type="button" className={view === 'hangar' ? 'on' : ''} onClick={() => setView('hangar')} data-testid="spc-hangar-tab">Hangar</button>
          <button type="button" className={view === 'vab' ? 'on' : ''} onClick={() => setView('vab')} data-testid="spc-vab-tab">VAB</button>
          <button type="button" className={view === 'contracts' ? 'on' : ''} onClick={() => setView('contracts')} data-testid="spc-contracts-tab">Contracts</button>
          <button type="button" className={view === 'launch' ? 'on' : ''} onClick={() => setView('launch')} data-testid="spc-mc-tab">Mission Control</button>
          <button type="button" className={view === 'survey' ? 'on' : ''} onClick={() => setView('survey')} data-testid="spc-survey-tab">Survey</button>
          <button type="button" className={view === 'science' ? 'on' : ''} onClick={() => setView('science')} data-testid="spc-science-tab">Science</button>
        </nav>
        <button type="button" className="spc-x" onClick={onClose} aria-label="Close" data-testid="spc-close">✕</button>
      </header>
      {msg && <div className="spc-msg" role="status">{msg}</div>}
      {paidNote && <div className="spc-msg" role="status">{paidNote}</div>}
      {view === 'hangar' && (
        <Hangar
          me={me ?? null} data={data} design={design}
          onNew={() => { setDesign(makeDesign('New vessel', [{ part: 'probe-okto', stage: 15 }])); setSavedId(null); setSelected(null); setView('vab'); }}
          onLoad={(d, id) => { setDesign(cloneDesign(d)); setSavedId(id ?? null); setSelected(null); setView('vab'); }}
          onClose={onClose}
        />
      )}
      {view === 'vab' && (
        <Vab
          design={design} setDesign={setDesign} selected={selected} setSelected={setSelected}
          stats={stats} chips={data.chips} busy={busy} nodes={nodes}
          onSave={async () => {
            if (preview) { setMsg('Design saved (preview).'); return; }
            setBusy(true);
            const r = await request('space_save', { design, id: savedId }) as { ok: boolean; error?: string; design?: { id: string } };
            setBusy(false);
            if (!r.ok) { setMsg(r.error ?? 'Could not save.'); return; }
            setSavedId(r.design?.id ?? savedId);
            setMsg('Design saved.');
            void load();
          }}
          onRoll={async () => {
            if (preview) {
              const s = launchState(design);
              trail.current = [];
              setFlight(s); setLaunchId('preview'); setView('launch'); setCountdown(5); setPaidNote(null);
              return;
            }
            const locked = design.parts.find((pp) => !isPartUnlocked(pp.partId, nodes));
            if (locked) { setMsg(`${PART_BY_ID.get(locked.partId)?.name ?? locked.partId} needs ${techLabelFor(locked.partId)} research first.`); return; }
            if (hasErrors(stats.issues) || stats.liftoffTwr < MIN_LIFTOFF_TWR) {
              setMsg(stats.issues.find((i) => i.level === 'error')?.text ?? `Liftoff TWR must be at least ${MIN_LIFTOFF_TWR}.`);
              return;
            }
            const flying = missionId ? data.missions.board.find((m) => m.id === missionId) : null;
            if (flying) {
              const why = designMeetsMission(design, flying);
              if (why) { setMsg(why); return; }
            }
            setBusy(true); setMsg(null);
            const r = await request('space_launch', { design, missionId: flying?.id ?? null }) as { ok: boolean; error?: string; launchId?: string; cost?: number; chips?: number };
            setBusy(false);
            if (!r.ok) { setMsg(r.error ?? 'Could not roll out.'); return; }
            const s = launchState(design);
            trail.current = [];
            setFlight(s); setLaunchId(r.launchId ?? null); setView('launch'); setCountdown(5);
            setSciDone(new Set()); setSciResult(null);
            setPaidNote(`Launch charged 🪙 ${r.cost?.toLocaleString('en-US')}.`);
            void load();
          }}
        />
      )}
      {view === 'launch' && (
        <MissionControl
          design={design} flight={flight} setFlight={setFlight}
          guidance={guidance} setGuidance={setGuidance}
          warp={warp} setWarp={setWarp}
          countdown={countdown} setCountdown={setCountdown}
          launchId={launchId} preview={!!preview} freeze={!!preview?.freeze || FROZEN_VIEWS.includes(preview?.view ?? '')}
          science={data.science} sciDone={sciDone} sciResult={sciResult} busy={busy}
          onRunScience={(s, uid, exp, sit, biome) => void runScience(s, uid, exp, sit, biome)}
          onDismissResult={() => setSciResult(null)}
          trail={trail}
          camera={previewCamera(preview?.view)}
          fleet={fleet} feed={data.social.feed}
          mission={missionId ? (data.missions.board.find((m) => m.id === missionId) ?? null) : null}
          onDeployed={async (s) => {
            if (preview || !launchId || launchId === 'preview') return;
            const el = orbitalElements(s.x, s.y, s.vx, s.vy);
            const r = await request('space_deploy', { launchId, peM: el.peAltitude, apM: el.apAltitude, periodS: el.period }) as { ok: boolean; error?: string; payout?: number; prestigeOnly?: boolean; mappers?: Array<{ mapType: MapType }> };
            if (r.ok) {
              const mapNote = r.mappers?.length ? ` Mapping started: ${r.mappers.map((m) => m.mapType).join(', ')}.` : '';
              setPaidNote((r.prestigeOnly ? 'Satellite on station. Prestige only — payout cap reached.' : `Satellite on station. Payout 🪙 ${r.payout?.toLocaleString('en-US')}.`) + mapNote);
              void load();
            } else setMsg(r.error ?? 'Deploy was not recorded.');
          }}
          onClaim={async (s) => {
            if (preview || !launchId || launchId === 'preview' || !missionId) return;
            const el = orbitalElements(s.x, s.y, s.vx, s.vy);
            const mission = data.missions.board.find((m) => m.id === missionId);
            const r = await request('space_mission_complete', {
              launchId, missionId,
              peM: el.peAltitude, apM: el.apAltitude, periodS: el.period,
              altitudeM: altitudeOf(s), eccentricity: el.eccentricity,
              deployed: s.deployed, deployedCount: s.deployedCount ?? (s.deployed ? 1 : 0),
              flightTimeS: s.t - s.met0,
            }) as { ok: boolean; error?: string; payout?: number; want?: number; capped?: boolean; prestigeOnly?: boolean };
            if (!r.ok) { setMsg(r.error ?? 'The contract could not be settled.'); return; }
            if (mission) setCompleteNote({ mission, payout: r.payout ?? 0, want: r.want, capped: r.capped });
            setPaidNote(r.prestigeOnly || (r.payout ?? 0) === 0
              ? (r.capped ? 'Contract fulfilled — daily payout cap reached.' : 'Contract fulfilled.')
              : `Contract fulfilled. Payout 🪙 ${(r.payout ?? 0).toLocaleString('en-US')}.`);
            void load();
          }}
          onBack={() => { setView('vab'); }}
        />
      )}
      {view === 'survey' && (
        <SurveyPanel
          survey={data.survey} signedIn={!!me || !!preview} busy={busy}
          initialType={preview ? PREVIEW_SURVEY[preview.view] : undefined}
          now={preview ? Date.parse('2026-11-13T18:00:00Z') : Date.now()}
          onSync={() => { if (preview) { setMsg('Survey data downloaded (preview).'); return; } void syncSurvey(false); }}
        />
      )}
      {view === 'science' && (
        <SciencePanel
          science={data.science} signedIn={!!me || !!preview} busy={busy}
          initial={preview?.view === 'tech-tree' ? 'tech' : 'archive'}
          onUnlock={async (id) => {
            if (preview) {
              setData((d) => ({ ...d, science: { ...d.science, nodes: [...d.science.nodes, id] } }));
              setMsg('Researched (preview).');
              return;
            }
            setBusy(true);
            const r = await request('space_tech_unlock', { nodeId: id }) as { ok: boolean; error?: string; node?: { name: string } };
            setBusy(false);
            if (!r.ok) { setMsg(r.error ?? 'Could not research that node.'); return; }
            setMsg(`Researched ${r.node?.name ?? id}. New parts are in the VAB.`);
            void load();
          }}
        />
      )}
      {view === 'contracts' && (
        <SpaceContracts
          missions={data.missions}
          signedIn={!!me || !!preview}
          chips={data.chips}
          busy={busy}
          complete={completeNote}
          onDismissComplete={() => setCompleteNote(null)}
          previewSelect={missionId ?? undefined}
          onAccept={async (id) => {
            if (preview) {
              setData((d) => ({
                ...d,
                missions: {
                  ...d.missions,
                  accepted: [...d.missions.accepted.filter((c) => c.missionId !== id), { missionId: id, acceptedAt: Date.now(), completedAt: null, payout: 0 }],
                },
              }));
              setMissionId(id);
              setMsg('Contract accepted (preview).');
              return;
            }
            setBusy(true); setMsg(null);
            const r = await request('space_mission_accept', { missionId: id }) as { ok: boolean; error?: string };
            setBusy(false);
            if (!r.ok) { setMsg(r.error ?? 'Could not accept.'); return; }
            setMissionId(id);
            setMsg('Contract accepted. Roll a vehicle out against it from the VAB.');
            void load();
          }}
          onFly={(m) => {
            setMissionId(m.id);
            setView('vab');
            setMsg(`Flying ${m.title}. Roll out when the vehicle is ready.`);
          }}
        />
      )}
    </div>
  );
}

function Hangar({ me, data, design, onNew, onLoad }: {
  me: string | null; data: ViewData; design: VesselDesign;
  onNew: () => void; onLoad: (d: VesselDesign, id?: string) => void; onClose: () => void;
}) {
  const r = data.rules;
  return (
    <div className="spc-body">
      <div className="spc-hangar">
        <section className="spc-panel">
          <h2>Program brief</h2>
          <div className="spc-brief">
            <p>Design a rocket in the Vehicle Assembly Building, roll it out to the pad, and fly it into a stable orbit above the {PLANET.atmHeight / 1000} km atmosphere. Then deploy a satellite.</p>
            <p>The home world is a Kerbin-like body: radius {PLANET.radius / 1000} km, surface gravity {PLANET.g0} m/s², a 6-hour day. A circular 80 km orbit takes about 2,279 m/s of horizontal speed. Gravity and drag bring the practical budget to <b>{LEO_DV_BUDGET.toLocaleString('en-US')} m/s</b> of vacuum Δv, with a sea-level liftoff TWR of at least {MIN_LIFTOFF_TWR}.</p>
            <p>Parts are paid for when you roll out — Courier I costs 🪙 {designCost(courierI()).toLocaleString('en-US')} at the base index. A successful deploy pays 🪙 {r.payout.toLocaleString('en-US')}, at most {r.maxPaid} times (you have {r.remainingPaid} paid flight{r.remainingPaid === 1 ? '' : 's'} left). After that, satellites still count on the board. That bounty is independent of the <b>Contracts</b> tab: daily missions pay a separate purse (capped per UTC day) and a single flight can collect both.</p>
            <p>Guidance will fly Courier I for you. Or take the stick: <kbd>W</kbd>/<kbd>S</kbd> throttle, <kbd>A</kbd>/<kbd>D</kbd> pitch, <kbd>Space</kbd> to stage, <kbd>.</kbd> to warp.</p>
            {me ? <p>Signed in as <b>{me}</b>{data.chips != null ? ` · 🪙 ${data.chips.toLocaleString('en-US')}` : ''}.</p> : <p>Sign in to pay for a launch and record a satellite. You can still practise in the VAB.</p>}
          </div>
          <div className="spc-foot">
            <button type="button" className="spc-btn primary" onClick={onNew} data-testid="spc-new">New design</button>
            <button type="button" className="spc-btn" onClick={() => onLoad(courierI())} data-testid="spc-load-courier">Load Courier I</button>
            <button type="button" className="spc-btn" onClick={() => onLoad(scoutI())}>Load Scout I</button>
          </div>
        </section>
        <section className="spc-panel">
          <h2>Your designs</h2>
          <div className="spc-list">
            {STOCK_DESIGNS.map((d) => (
              <button key={d.name} type="button" className="spc-card" onClick={() => onLoad(d)} data-testid={`spc-stock-${d.name}`}>
                <b>{d.name}</b>
                <small>Stock · 🪙 {designCost(d).toLocaleString('en-US')} · {Math.round(analyzeDesign(d).totalDvVac)} m/s vac</small>
              </button>
            ))}
            {data.designs.map((d) => (
              <button key={d.id} type="button" className="spc-card" onClick={() => onLoad(d.design, d.id)}>
                <b>{d.name}</b>
                <small>Saved · 🪙 {designCost(d.design).toLocaleString('en-US')}</small>
              </button>
            ))}
            {!data.designs.length && <small style={{ color: '#8aa' }}>No saved designs yet.</small>}
          </div>
          <h2 style={{ marginTop: 16 }}>Your satellites</h2>
          {data.sats.length === 0 && <small style={{ color: '#8aa' }}>None in orbit yet.</small>}
          <table className="spc-board"><tbody>
            {data.sats.map((s) => (
              <tr key={s.id}><td>{s.satName}</td><td>{s.designName}</td><td className="n">{fmtAlt(s.peM)} × {fmtAlt(s.apM)}</td></tr>
            ))}
          </tbody></table>
        </section>
        <section className="spc-panel" data-testid="spc-leaders">
          <Leaders data={data} me={me} />
        </section>
      </div>
    </div>
  );
}

function Leaders({ data, me }: { data: ViewData; me: string | null }) {
  const [tab, setTab] = useState<'sats' | 'science' | 'survey'>('sats');
  const L = data.social.leaders;
  const sats = L.sats.length ? L.sats : data.board;
  const rows: Array<{ name: string; v: string }> = tab === 'sats' ? sats.map((b) => ({ name: b.name, v: String(b.sats) }))
    : tab === 'science' ? L.science.map((b) => ({ name: b.name, v: b.points.toLocaleString('en-US') }))
    : L.survey.map((b) => ({ name: b.name, v: `${b.pct.toFixed(1)}%` }));
  const isMe = (n: string) => !!me && n.toLowerCase() === me.toLowerCase();
  return (
    <>
      <h2>Leaderboard</h2>
      <div className="spc-seg" role="tablist">
        {([['sats', 'Satellites'], ['science', 'Science'], ['survey', 'Map coverage']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-testid={`spc-leaders-${k}`}>{label}</button>
        ))}
      </div>
      <table className="spc-board">
        <thead><tr><th>#</th><th>Pilot</th><th className="n">{tab === 'sats' ? 'Sats' : tab === 'science' ? 'Points' : 'Mapped'}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={r.name} className={isMe(r.name) ? 'me' : ''}><td className="rk">{i + 1}</td><td>{r.name}</td><td className="n">{r.v}</td></tr>)}
          {!rows.length && <tr><td colSpan={3} className="none">{tab === 'sats' ? 'No satellites on station yet.' : tab === 'science' ? 'No science returned yet.' : 'No maps started yet.'}</td></tr>}
        </tbody>
      </table>
      <h2 style={{ marginTop: 16 }}>Recent launches</h2>
      <div className="spc-feed">
        {data.social.feed.slice(0, 8).map((f) => (
          <div key={f.id} className={'row' + (f.deployed ? ' ok' : '')}>
            <b>{f.ownerName}</b>
            <span className="what">{f.designName}{f.missionTitle ? ` · ${f.missionTitle}` : ''}</span>
            <span className="when">{f.deployed ? '🛰 ' : ''}{ago(f.at, data.social.at || Date.now())}</span>
          </div>
        ))}
        {!data.social.feed.length && <div className="none">No launches yet.</div>}
      </div>
    </>
  );
}

/** How many copies a radial part gets by default when added (symmetry). */
function radialSymmetry(def: PartDef): number[] {
  if (def.aero === 'fin' || def.id === 'leg-lt3') return [0, 90, 180, 270];
  if (def.id === 'ant-whip' || def.id === 'dish-ra80' || def.id === 'lamp-1') return [0];
  return [0, 180];
}

const fmtSize = (m: number) => (m === 0.625 ? '0.625 m' : `${m} m`);

/** One-line stats for the catalog list. */
function partBlurb(p: PartDef): string {
  const bits: string[] = [];
  if (p.category === 'engine' || p.category === 'srb') {
    bits.push(p.thrustVac! >= 1e6 ? `${(p.thrustVac! / 1e6).toFixed(2)} MN` : `${(p.thrustVac! / 1000).toFixed(p.thrustVac! < 10_000 ? 1 : 0)} kN`);
    bits.push(`${p.ispAsl}/${p.ispVac} s`);
    if (p.category === 'srb') bits.push(`${fmtMass(p.fuelMass)} solid`);
  } else if (p.fuelMass > 0) {
    bits.push(`${fmtMass(p.fuelMass)} ${p.fuelKind === 'liquid' ? 'fuel' : p.fuelKind}`);
    bits.push(`${fmtMass(p.dryMass)} dry`);
  } else {
    bits.push(fmtMass(p.dryMass));
    if (p.mounts) bits.push(`${p.mounts}× cluster`);
    if (p.commRangeKm) bits.push(`${p.commRangeKm.toLocaleString('en-US')} km`);
    if (p.power) bits.push('power');
  }
  return bits.join(' · ');
}

function PartCatalog({ nodes, onAdd }: { nodes: string[]; onAdd: (p: PartDef) => void }) {
  const [group, setGroup] = useState(PART_GROUPS[0]!.id);
  const [query, setQuery] = useState('');
  const [size, setSize] = useState<number | null>(null);
  const q = query.trim().toLowerCase();
  const g = PART_GROUPS.find((x) => x.id === group) ?? PART_GROUPS[0]!;
  const list = SPACE_PARTS.filter((p) => {
    if (q) {
      const hay = `${p.name} ${p.short} ${p.description} ${p.id}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    } else if (!g.categories.includes(p.category)) return false;
    if (size != null && !sizeClassesOf(p).includes(size)) return false;
    return true;
  });
  const cats = PART_CATEGORIES.filter((c) => list.some((p) => p.category === c.id));
  return (
    <aside className="spc-col spc-cat" data-testid="spc-catalog">
      <div className="spc-cat-head">
        <div className="spc-cat-tabs" role="tablist" aria-label="Part categories">
          {PART_GROUPS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={!q && x.id === group} className={!q && x.id === group ? 'on' : ''}
              onClick={() => { setGroup(x.id); setQuery(''); }} data-testid={`spc-cat-tab-${x.id}`}>
              {x.label}<small>{SPACE_PARTS.filter((p) => x.categories.includes(p.category)).length}</small>
            </button>
          ))}
        </div>
        <div className="spc-cat-tools">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search parts…" aria-label="Search parts" data-testid="spc-cat-search" />
          <div className="spc-sizes" role="group" aria-label="Diameter">
            <button type="button" className={size == null ? 'on' : ''} onClick={() => setSize(null)}>All</button>
            {PART_SIZES.map((m) => <button key={m} type="button" className={size === m ? 'on' : ''} onClick={() => setSize(size === m ? null : m)} data-testid={`spc-size-${m}`}>{m}</button>)}
          </div>
        </div>
      </div>
      <div className="spc-cat-list">
        {cats.map((c) => (
          <div key={c.id} className="spc-cat-g">
            <h3>{c.label}</h3>
            {list.filter((p) => p.category === c.id).map((p) => {
              const locked = !isPartUnlocked(p.id, nodes);
              const sizes = sizeClassesOf(p);
              return (
                <button key={p.id} type="button" className={'spc-part' + (locked ? ' locked' : '')} onClick={() => { if (!locked) onAdd(p); }} aria-disabled={locked} data-testid={`spc-part-${p.id}`} title={locked ? `Research ${techLabelFor(p.id)} to unlock. ${p.description}` : p.description}>
                  <span className="spc-sw" style={{ background: p.accent ?? p.color }} />
                  <span className="txt"><b>{p.short}{sizes.length ? <i className="sz">{sizes.map(fmtSize).join('→')}</i> : p.radial ? <i className="sz">radial</i> : null}</b><small>{locked ? `🔒 ${techLabelFor(p.id)}` : partBlurb(p)}</small></span>
                  <span className="c">🪙 {p.cost.toLocaleString('en-US')}</span>
                </button>
              );
            })}
          </div>
        ))}
        {!list.length && <p className="spc-fine" style={{ padding: 10 }}>No parts match.</p>}
      </div>
    </aside>
  );
}

function Vab({ design, setDesign, selected, setSelected, stats, chips, busy, nodes, onSave, onRoll }: {
  design: VesselDesign; setDesign: (d: VesselDesign) => void;
  selected: string | null; setSelected: (id: string | null) => void;
  stats: DesignStats; chips: number | null; busy: boolean; nodes: string[];
  onSave: () => void; onRoll: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxes = useRef<PartBox[]>([]);
  const [name, setName] = useState(design.name);
  useEffect(() => setName(design.name), [design.name]);

  const redraw = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.floor(r.width * dpr));
    c.height = Math.max(1, Math.floor(r.height * dpr));
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    boxes.current = drawVab(ctx, design, { selected, w: r.width, h: r.height });
  }, [design, selected]);
  useEffect(() => { redraw(); const on = () => redraw(); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, [redraw]);

  const add = (def: PartDef, radial = !!def.radial) => {
    const uid = newPartUid();
    const stage = defaultStageFor(def.category, design);
    const parent = (selected && design.parts.find((p) => p.uid === selected && !p.radial)?.uid)
      ?? [...design.parts].reverse().find((p) => !p.radial)?.uid;
    if (radial && def.radial) {
      // Symmetry by default: boosters and arrays in pairs, fins and legs in fours.
      const extras: PlacedPart[] = radialSymmetry(def).map((angle, i) => ({
        uid: i === 0 ? uid : newPartUid(), partId: def.id, stage, radial: true, angle, attachTo: parent,
      }));
      setDesign({ ...design, parts: [...design.parts, ...extras] });
      setSelected(extras[0]!.uid);
    } else {
      const p: PlacedPart = { uid, partId: def.id, stage, radial: radial && !!def.radial, attachTo: radial ? parent : undefined, angle: radial ? 0 : undefined };
      setDesign({ ...design, parts: [...design.parts, p] });
      setSelected(uid);
    }
  };
  const sel = design.parts.find((p) => p.uid === selected);
  const selDef = sel ? PART_BY_ID.get(sel.partId) : undefined;
  const update = (fn: (p: PlacedPart) => PlacedPart) => {
    if (!sel) return;
    setDesign({ ...design, parts: design.parts.map((p) => p.uid === sel.uid ? fn(p) : p) });
  };
  const remove = () => {
    if (!sel) return;
    setDesign({ ...design, parts: design.parts.filter((p) => p.uid !== sel.uid && p.attachTo !== sel.uid) });
    setSelected(null);
  };

  return (
    <div className="spc-body">
      <div className="spc-vab" data-testid="spc-vab">
        <PartCatalog nodes={nodes} onAdd={(p) => add(p)} />
        <div className="spc-bay">
          <canvas
            ref={canvasRef}
            data-testid="spc-vab-canvas"
            onClick={(e) => {
              const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
              const hit = hitVab(boxes.current, e.clientX - r.left, e.clientY - r.top);
              setSelected(hit?.uid ?? null);
            }}
          />
        </div>
        <aside className="spc-col spc-stats">
          <h2>Vehicle</h2>
          <input className="spc-name" value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setDesign({ ...design, name: e.target.value }); }} aria-label="Design name" data-testid="spc-name" />
          <div className="spc-read" data-testid="spc-stats">
            <div className="row"><span>Cost</span><b>🪙 {stats.cost.toLocaleString('en-US')}</b></div>
            <div className="row"><span>Wet mass</span><b>{fmtMass(stats.wetMass)}</b></div>
            <div className="row"><span>Dry mass</span><b>{fmtMass(stats.dryMass)}</b></div>
            <div className="row"><span>Vac Δv</span><b>{fmtDv(stats.totalDvVac)}</b></div>
            <div className="row"><span>ASL Δv</span><b>{fmtDv(stats.totalDvAsl)}</b></div>
            <div className="row"><span>Liftoff TWR</span><b>{stats.liftoffTwr.toFixed(2)}</b></div>
            <div className="row"><span>LEO budget</span><b>{fmtDv(LEO_DV_BUDGET)}</b></div>
          </div>
          {stats.capable ? <div className="spc-ok">Orbit-capable. Vacuum Δv and liftoff TWR clear the {LEO_DV_BUDGET} m/s / {MIN_LIFTOFF_TWR} bar.</div>
            : <div className="spc-warn">{stats.warnings[0] ?? 'Not yet capable of a stable orbit.'}</div>}
          {stats.issues.filter((i) => i.level === 'error').map((i) => <div key={i.text} className="spc-err">{i.text}</div>)}
          <table className="spc-stages" data-testid="spc-stages">
            <thead><tr><th>Stg</th><th>Vac Δv</th><th>ASL Δv</th><th>TWR</th><th>Burn</th></tr></thead>
            <tbody>
              {stats.stages.map((st) => (
                <tr key={st.stage}>
                  <td>{st.stage} {st.engines.join(', ')}</td>
                  <td>{Math.round(st.dvVac)}</td>
                  <td>{Math.round(st.dvAsl)}</td>
                  <td>{st.twrAsl.toFixed(2)}</td>
                  <td>{st.burnTime.toFixed(0)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sel && selDef && (
            <div className="spc-sel">
              <b>{selDef.name}</b>
              <div>Stage {sel.stage}{sel.radial ? ' · radial' : ''}{(clusterCounts(design).get(sel.uid) ?? 1) > 1 ? ` · cluster ×${clusterCounts(design).get(sel.uid)}` : ''}</div>
              {selDef.category === 'srb' && (
                <label className="spc-limit">
                  Thrust limiter <b>{Math.round((sel.limit ?? 1) * 100)}%</b>
                  <input type="range" min={LIMIT_MIN * 100} max={100} step={5} value={Math.round((sel.limit ?? 1) * 100)} data-testid="spc-limit"
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100;
                      // Apply to the whole symmetry group (same part, stage and parent).
                      setDesign({ ...design, parts: design.parts.map((p) => (p.partId === sel.partId && p.stage === sel.stage && p.attachTo === sel.attachTo ? { ...p, limit: v >= 1 ? undefined : v } : p)) });
                    }} />
                </label>
              )}
              <div className="ops">
                <button type="button" className="spc-btn" onClick={() => update((p) => ({ ...p, stage: Math.min(15, p.stage + 1) }))}>Stage +</button>
                <button type="button" className="spc-btn" onClick={() => update((p) => ({ ...p, stage: Math.max(0, p.stage - 1) }))}>Stage −</button>
                <button type="button" className="spc-btn danger" onClick={remove}>Remove</button>
              </div>
            </div>
          )}
          <div className="spc-foot">
            <button type="button" className="spc-btn" onClick={() => { setDesign(cloneDesign(courierI())); setSelected(null); }}>Courier I</button>
            <button type="button" className="spc-btn" disabled={busy} onClick={onSave} data-testid="spc-save">Save</button>
            <button type="button" className="spc-btn primary" disabled={busy} onClick={onRoll} data-testid="spc-rollout">Roll out to pad</button>
          </div>
          {chips != null && <div className="spc-read"><div className="row"><span>Your chips</span><b>🪙 {chips.toLocaleString('en-US')}</b></div></div>}
        </aside>
        {/* Phones: actions stay pinned to the bottom while the stack, stats and catalog scroll. */}
        <div className="spc-vab-bar" data-testid="spc-vab-bar">
          <div className="sum">
            <b>🪙 {stats.cost.toLocaleString('en-US')}</b>
            <small className={stats.capable ? 'ok' : 'warn'}>{fmtDv(stats.totalDvVac)} · TWR {stats.liftoffTwr.toFixed(2)}</small>
          </div>
          <button type="button" className="spc-btn" disabled={busy} onClick={onSave}>Save</button>
          <button type="button" className="spc-btn primary" disabled={busy} onClick={onRoll} data-testid="spc-rollout-bar">Roll out</button>
        </div>
      </div>
    </div>
  );
}

function MissionControl({ design, flight, setFlight, guidance, setGuidance, warp, setWarp, countdown, setCountdown, launchId, preview, freeze, trail, onDeployed, onBack, camera, fleet, feed, mission, onClaim, science, sciDone, sciResult, busy, onRunScience, onDismissResult }: {
  science: ScienceViewData; sciDone: Set<string>; sciResult: ScienceResult | null; busy: boolean;
  onRunScience: (s: FlightState, partUid: string, exp: ExperimentDef, situation: Situation, biome: string) => void;
  onDismissResult: () => void;
  design: VesselDesign;
  flight: FlightState | null;
  setFlight: (s: FlightState | null | ((p: FlightState | null) => FlightState | null)) => void;
  guidance: boolean; setGuidance: (v: boolean) => void;
  warp: number; setWarp: (n: number) => void;
  countdown: number | null; setCountdown: (n: number | null) => void;
  launchId: string | null; preview: boolean; freeze: boolean;
  trail: { current: Array<[number, number]> };
  onDeployed: (s: FlightState) => void;
  onBack: () => void;
  camera?: McCamera;
  fleet?: FleetMarker[];
  feed?: SocialView['feed'];
  mission?: MissionDef | null;
  onClaim?: (s: FlightState) => void;
}) {
  const visRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const flame = useRef(1);
  const deployedOnce = useRef(false);
  const stateRef = useRef<FlightState | null>(flight);
  stateRef.current = flight;

  // Countdown
  useEffect(() => {
    if (countdown == null || freeze) return;
    if (countdown <= 0) {
      setCountdown(null);
      setFlight((s) => {
        const f = s ?? launchState(design);
        if (f.phase === 'pad' || f.phase === 'countdown') {
          f.phase = 'ascent'; f.throttle = 1; f.met0 = f.t;
          activateStage(f);
        }
        return { ...f, log: [...f.log] };
      });
      return;
    }
    const t = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, freeze, design, setCountdown, setFlight]);

  // Sim loop
  useEffect(() => {
    if (freeze) return;
    let raf = 0;
    let acc = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const raw = Math.min(0.08, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      if (!s || s.crashed || countdown != null) return;
      if (s.phase === 'pad') return;
      acc += raw * (s.phase === 'coast' || s.throttle === 0 ? warp : Math.min(warp, 4));
      const dt = 0.05;
      let dirty = false;
      while (acc >= dt) {
        acc -= dt;
        if (guidance && !s.aborted) {
          const g = computeGuidance(s);
          if (g.jettisonFairing) for (const p of s.parts) if (p.attached && p.def.category === 'fairing') p.attached = false;
          if (g.stage) activateStage(s);
          s.throttle = g.throttle;
          s.pitch = g.pitch;
          if (g.phase) s.phase = g.phase;
          if (g.deploy) tryDeploy(s);
        } else if (shouldAutoStage(s) && s.throttle > 0) {
          // don't auto-stage in manual except flameout cue — left to the player
        }
        stepFlight(s, dt);
        trail.current.push([s.x, s.y]);
        if (trail.current.length > 800) trail.current.splice(0, trail.current.length - 800);
        dirty = true;
        if (s.deployed && !deployedOnce.current) { deployedOnce.current = true; onDeployed(s); }
        if (s.crashed) break;
      }
      flame.current = 0.7 + Math.sin(now / 70) * 0.3;
      if (dirty) setFlight({ ...s, log: [...s.log], parts: s.parts });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [freeze, guidance, warp, countdown, onDeployed, setFlight, trail]);

  const paint = useCallback(() => {
    const s = stateRef.current; if (!s) return;
    const vis = visRef.current, map = mapRef.current;
    const paintOne = (c: HTMLCanvasElement | null, fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
      if (!c) return;
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.floor(r.width * dpr)), H = Math.max(1, Math.floor(r.height * dpr));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const ctx = c.getContext('2d'); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fn(ctx, r.width, r.height);
    };
    const wallT = Date.now() / 1000;
    paintOne(vis, (ctx, w, h) => drawMission(ctx, s, { w, h, trail: trail.current, tFlame: flame.current, camera, wallT, fleet }));
    paintOne(map, (ctx, w, h) => drawOrbitMap(ctx, s, { w, h, trail: trail.current, wallT, fleet }));
  }, [trail, camera, fleet]);

  useEffect(() => { paint(); }, [flight, paint]);
  useEffect(() => {
    if (!freeze) return;
    // Still animate flame / redraw in frozen preview.
    let raf = 0;
    const t = (n: number) => { flame.current = 0.7 + Math.sin(n / 70) * 0.3; paint(); raf = requestAnimationFrame(t); };
    raf = requestAnimationFrame(t);
    return () => cancelAnimationFrame(raf);
  }, [freeze, paint]);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [flight?.log.length]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (freeze) return;
      const s = stateRef.current; if (!s) return;
      if (e.code === 'Space') { e.preventDefault(); activateStage(s); setFlight({ ...s, log: [...s.log] }); }
      if (e.key === 'w' || e.key === 'W' || e.key === 'Shift') { s.throttle = Math.min(1, s.throttle + 0.1); setGuidance(false); setFlight({ ...s }); }
      if (e.key === 's' || e.key === 'S' || e.key === 'Control') { s.throttle = Math.max(0, s.throttle - 0.1); setGuidance(false); setFlight({ ...s }); }
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') { s.pitch = Math.max(-10, s.pitch - 3); setGuidance(false); setFlight({ ...s }); }
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') { s.pitch = Math.min(110, s.pitch + 3); setGuidance(false); setFlight({ ...s }); }
      if (e.key === 'g' || e.key === 'G') setGuidance(!guidance);
      if (e.key === '.') setWarp(Math.min(50, warp * 2 === warp ? 2 : Math.min(50, warp * 2) || 2));
      if (e.key === ',') setWarp(Math.max(1, warp / 2));
      if (e.key === 'x' || e.key === 'X') { abortFlight(s); setFlight({ ...s, log: [...s.log] }); }
      if (e.key === 't' || e.key === 'T') { if (tryDeploy(s)) { setFlight({ ...s, log: [...s.log] }); if (!deployedOnce.current) { deployedOnce.current = true; onDeployed(s); } } }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [freeze, guidance, warp, setGuidance, setWarp, setFlight, onDeployed]);

  const s = flight;
  const goPad = () => {
    const f = launchState(design);
    trail.current = [];
    deployedOnce.current = false;
    setFlight(f);
    setCountdown(5);
  };

  if (!s) {
    return (
      <div className="spc-body" style={{ placeItems: 'center', display: 'grid', width: '100%' }}>
        <div className="spc-panel" style={{ maxWidth: 420 }}>
          <h2>Mission Control</h2>
          <p className="spc-brief">Roll a rocket out of the VAB to the pad, then start the countdown.</p>
          <div className="spc-foot">
            <button type="button" className="spc-btn" onClick={onBack}>Back to VAB</button>
            <button type="button" className="spc-btn primary" onClick={goPad} data-testid="spc-start-countdown">Go to pad</button>
          </div>
        </div>
      </div>
    );
  }

  const el = orbitalElements(s.x, s.y, s.vx, s.vy);
  const a = liveDv(s);
  const fuel = s.parts.filter((p) => p.attached).reduce((n, p) => n + p.fuel, 0);
  const fuelMax = s.parts.filter((p) => p.attached).reduce((n, p) => n + p.def.fuelMass, 0) || 1;
  const met = s.phase === 'pad' || countdown != null ? (countdown != null ? `T−${countdown}` : 'T−0') : fmtMet(s.t - s.met0);

  const nudge = (fn: (f: FlightState) => void) => {
    setGuidance(false);
    fn(s);
    setFlight({ ...s, log: [...s.log] });
  };

  return (
    <div className="spc-body">
      <div className="spc-mc" data-testid="spc-mc">
        <aside className="spc-tele" data-testid="spc-telemetry">
          <div className="meter"><label>Altitude</label><b>{fmtAlt(el.altitude)}</b></div>
          <div className="meter"><label>Inertial vel</label><b>{fmtVel(inertialSpeed(s))}</b></div>
          <div className="meter"><label>Surface vel</label><b>{fmtVel(surfaceSpeed(s))}</b></div>
          <div className="meter amber"><label>Apoapsis</label><b>{fmtAlt(el.apAltitude)}</b></div>
          <div className="meter amber"><label>Periapsis</label><b>{fmtAlt(el.peAltitude)}</b></div>
          <div className="meter"><label>Stage Δv (vac)</label><b>{fmtDv(a.vac)}</b></div>
          <div className="meter"><label>TWR</label><b>{a.twr.toFixed(2)}</b></div>
          <div className="meter"><label>Fuel</label><b>{fmtMass(fuel)} ({Math.round(100 * fuel / fuelMax)}%)</b></div>
          <div className="meter"><label>Throttle</label><b>{Math.round(s.throttle * 100)}%</b></div>
          <div className="meter"><label>Pitch</label><b>{s.pitch.toFixed(0)}°</b></div>
        </aside>
        <div className="spc-vis">
          <canvas ref={visRef} data-testid="spc-vis" />
          <div className="spc-banner">
            <div>
              <div className="met" data-testid="spc-met">{met}</div>
              <div>{s.designName}</div>
            </div>
            <div className="phase">{s.deployed ? 'SATELLITE DEPLOYED' : s.crashed ? 'LOST' : s.phase}</div>
          </div>
          {countdown != null && countdown > 0 && <div className="spc-count" data-testid="spc-countdown">{countdown}</div>}
          {sciResult && <ResultCard r={sciResult} onClose={onDismissResult} />}
        </div>
        <aside className="spc-side">
          <h2>Orbit map</h2>
          <canvas ref={mapRef} data-testid="spc-map" style={{ width: '100%', height: 180, background: '#071016' }} />
          {countdown == null && !s.crashed && (
            <ExperimentsPanel flight={s} science={science} done={sciDone} busy={busy}
              onRun={(uid, exp, sit, biome) => onRunScience(s, uid, exp, sit, biome)} />
          )}
          <h2>Flight log · CAPCOM</h2>
          <div className="spc-log" ref={logRef} data-testid="spc-log">
            {s.log.map((e, i) => (
              <div key={i} className={e.capcom ? 'cap' : ''}><span className="t">{fmtMet(e.t)}</span>{e.capcom ? 'CAPCOM: ' : ''}{e.text}</div>
            ))}
            {!s.log.length && <div className="cap">CAPCOM: We are go for countdown.</div>}
          </div>
          <h2>Recent launches</h2>
          <div className="spc-feed" data-testid="spc-feed">
            {(feed ?? []).slice(0, 6).map((f) => (
              <div key={f.id} className={'row' + (f.deployed ? ' ok' : '')}>
                <b>{f.ownerName}</b>
                <span className="what">{f.designName}{f.missionTitle ? ` · ${f.missionTitle}` : ''}</span>
                <span className="when">{f.deployed ? '🛰 ' : ''}{ago(f.at, preview ? Date.parse('2026-11-13T18:00:00Z') : Date.now())}</span>
              </div>
            ))}
            {!(feed ?? []).length && <div className="none">No launches yet today.</div>}
          </div>
        </aside>
        <div className="spc-console">
          <label>Throttle
            <input type="range" min={0} max={100} value={Math.round(s.throttle * 100)}
              onChange={(e) => nudge((f) => { f.throttle = Number(e.target.value) / 100; })} />
          </label>
          <label>Pitch
            <input type="range" min={-10} max={110} value={Math.round(s.pitch)}
              onChange={(e) => nudge((f) => { f.pitch = Number(e.target.value); })} />
          </label>
          <button type="button" className="spc-btn big primary" onClick={() => { activateStage(s); setFlight({ ...s, log: [...s.log] }); }} data-testid="spc-stage">Stage</button>
          <button type="button" className="spc-btn big" onClick={() => { if (tryDeploy(s)) { setFlight({ ...s, log: [...s.log] }); if (!deployedOnce.current && s.deployed) { deployedOnce.current = true; onDeployed(s); } } }} disabled={!(el.bound && el.peAltitude > PLANET.atmHeight) || (s.deployedCount ?? (s.deployed ? 1 : 0)) >= s.parts.filter((p) => p.attached && p.def.category === 'payload').length} data-testid="spc-deploy">Deploy</button>
          {mission && onClaim && criteriaOnly(mission, { peM: el.peAltitude, apM: el.apAltitude, altitudeM: altitudeOf(s), eccentricity: el.eccentricity, deployed: s.deployed, deployedCount: s.deployedCount ?? (s.deployed ? 1 : 0), flightTimeS: s.t - s.met0 }) && (
            <button type="button" className="spc-btn big primary" onClick={() => onClaim(s)} data-testid="spc-claim">Claim 🪙 {mission.payout.toLocaleString('en-US')}</button>
          )}
          <button type="button" className={'spc-btn' + (guidance ? ' primary' : '')} onClick={() => setGuidance(!guidance)} data-testid="spc-guidance">Guidance {guidance ? 'ON' : 'OFF'}</button>
          <label>Warp
            <select value={warp} onChange={(e) => setWarp(Number(e.target.value))} style={{ background: '#162028', color: '#cde', border: '1px solid #3a5060', padding: '4px 6px' }}>
              {[1, 2, 4, 10, 50].map((n) => <option key={n} value={n}>{n}×</option>)}
            </select>
          </label>
          <button type="button" className="spc-btn danger" onClick={() => { abortFlight(s); setFlight({ ...s, log: [...s.log] }); }}>Abort</button>
          <button type="button" className="spc-btn" onClick={onBack}>VAB</button>
          {(s.crashed || s.aborted || s.deployed) && preview && <button type="button" className="spc-btn primary" onClick={goPad}>Reset</button>}
          <span className="spc-help">W/S throttle · A/D pitch · Space stage · G guidance · T deploy</span>
        </div>
      </div>
    </div>
  );
}

export default SpaceProgram;
