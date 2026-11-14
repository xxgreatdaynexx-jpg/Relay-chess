/** Other players' rocket launches on the city map: the 2D Space Center tile animation and the launch toast. */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { subscribeShows, useLaunchShows, type LocalShow } from '@/lib/spaceLaunchFeed';
import { useSettings } from '@/lib/settings';
import { SHOW_FLIGHT_S, SHOW_END_MS, SHOW_TOAST_FRESH_MS, SHOW_SEP_S, showPose } from '../../../shared/spaceLaunchShow';
import type { World } from '@/lib/world3d';

/** Feed the 3D city: shows list plus the settings switch (off, or reduce motion, hides the 3D animation). */
export function useWorldLaunchSync(worldRef: RefObject<World | null>, ready: boolean) {
  const shows = useLaunchShows();
  const s = useSettings();
  useEffect(() => { worldRef.current?.setLaunchShows(shows); }, [shows, ready, worldRef]);
  useEffect(() => { worldRef.current?.setLaunchFx(s.launchFx && !s.reducedMotion); }, [s.launchFx, s.reducedMotion, ready, worldRef]);
}

function useNow(active: boolean, ms = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [active, ms]);
  return now;
}

/** Screen mapping for the tile: square-root compression so the whole climb fits a few hundred pixels. */
const map2d = (down: number, up: number) => ({ x: 7 * Math.sqrt(Math.max(0, down)), y: -9 * Math.sqrt(Math.max(0, up)) });

function Show2D({ show }: { show: LocalShow }) {
  const now = useNow(true);
  const ts = (now - show.at) / 1000;
  const base = show.size === 'heavy' ? 7 : show.size === 'medium' ? 5.5 : 4;
  // Puffs laid down every 1.2 s of flight; they grow, drift right on the wind and fade.
  const puffs: Array<{ x: number; y: number; r: number; o: number }> = [];
  if (ts > 0) {
    for (let te = 0; te < Math.min(ts, SHOW_FLIGHT_S); te += 1.2) {
      const age = ts - te;
      const p = showPose(show.size, te);
      const m = map2d(p.down, p.up);
      const o = 0.6 * Math.max(0, 1 - age / 45);
      if (o <= 0.01) continue;
      puffs.push({ x: m.x + age * 0.5 * (1 + -m.y / 200), y: m.y - age * 0.15, r: base * (te < 5 ? 1.6 : 1) + age * 0.32, o });
    }
    // Pad cloud.
    const ca = Math.max(0, 1 - ts / 50);
    if (ca > 0) for (const k of [-1, 0, 1]) puffs.push({ x: k * (10 + Math.min(ts, 8) * 2.2) + ts * 0.4, y: 2, r: base * 1.8 + Math.min(ts, 10) * 0.9, o: 0.55 * ca });
  }
  const p = showPose(show.size, Math.max(0, ts));
  const m = map2d(p.down, p.up);
  const flying = ts >= 0 && ts < SHOW_FLIGHT_S;
  const fade = ts > SHOW_FLIGHT_S - 10 ? Math.max(0, (SHOW_FLIGHT_S - ts) / 10) : 1;
  const deg = -45 + (p.pitch * 180) / Math.PI; // the emoji points up-right at rest
  const sep = show.boosters && ts >= SHOW_SEP_S && ts < SHOW_SEP_S + 1.5 ? map2d(showPose(show.size, SHOW_SEP_S).down, showPose(show.size, SHOW_SEP_S).up) : null;
  return (
    <span className={`wl2d wl2d-${show.size}`} aria-hidden="true" data-testid="launch-2d">
      <svg style={{ left: '50%', top: '66%', width: 1, height: 1 }}>
        {puffs.map((q, i) => <circle key={i} className="wl2d-puff" cx={q.x} cy={q.y} r={q.r} opacity={q.o} />)}
        {sep && <circle cx={sep.x} cy={sep.y} r={10 + (ts - SHOW_SEP_S) * 18} fill="#fff2c0" opacity={1 - (ts - SHOW_SEP_S) / 1.5} />}
      </svg>
      {ts < 0 && <span className="wl2d-count">T-{Math.ceil(-ts)}</span>}
      {flying && (
        <span className="wl2d-rocket" style={{ left: '50%', top: '66%', opacity: fade, transform: `translate(${m.x - 13}px, ${m.y - 26}px) rotate(${deg}deg)` }}>🚀</span>
      )}
      {ts < SHOW_FLIGHT_S && <span className="wl2d-tag">🚀 {show.player} · {show.design}</span>}
    </span>
  );
}

/** Rendered inside the Space Center tile on the 2D map. */
export function LaunchTile2D() {
  const shows = useLaunchShows();
  const s = useSettings();
  const now = useNow(shows.length > 0, 1000);
  if (!s.launchFx) return null;
  const live = shows.filter((x) => now >= x.at - 6_000 && now < x.at + SHOW_END_MS).sort((a, b) => b.at - a.at)[0];
  return live ? <Show2D key={live.id} show={live} /> : null;
}

/** "🚀 Vega launched Goliath Heavy" — tap to open the Space Center; the pin glides the 3D camera to the pad. */
export function LaunchToast({ me, onOpen, onWatch }: { me: string | null | undefined; onOpen: () => void; onWatch?: () => void }) {
  const s = useSettings();
  const [toast, setToast] = useState<LocalShow | null>(null);
  const timer = useRef(0);
  const meRef = useRef(me); meRef.current = me;
  const onRef = useRef(s.launchFx); onRef.current = s.launchFx;
  useEffect(() => subscribeShows((_all, added) => {
    const now = Date.now();
    const pick = added.filter((x) => now - x.at < SHOW_TOAST_FRESH_MS && x.player.toLowerCase() !== (meRef.current ?? '').toLowerCase()).sort((a, b) => b.at - a.at)[0];
    if (!pick || !onRef.current) return;
    setToast(pick);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 9_000);
  }), []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!toast || !s.launchFx) return null;
  return (
    <div className="world-launch-toast" role="status" data-testid="launch-toast">
      <button type="button" className="wlt-main" onClick={() => { setToast(null); onOpen(); }} data-testid="launch-toast-open">
        <span className="wlt-ico">🚀</span>
        <span><b>{toast.player}</b> launched <b>{toast.design}</b><small>Tap to open the Space Center</small></span>
      </button>
      {onWatch && <button type="button" className="wlt-watch" onClick={() => onWatch()} data-testid="launch-toast-watch" title="Look at the launch pad">👀 Watch</button>}
      <button type="button" className="wlt-x" onClick={() => setToast(null)} aria-label="Dismiss">✕</button>
    </div>
  );
}
