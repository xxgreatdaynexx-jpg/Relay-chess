/** Full-screen overnight lockout: 01:00–09:00 America/Edmonton (UTC-6). */
import { useEffect, useState } from 'react';
import { socket } from '@/lib/net';
import { HUB_SLEEP_MSG, hubSleepView, isHubAwake, nextHubBoundary } from '../../../shared/hubSleep';

export function HubSleepOverlay() {
  const [sleeping, setSleeping] = useState(() => !isHubAwake());
  const [wakeAt, setWakeAt] = useState(() => hubSleepView().nextChangeAt);

  useEffect(() => {
    const sync = () => {
      const v = hubSleepView();
      setSleeping(v.sleeping);
      setWakeAt(v.nextChangeAt);
    };
    sync();
    const iv = window.setInterval(sync, 15_000);
    const onSleep = (v: { sleeping?: boolean; nextChangeAt?: number; message?: string }) => {
      if (v && typeof v.sleeping === 'boolean') setSleeping(v.sleeping);
      if (v && typeof v.nextChangeAt === 'number') setWakeAt(v.nextChangeAt);
    };
    socket.on('hub_sleep', onSleep);
    // Nudge server status once connected (works even while awake — no-op overlay).
    const ask = () => socket.emit('hub_status', {}, (r: { sleeping?: boolean; nextChangeAt?: number }) => { if (r) onSleep(r); });
    socket.on('connect', ask);
    if (socket.connected) ask();
    // Wake exactly at the boundary.
    let to = 0;
    const arm = () => {
      const ms = Math.max(500, nextHubBoundary() - Date.now() + 50);
      window.clearTimeout(to);
      to = window.setTimeout(() => { sync(); arm(); }, Math.min(ms, 60_000));
    };
    arm();
    return () => { window.clearInterval(iv); window.clearTimeout(to); socket.off('hub_sleep', onSleep); socket.off('connect', ask); };
  }, []);

  if (!sleeping) return null;
  const wakeLocal = new Date(wakeAt + (-6) * 3_600_000);
  const hh = String(wakeLocal.getUTCHours()).padStart(2, '0');
  const mm = String(wakeLocal.getUTCMinutes()).padStart(2, '0');
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-6 text-center text-white" data-testid="hub-sleep-overlay" role="alertdialog" aria-label={HUB_SLEEP_MSG}>
      <div className="max-w-md rounded-2xl border border-white/15 bg-zinc-900/95 px-6 py-8 shadow-2xl">
        <div className="mb-3 text-4xl" aria-hidden>😴</div>
        <h1 className="mb-2 text-xl font-bold">{HUB_SLEEP_MSG}</h1>
        <p className="text-sm opacity-75">Chud Hub is closed from 01:00–09:00 America/Edmonton (UTC-6). Come back around {hh}:{mm}.</p>
      </div>
    </div>
  );
}
