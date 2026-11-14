/**
 * Client side of the public launch shows: listens for the server broadcast, asks for anything already in
 * the sky on (re)connect, and keeps a small list in local-clock time. Views subscribe and animate from `at`.
 */
import { useEffect, useState } from 'react';
import { socket } from './net';
import { parseLaunchShow, showActive, SHOW_END_MS, type LaunchShow } from '../../../shared/spaceLaunchShow';

/** A show with `at` already converted to this device's clock. */
export type LocalShow = LaunchShow & { fresh: boolean };

let shows: LocalShow[] = [];
const subs = new Set<(s: LocalShow[], added: LocalShow[]) => void>();
let started = false;

function prune(now = Date.now()) {
  const before = shows.length;
  shows = shows.filter((s) => showActive(s, now) || now < s.at);
  return shows.length !== before;
}

function emit(added: LocalShow[]) { for (const f of subs) f(shows, added); }

/** Merge shows from the server, correcting for clock skew with the server's `now`. */
export function ingestShows(list: unknown[], serverNow: number, fresh: boolean, localNow = Date.now()) {
  const skew = Number.isFinite(serverNow) ? serverNow - localNow : 0;
  const added: LocalShow[] = [];
  for (const raw of list) {
    const s = parseLaunchShow(raw);
    if (!s || shows.some((x) => x.id === s.id)) continue;
    const local: LocalShow = { ...s, at: s.at - skew, fresh };
    if (local.at + SHOW_END_MS < localNow) continue;
    shows.push(local); added.push(local);
  }
  prune(localNow);
  if (added.length) emit(added);
}

function start() {
  if (started) return;
  started = true;
  socket.on('space_launch_show', (m: { show?: unknown; now?: number }) => ingestShows([m?.show], Number(m?.now), true));
  const sync = () => socket.timeout(8_000).emit('space_launch_shows', {}, (err: Error | null, r?: { shows?: unknown[]; now?: number }) => {
    if (!err && Array.isArray(r?.shows)) ingestShows(r.shows, Number(r.now), false);
  });
  socket.on('connect', sync);
  if (socket.connected) sync();
  window.setInterval(() => { if (prune()) emit([]); }, 5_000);
}

export function subscribeShows(f: (s: LocalShow[], added: LocalShow[]) => void): () => void {
  start();
  subs.add(f);
  f(shows, []);
  return () => { subs.delete(f); };
}

export function useLaunchShows(): LocalShow[] {
  const [list, setList] = useState<LocalShow[]>(() => shows);
  useEffect(() => subscribeShows((s) => setList([...s])), []);
  return list;
}

/** Dev/preview only: play a fake show (used by the screenshot harness). */
export function _demoShow(s: Partial<LaunchShow> & { offsetS?: number }) {
  const now = Date.now();
  ingestShows([{ id: `demo-${now}-${Math.random()}`, player: 'Vega', design: 'Goliath Heavy', size: 'heavy', boosters: true, ...s, at: now - (s.offsetS ?? -5) * 1000 }], now, true, now);
}

// Local dev server only (stripped from production builds): lets the screenshot harness play a heavy launch.
if (import.meta.env.DEV) (window as unknown as { __launchDemo?: typeof _demoShow }).__launchDemo = _demoShow;
