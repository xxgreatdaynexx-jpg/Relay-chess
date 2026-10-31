import { useEffect, useRef, useState } from 'react';
import { WORLD_SPOTS } from '@/lib/worldSpots';
import type { World } from '@/lib/world3d';

const CASINO_GAMES = [
  { tab: 'blackjack-tab', label: '🂡 Blackjack' }, { tab: 'roulette-tab', label: '🎡 Roulette' }, { tab: 'poker-tab', label: '🃏 Poker' },
  { tab: 'slots-tab', label: '🎰 Slots' }, { tab: 'solitaire-tab', label: '♠ Solitaire' },
];
const MODE_KEY = 'chud-world-mode';

/** Press a top-bar tab (opens its panel) unless it's already open. */
function openTab(testId: string) {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (el && el.getAttribute('aria-expanded') !== 'true') el.click();
  return !!el;
}

function weakDevice() {
  try {
    const c = document.createElement('canvas');
    if (!(c.getContext('webgl2') || c.getContext('webgl'))) return true;
  } catch { return true; }
  const n = navigator as Navigator & { deviceMemory?: number };
  return (n.hardwareConcurrency ?? 4) <= 2 || (n.deviceMemory ?? 4) <= 1;
}

/** Home "world": a night city where each landmark opens a part of Chud Hub. */
export function WorldMap({ onClose, onLeaderboard }: { onClose: () => void; onLeaderboard: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const [mode, setMode] = useState<'3d' | '2d'>(() => (localStorage.getItem(MODE_KEY) as '3d' | '2d' | null) ?? (weakDevice() ? '2d' : '3d'));
  const [loading, setLoading] = useState(mode === '3d');
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [casino, setCasino] = useState(false);
  useEffect(() => { localStorage.setItem(MODE_KEY, mode); }, [mode]);

  const go = (id: string) => {
    switch (id) {
      case 'casino': setCasino(true); return;
      case 'chess': onClose(); return;
      case 'mine': openTab('mines-tab'); break;
      case 'arena': openTab('arena-tab'); break;
      case 'factory': openTab('factory-tab') || openTab('mines-tab'); break;
      case 'warehouse': window.dispatchEvent(new CustomEvent('open-inventory', { detail: { tab: 'inv' } })); break;
      case 'market': if (openTab('market-tab')) break; window.dispatchEvent(new CustomEvent('open-inventory', { detail: { tab: 'market' } })); break;
      case 'bank': openTab('wallet-button'); break;
      case 'chat': openTab('chat-tab'); break;
      case 'leaderboard': onLeaderboard(); break;
    }
    onClose();
  };
  const goRef = useRef(go); goRef.current = go;

  useEffect(() => {
    if (mode !== '3d') return;
    let dead = false;
    void import('@/lib/world3d').then(({ createWorld }) => {
      if (dead || !canvasRef.current) return;
      try {
        worldRef.current = createWorld(canvasRef.current, {
          onHover: (id, x, y) => setTip(id ? { id, x, y } : null),
          onPick: (id) => goRef.current(id),
        });
      } catch { setMode('2d'); }
      setLoading(false);
    }).catch(() => setMode('2d'));
    return () => { dead = true; worldRef.current?.dispose(); worldRef.current = null; };
  }, [mode]);
  useEffect(() => { worldRef.current?.setRunning(!casino); if (!casino) worldRef.current?.reset(); }, [casino]);

  const spot = tip && WORLD_SPOTS.find((s) => s.id === tip.id);
  return (
    <div className="world" data-testid="world-map">
      {mode === '3d' ? <canvas ref={canvasRef} className="world-canvas" data-testid="world-canvas" /> : (
        <div className="world-grid" data-testid="world-grid">
          {WORLD_SPOTS.map((s) => (
            <button key={s.id} type="button" className="world-tile" style={{ ['--c' as string]: '#' + s.color.toString(16).padStart(6, '0') }} onClick={() => go(s.id)} data-testid={`world-tile-${s.id}`}>
              <span className="world-tile-icon">{s.icon}</span><b>{s.label}</b><small>{s.blurb}</small>
            </button>
          ))}
        </div>
      )}
      <div className="world-title"><span>CHUD</span> HUB<small>pick a spot on the map</small></div>
      {loading && mode === '3d' && <div className="world-loading">Building the city…</div>}
      {spot && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#' + spot.color.toString(16).padStart(6, '0') }} data-testid="world-tip"><b>{spot.icon} {spot.label}</b><span>{spot.blurb}</span><em>Click to enter</em></div>}
      {mode === '3d' && (
        <nav className="world-quick" aria-label="Places">
          {WORLD_SPOTS.map((s) => <button key={s.id} type="button" onMouseEnter={() => worldRef.current?.hover(s.id)} onMouseLeave={() => worldRef.current?.hover(null)} onClick={() => worldRef.current ? worldRef.current.flyTo(s.id) : go(s.id)} data-testid={`world-go-${s.id}`}>{s.icon}<span> {s.label}</span></button>)}
        </nav>
      )}
      <div className="world-corner">
        <button type="button" onClick={() => setMode(mode === '3d' ? '2d' : '3d')} data-testid="world-mode">{mode === '3d' ? '▦ 2D map' : '🌃 3D city'}</button>
        <button type="button" onClick={onClose} data-testid="world-skip">Lobby →</button>
      </div>
      {casino && (
        <div className="world-casino" onMouseDown={(e) => { if (e.target === e.currentTarget) setCasino(false); }} data-testid="world-casino">
          <div><h3>🎰 Chud Casino</h3>
            {CASINO_GAMES.map((g) => <button key={g.tab} type="button" onClick={() => { setCasino(false); openTab(g.tab); onClose(); }} data-testid={`world-casino-${g.tab}`}>{g.label}</button>)}
            <button type="button" className="world-casino-x" onClick={() => setCasino(false)}>Back to the city</button>
          </div>
        </div>
      )}
    </div>
  );
}
