/**
 * Millionaire Update prelaunch lockout overlay.
 * Visible copy ONLY: exact headline “Millionaire Update” + live countdown timer.
 * No “coming”, no explanation, no buttons. Extra wording stays in aria (non-visible).
 */
import { useEffect, useRef, useState } from 'react';
import { socket } from '@/lib/net';
import {
  MILLIONAIRE_PRELAUNCH_HEADLINE,
  formatCountdown,
  isMillionairePrelaunch,
  millionairePrelaunchView,
  MILLIONAIRE_PRELAUNCH_START_MS,
  MILLIONAIRE_PRELAUNCH_END_MS,
} from '../../../shared/millionairePrelaunch';

type View = ReturnType<typeof millionairePrelaunchView>;

/** Local screenshot / QA: `/#` or `?prelaunchPreview=1&prelaunchNow=<epochMs>` forces the overlay from client clock. */
function previewNow(): number | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  if (q.get('prelaunchPreview') !== '1') return null;
  const raw = q.get('prelaunchNow');
  const n = raw ? Number(raw) : Date.now();
  return Number.isFinite(n) ? n : Date.now();
}

export function MillionairePrelaunchOverlay() {
  // Read once: without prelaunchNow the preview base is Date.now(), which must not change on every render.
  const [preview] = useState(previewNow);
  // Server clock skew lives in a ref: as state in the effect deps, every answer (new skew) re-ran the effect, which
  // asked again at once — an endless request loop (Dayne 2026-11-07: ~400 requests per app open).
  const skew = useRef(0);
  const [endAt, setEndAt] = useState(MILLIONAIRE_PRELAUNCH_END_MS);
  const [now, setNow] = useState(() => preview ?? Date.now());
  const [active, setActive] = useState(() => (preview != null ? isMillionairePrelaunch(preview) : isMillionairePrelaunch()));

  useEffect(() => {
    if (preview != null) {
      // Time-controlled local preview — no server; tick from the frozen base + elapsed wall.
      const baseWall = Date.now();
      const baseNow = preview;
      const iv = window.setInterval(() => {
        const n = baseNow + (Date.now() - baseWall);
        setNow(n);
        setActive(isMillionairePrelaunch(n));
        setEndAt(MILLIONAIRE_PRELAUNCH_END_MS);
      }, 250);
      return () => window.clearInterval(iv);
    }

    const apply = (v: Partial<View>) => {
      if (typeof v.serverNow === 'number') skew.current = v.serverNow - Date.now();
      if (typeof v.endAt === 'number') setEndAt(v.endAt);
      if (typeof v.active === 'boolean') setActive(v.active);
      else if (typeof v.serverNow === 'number') setActive(isMillionairePrelaunch(v.serverNow));
    };
    const wall = () => Date.now() + skew.current;
    const sync = () => {
      const n = wall();
      setNow(n);
      setActive(isMillionairePrelaunch(n));
    };
    // The window is fixed (shared constants): once it has ended there is nothing to ask the server, ever.
    if (Date.now() >= MILLIONAIRE_PRELAUNCH_END_MS) { setActive(false); return; }
    let iv = 0;
    const ask = () => {
      if (wall() >= MILLIONAIRE_PRELAUNCH_END_MS) { stop(); return; }
      socket.emit('prelaunch_status', {}, (r: View) => { if (r) apply(r); });
      void fetch('/api/millionaire-prelaunch').then((res) => res.json()).then((r: View) => apply(r)).catch(() => {});
    };
    let to = 0;
    const onPre = (v: View) => apply(v);
    const stop = () => {
      window.clearInterval(iv);
      window.clearTimeout(to);
      socket.off('millionaire_prelaunch', onPre);
      socket.off('connect', ask);
      setActive(false);
    };
    ask();
    socket.on('millionaire_prelaunch', onPre);
    socket.on('connect', ask);
    iv = window.setInterval(() => { sync(); if (wall() >= MILLIONAIRE_PRELAUNCH_END_MS) stop(); }, 250);
    const arm = () => {
      const n = wall();
      let target = MILLIONAIRE_PRELAUNCH_START_MS;
      if (n >= MILLIONAIRE_PRELAUNCH_START_MS) target = MILLIONAIRE_PRELAUNCH_END_MS;
      if (n >= MILLIONAIRE_PRELAUNCH_END_MS) { stop(); return; }
      window.clearTimeout(to);
      to = window.setTimeout(() => { ask(); sync(); arm(); }, Math.min(Math.max(200, target - n + 30), 30_000));
    };
    arm();
    return () => {
      window.clearInterval(iv);
      window.clearTimeout(to);
      socket.off('millionaire_prelaunch', onPre);
      socket.off('connect', ask);
    };
  }, [preview]);

  if (!active) return null;
  const timer = formatCountdown(Math.max(0, endAt - now));
  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/95 p-6 text-center text-white"
      data-testid="millionaire-prelaunch-overlay"
      role="alertdialog"
      aria-label={`${MILLIONAIRE_PRELAUNCH_HEADLINE}. ${timer} remaining.`}
    >
      <div className="max-w-lg px-6 py-10">
        <h1 className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl" data-testid="millionaire-prelaunch-headline">
          {MILLIONAIRE_PRELAUNCH_HEADLINE}
        </h1>
        <p className="font-mono text-5xl tabular-nums tracking-wider sm:text-6xl" data-testid="millionaire-prelaunch-timer" aria-live="polite">
          {timer}
        </p>
      </div>
    </div>
  );
}
