import { useEffect, useState } from 'react';
import type { EventView } from '../../../shared/coop3';

/** Server event goal bar on the map (co-op3). Click opens Co-op → Event. */
export function WeeklyEventBar({ onOpen }: { onOpen?: () => void }) {
  const [v, setV] = useState<EventView | null>(null);
  useEffect(() => {
    let dead = false;
    const load = () => fetch('/api/weekly-event').then((r) => r.json()).then((j: EventView & { ok?: boolean }) => { if (!dead && j.ok !== false && j.goal) setV(j); }).catch(() => {});
    load(); const a = setInterval(load, 60_000); return () => { dead = true; clearInterval(a); };
  }, []);
  if (!v) return null;
  const d = Math.max(0, v.endsAt - Date.now()); const h = Math.floor(d / 3_600_000);
  return (
    <button type="button" className="wev-mapbar" data-testid="wev-mapbar" onClick={onOpen} title={`${v.blurb} Open Co-op → Event`}>
      <span className="wev-name">{v.icon} {v.name}</span>
      <span className="wev-track"><span style={{ width: `${Math.min(100, v.pct * 100)}%`, background: v.color }} /></span>
      <span className="wev-num">{Math.floor(v.pct * 100)}% · {h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`} left</span>
    </button>
  );
}
