/** Other players' rocket launches on the city map: the 2D Space Center tile animation and the launch toast. */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { subscribeShows, useLaunchShows, type LocalShow } from '@/lib/spaceLaunchFeed';
import { useSettings } from '@/lib/settings';
import { SHOW_FLIGHT_S, SHOW_END_MS, SHOW_TOAST_FRESH_MS } from '../../../shared/spaceLaunchShow';
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

function Show2D({ show }: { show: LocalShow }) {
  // Negative delay = seconds already flown, captured once so a re-render never restarts the animation.
  const [delay] = useState(() => (Date.now() - show.at) / 1000);
  const now = useNow(true);
  const ts = (now - show.at) / 1000;
  const style = { animationDelay: `${delay}s` } as const;
  return (
    <span className={`wl2d wl2d-${show.size}`} aria-hidden="true" data-testid="launch-2d">
      {ts < 0 ? <span className="wl2d-count">T-{Math.ceil(-ts)}</span> : (
        <>
          <span className="wl2d-cloud" style={style} />
          <span className="wl2d-trail" style={style} />
          <span className="wl2d-rocket" style={style}>🚀</span>
          {show.boosters && <span className="wl2d-sep" style={{ animationDelay: `${delay - 26}s` }} />}
        </>
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
