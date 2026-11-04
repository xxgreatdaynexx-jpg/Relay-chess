// Where the signed-in player is (city / Chud Resort). The server is the source of truth (server/travel.ts);
// this store mirrors it and tags <html data-venue="resort"> so resort casino tables get their own skin.
import { useEffect, useState } from 'react';
import { request, socket } from '@/lib/net';
import type { Destination, Location } from '../../../shared/resort';

type State = { loc: Location; ticket: number; tickets: Record<Destination, number> };
let state: State = { loc: 'city', ticket: 500, tickets: { resort: 500, fortmc: 1500 } };
const subs = new Set<(s: State) => void>();
const set = (s: State) => { state = s; document.documentElement.dataset.venue = s.loc; subs.forEach((f) => f(s)); };

export async function refreshTrip() { const r = await request('trip_status') as { ok: boolean; loc?: Location; ticket?: number; tickets?: Record<Destination, number> }; if (r.ok && r.loc) set({ loc: r.loc, ticket: r.ticket ?? state.ticket, tickets: r.tickets ?? state.tickets }); return state; }
export async function flyTo(dest: Destination) { const r = await request('trip_buy', { dest }) as { ok: boolean; error?: string; fee?: number }; if (r.ok) set({ ...state, loc: dest }); return r; }
export const flyToResort = () => flyTo('resort');
export async function flyHome() { const r = await request('trip_home') as { ok: boolean; error?: string }; if (r.ok) set({ ...state, loc: 'city' }); return r; }
export const tripNow = () => state;
export const atResort = () => state.loc === 'resort';

let wired = false;
export function useTrip(): State {
  const [s, setS] = useState(state);
  useEffect(() => {
    subs.add(setS);
    if (!wired) { wired = true; void refreshTrip(); socket.on('connect', () => void refreshTrip()); window.addEventListener('relay-name-changed', () => void refreshTrip()); }
    return () => { subs.delete(setS); };
  }, []);
  return s;
}
