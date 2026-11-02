import { backdropDismiss } from '@/lib/backdrop';
import { Suspense, useEffect, useRef, useState } from 'react';
import { RESORT_SPOTS } from '../../../shared/resort';
import { MINE_CAVE_EVENT } from '../../../shared/mines';
import { propertyById as baseProperty, type OwnedProperty } from '../../../shared/realEstate';
import { indexed } from '../../../shared/priceIndex';
import type { Resort } from '@/lib/resort3d';
import { useAccount } from '@/lib/auth';
import { importWithReload } from '@/lib/chunkReload';
import { socket } from '@/lib/net';
import { flyHome } from '@/lib/travel';
import { DeedPanel } from './WorldMap';
import { FarmGame } from './FarmGame';
import { FishPanPanel as KitchenPanel } from './FishPanPanel';
import { CookingHost } from './CookingPanels';

const chips = (n: number) => n.toLocaleString('en-US');
let IDX = 1;
const RESORT_GAMES = [
  { tab: 'slots-tab', label: '🌴 Resort slots · Tiki Lagoon · Yacht Club · Pearl Diver' },
  { tab: 'blackjack-tab', label: '🂡 Blackjack (ivory & gold tables)' }, { tab: 'roulette-tab', label: '🎡 Roulette (lagoon felt)' },
];
function openTab(testId: string) { const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`); if (el && el.getAttribute('aria-expanded') !== 'true') el.click(); return !!el; }

/** Chud Resort: a separate beachfront map. Everything here is gated on the server by the player's location. */
export function ResortMap() {
  const me = useAccount(); const canvasRef = useRef<HTMLCanvasElement>(null); const worldRef = useRef<Resort | null>(null);
  const [loading, setLoading] = useState(true); const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [owned, setOwned] = useState<Map<string, OwnedProperty>>(new Map()); const ownedRef = useRef(owned); ownedRef.current = owned;
  const meRef = useRef(me); meRef.current = me;
  const [kitchen, setKitchen] = useState<string | null>(null);
  const [deed, setDeed] = useState<string | null>(null); const [farm, setFarm] = useState<string | null>(null);
  const [casino, setCasino] = useState(false); const [floor, setFloor] = useState<string | null>(null); const [air, setAir] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [list, setList] = useState(false);

  useEffect(() => {
    let dead = false;
    void importWithReload(() => import('@/lib/resort3d')).then(({ createResort }) => {
      if (dead || !canvasRef.current) return;
      worldRef.current = createResort(canvasRef.current, {
        onHover: (id, x, y) => setTip(id ? { id, x, y } : null),
        onPick: (id) => go(id),
        onProperty: (id) => { const o = ownedRef.current.get(id); const m = meRef.current; if (id.startsWith('rf:') && o && m && o.owner.toLowerCase() === m.toLowerCase()) { setDeed(null); setFarm(id); } else { setFarm(null); setDeed(id); } },
      });
      setLoading(false);
    });
    return () => { dead = true; worldRef.current?.dispose(); worldRef.current = null; };
  }, []);
  useEffect(() => {
    let dead = false;
    const load = () => { void fetch('/api/real-estate').then((r) => r.json()).then((d: { owned?: OwnedProperty[]; index?: number }) => { if (typeof d.index === 'number' && d.index > 0) IDX = d.index; if (dead) return; const m = new Map((d.owned ?? []).map((o) => [o.id, o])); setOwned(m); worldRef.current?.setOwned([...m.keys()]); }).catch(() => {}); };
    const loadFarm = () => { void fetch('/api/farm').then((r) => r.json()).then((d: { tiles?: Array<[string, number, string, string]> }) => { if (!dead && Array.isArray(d?.tiles)) worldRef.current?.setFarm(d.tiles); }).catch(() => {}); };
    load(); loadFarm(); socket.on('re_changed', load); socket.on('farm_changed', loadFarm); const t = window.setInterval(loadFarm, 60_000);
    return () => { dead = true; socket.off('re_changed', load); socket.off('farm_changed', loadFarm); window.clearInterval(t); };
  }, [loading]);
  useEffect(() => { worldRef.current?.setRunning(!casino && !floor); }, [casino, floor]);

  function go(id: string) {
    switch (id) {
      case 'r-casino': setCasino(true); break;
      case 'r-airstrip': setAir(true); break;
      case 'r-mine': window.dispatchEvent(new CustomEvent(MINE_CAVE_EVENT, { detail: 'coral' })); break;
      case 'r-farm': setList(true); break;
    }
  }
  const home = async () => { setMsg(null); const r = await flyHome(); if (!r.ok) setMsg(r.error ?? 'Could not fly.'); };
  const spot = tip && RESORT_SPOTS.find((s) => s.id === tip.id);
  const tipProp = tip && !spot ? baseProperty(tip.id) : undefined; const tipOwner = tipProp ? owned.get(tipProp.id)?.owner : undefined;
  const mine = me ? [...owned.values()].filter((o) => o.owner.toLowerCase() === me.toLowerCase() && o.id.startsWith('r')) : [];
  return (
    <div className="world resort" data-testid="resort-map">
      <canvas ref={canvasRef} className="world-canvas" data-testid="resort-canvas" />
      <CookingHost />
      <div className="world-title"><span>CHUD</span> RESORT<small>beachfront · tap a spot</small></div>
      {loading && <div className="world-loading">Landing at Chud Resort…</div>}
      {spot && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#' + spot.color.toString(16).padStart(6, '0') }} data-testid="world-tip"><b>{spot.icon} {spot.label}</b><span>{spot.blurb}</span><em>Click to enter</em></div>}
      {tipProp && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#d8b25a' }} data-testid="world-tip"><b>{tipProp.label}</b><span>{tipOwner ? `Owned by ${tipOwner}` : `For sale · 🪙 ${chips(indexed(tipProp.price, IDX))}`}</span><em>Click for the deed</em></div>}
      <div className="world-corner">
        <button type="button" onClick={() => { setDeed(null); setFarm(null); setList(!list); }} data-testid="resort-deeds-btn">🏝 Resort real estate</button>
        <button type="button" onClick={() => void home()} data-testid="resort-fly-home">✈️ Fly home (free)</button>
      </div>
      {kitchen && <Suspense fallback={<div className="world-loading">Opening the kitchen…</div>}><KitchenPanel me={me} home={kitchen} onClose={() => setKitchen(null)} /></Suspense>}
      {deed && <DeedPanel id={deed} owned={owned} me={me} onKitchen={() => { setKitchen(baseProperty(deed)?.label ?? deed); setDeed(null); }} onClose={() => setDeed(null)} onFarm={() => { setFarm(deed); setDeed(null); }} />}
      {farm && <FarmGame id={farm} label={baseProperty(farm)?.label ?? 'Plantation'} onClose={() => setFarm(null)} />}
      {list && !deed && (
        <div className="world-deed world-deeds" data-testid="resort-deeds">
          <button type="button" className="world-deed-x" onClick={() => setList(false)} aria-label="Close">✕</button>
          <h3>🏝 Chud Resort real estate</h3>
          <small>Premium beachfront. Same rules as the city: 0.5%/day tax, sell back for 70%, repossessed after 3 unpaid days.</small>
          <h4>My resort properties</h4>
          {mine.length ? mine.map((o) => <button type="button" key={o.id} onClick={() => setDeed(o.id)}>{baseProperty(o.id)?.label ?? o.id}</button>) : <small>None yet.</small>}
          {(['Beach house', 'Beachfront hotel', 'Oceanview condo', 'Hillside villa', 'Plantation'] as const).map((k) => <div key={k}><h4>{k}s</h4>
            {[...Array(30).keys()].flatMap((i) => [baseProperty(`r:${k === 'Beach house' ? 'beachhouse' : k === 'Beachfront hotel' ? 'hotel' : k === 'Oceanview condo' ? 'condo' : 'villa'}:${i}`), k === 'Plantation' ? baseProperty(`rf:${i}`) : undefined])
              .filter((p) => p && (k === 'Plantation' ? p.id.startsWith('rf:') : p.id.startsWith('r:'))).map((p) => <button type="button" key={p!.id} onClick={() => setDeed(p!.id)} data-testid={`deed-${p!.id}`}>{p!.label}<span>{owned.get(p!.id) ? owned.get(p!.id)!.owner : `🪙 ${chips(indexed(p!.price, IDX))}`}</span></button>)}
          </div>)}
        </div>
      )}
      {air && (
        <div className="world-deed world-venue" data-testid="venue-resort-airfield">
          <button type="button" className="world-deed-x" onClick={() => setAir(false)} aria-label="Close">✕</button>
          <h3>✈️ Chud Resort Airfield</h3>
          <small>Your ticket included the flight home.</small>
          <button type="button" onClick={() => void home()} data-testid="resort-fly-home-2">🛫 Fly home to Chud Hub</button>
          {msg && <small>{msg}</small>}
        </div>
      )}
      {floor && !casino && (
        // Playing a resort game: the table/slot panel opens over the casino interior instead of the beach map.
        <div className="resort-floor" data-testid="resort-floor">
          <div className="resort-floor-bar"><b>🌴 Palms Resort Casino</b><span>{floor}</span>
            <button type="button" onClick={() => setCasino(true)} data-testid="resort-floor-games">Games</button>
            <button type="button" onClick={() => setFloor(null)} data-testid="resort-floor-leave">Back to the beach</button></div>
        </div>
      )}
      {casino && (
        <div className="world-casino resort-casino" {...backdropDismiss(() => setCasino(false))} data-testid="resort-casino">
          <div><h3>🌴 Palms Resort Casino</h3>
            {RESORT_GAMES.map((g) => <button key={g.tab} type="button" onClick={() => { setCasino(false); setFloor(g.label); openTab(g.tab); }} data-testid={`resort-casino-${g.tab}`}>{g.label}</button>)}
            <button type="button" className="world-casino-x" onClick={() => setCasino(false)}>Back to the beach</button>
          </div>
        </div>
      )}
    </div>
  );
}
