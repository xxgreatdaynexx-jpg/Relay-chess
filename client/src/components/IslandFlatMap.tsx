import { useCallback, useEffect, useState } from 'react';
import { ISLAND_HELI, ISLAND_HUNT, ISLAND_SNORKEL, treasureSpots } from '../../../shared/islandActivities';
import { ISLAND_BEACH_R, ISLAND_CENTER, ISLAND_DOCK, ISLAND_GRASS_R, ISLAND_LAGOON, ISLAND_LOTS, ISLAND_MAP, ISLAND_PLACES, islandMapPos, islandSpots } from '../../../shared/island';

export type IslandOwners = Map<string, string>;

/** Private Island 2D map: the real island geometry (beach, grass, dock, estate footprints) with every estate and the dock
 *  as a tappable marker. No WebGL needed; the board keeps its shape and fits the space it is given (phone or desktop). */
const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

const ACT_SPOTS = [
  { ...ISLAND_SNORKEL, kind: 'reef', sub: '5 dives a day' },
  { ...ISLAND_HUNT, kind: 'hunt', sub: 'Dig for the chest', x: -50, z: -47 }, // label sits off the West Beach so it clears Ridge Villa on phones
  { ...ISLAND_HELI, kind: 'heli', sub: 'Island tour' },
];

export function IslandFlatMap({ owners, me, selected, onPick, dug = [] }: { owners: IslandOwners; me: string | null; selected?: string | null; onPick: (id: string) => void; dug?: number[] }) {
  const { x0, x1, z0, z1 } = ISLAND_MAP;
  const mine = (id: string) => !!me && owners.get(id)?.toLowerCase() === me.toLowerCase();
  return (
    <div className="island-flat-map" data-testid="island-flat-map" aria-label="Private Island map">
      <div className="island-flat-board">
        <svg viewBox={`${x0} ${z0} ${x1 - x0} ${z1 - z0}`} aria-hidden="true">
          <rect x={x0} y={z0} width={x1 - x0} height={z1 - z0} fill="#1a6a8a" />
          <circle cx={ISLAND_CENTER.x} cy={ISLAND_CENTER.z} r={ISLAND_BEACH_R + 5} fill="#2a86a6" opacity="0.6" />
          <circle cx={ISLAND_LAGOON.x - 6} cy={ISLAND_LAGOON.z + 6} r="15" fill="#3fd0c0" opacity="0.55" />
          <circle cx={ISLAND_CENTER.x} cy={ISLAND_CENTER.z} r={ISLAND_BEACH_R} fill="#c9b48a" />
          <circle cx={ISLAND_CENTER.x} cy={ISLAND_CENTER.z} r={ISLAND_GRASS_R} fill="#3f8a4a" />
          <ellipse cx="0" cy="-47" rx="28" ry="10" fill="#6f7a5a" opacity="0.6" />
          <rect x={ISLAND_DOCK.x - ISLAND_DOCK.w / 2} y={ISLAND_DOCK.z - ISLAND_DOCK.d / 2} width={ISLAND_DOCK.w} height={ISLAND_DOCK.d} fill="#8a5a36" />
          {ISLAND_LOTS.map((l) => (
            <rect key={l.id} x={l.x - l.w / 2} y={l.z - l.d / 2} width={l.w} height={l.d} rx="1.5"
              transform={`rotate(${(-l.rot * 180) / Math.PI} ${l.x} ${l.z})`}
              fill={mine(l.id) ? '#8bdf87' : owners.has(l.id) ? '#e8dcc4' : '#f6efe2'} stroke="#6a4a2a" strokeWidth="0.6" opacity="0.9" />
          ))}
          <ellipse cx={ISLAND_SNORKEL.x} cy={ISLAND_SNORKEL.z} rx="11" ry="9" fill="#ff8a9a" opacity="0.35" stroke="#fff" strokeWidth="0.4" strokeDasharray="1.5 1.5" />
          <circle cx={ISLAND_HELI.x} cy={ISLAND_HELI.z} r="6" fill="#3a4248" stroke="#f6c445" strokeWidth="0.6" />
          {treasureSpots().map((q) => <text key={q.n} x={q.x} y={q.z + 1.4} textAnchor="middle" fontSize="4.2" fontWeight="bold" fill={dug.includes(q.n) ? '#6a5030' : '#d8342a'}>{dug.includes(q.n) ? '○' : '✕'}</text>)}
          {ISLAND_PLACES.map((p) => <text key={p.id} x={p.x} y={p.z} textAnchor="middle" fontSize="4" fill="#fff8e8" opacity="0.85">{p.label}</text>)}
        </svg>
        {islandSpots().map((s) => {
          const pos = islandMapPos(s.x, s.z); const owner = owners.get(s.id);
          const cls = `island-flat-spot island-flat-${s.kind}${mine(s.id) ? ' mine' : owner ? ' owned' : ''}${selected === s.id ? ' on' : ''}`;
          return (
            <button key={s.id} type="button" className={cls} style={{ left: `${pos.left}%`, top: `${pos.top}%` }} onClick={() => onPick(s.id)} data-testid={`island-flat-${s.id}`} aria-pressed={selected === s.id}>
              <b><i aria-hidden="true">{s.icon} </i>{s.label}</b>
              <small>{s.kind === 'dock' ? 'Landing spot' : s.kind === 'lagoon' ? 'Island-only fishing' : s.kind === 'lounge' ? 'Daily estate retreat' : mine(s.id) ? 'Yours' : owner ? owner : `For sale 🪙${short(s.price ?? 0)}`}</small>
            </button>
          );
        })}
        {ACT_SPOTS.map((s) => {
          const pos = islandMapPos(s.x, s.z);
          return (
            <button key={s.id} type="button" className={`island-flat-spot island-flat-act island-flat-${s.kind}${selected === s.id ? ' on' : ''}`} style={{ left: `${pos.left}%`, top: `${pos.top}%` }} onClick={() => onPick(s.id)} data-testid={`island-flat-${s.id}`} aria-pressed={selected === s.id}>
              <b><i aria-hidden="true">{s.icon} </i>{s.label}</b>
              <small>{s.sub}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Deed owners for the island estates, from the public real-estate list. */
export function useIslandOwners(): [IslandOwners, () => void] {
  const [owners, setOwners] = useState<IslandOwners>(new Map());
  const load = useCallback(() => {
    void fetch('/api/real-estate').then((r) => r.json()).then((d: { owned?: Array<{ id: string; owner: string }> }) => {
      setOwners(new Map((d.owned ?? []).filter((o) => o.id.startsWith('isl:')).map((o) => [o.id, o.owner])));
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = window.setInterval(load, 30_000); return () => window.clearInterval(t); }, [load]);
  return [owners, load];
}

