/**
 * Hold'em spectator feed. Spectators see every hole card, so:
 *  - a viewer linked to anyone seated at the table (same signed-in name/session or same device id) is refused
 *    (a shared IP alone is allowed),
 *    and is dropped if that link appears later (e.g. they sit down in another tab);
 *  - the feed is delayed by `delayMs` (actions and cards), so a watcher can't feed a seat live info;
 *  - seated players keep getting HoldemTable.view(), which hides others' cards until showdown.
 */
import type { HESpectateView } from '../shared/holdem.js';
import { spectateView, type HoldemTable } from './holdem.js';

export interface Viewer { id: string; name: string | null; ip: string; device: string | null }

export class HoldemSpectators {
  /** viewer id -> table id */
  private watching = new Map<string, string>();
  private viewers = new Map<string, Viewer>();
  /** Frames per table, oldest first. */
  private frames = new Map<string, Array<{ at: number; view: HESpectateView }>>();
  private sent = new Map<string, number>();
  /** Identities (ips/devices) of signed-in players, learned from their sockets. */
  private seen = new Map<string, { ips: Set<string>; devices: Set<string> }>();

  constructor(readonly delayMs: number, private readonly rand: () => number = Math.random) {}

  /** Record which IPs/devices a name plays from. */
  noteIdentity(v: Viewer): void {
    if (!v.name) return;
    const k = v.name.toLowerCase();
    const e = this.seen.get(k) ?? { ips: new Set(), devices: new Set() };
    e.ips.add(v.ip);
    if (v.device) e.devices.add(v.device);
    this.seen.set(k, e);
  }

  /** Why this viewer may not watch the table, or null if they may. */
  blockReason(t: HoldemTable, v: Viewer): string | null {
    for (const s of t.seats) {
      if (!s) continue;
      if (v.name && s.name.toLowerCase() === v.name.toLowerCase()) return 'You are seated at this table. Stand up to spectate it.';
      const e = this.seen.get(s.name.toLowerCase());
      // An IP match alone isn't blocked (shared home networks may watch); name/session and device are.
      if (v.device && e?.devices.has(v.device)) return 'This device is seated at this table, so you can’t spectate it.';
    }
    return null;
  }

  watch(t: HoldemTable, v: Viewer, now: number): HESpectateView | null {
    const why = this.blockReason(t, v);
    if (why) throw new Error(why);
    this.viewers.set(v.id, v);
    this.watching.set(v.id, t.id);
    this.sent.delete(v.id);
    this.record(t, now);
    return this.frameFor(t.id, now);
  }

  unwatch(id: string): void {
    this.watching.delete(id);
    this.viewers.delete(id);
    this.sent.delete(id);
  }

  tableOf(id: string): string | null { return this.watching.get(id) ?? null; }
  count(tableId: string): number { let n = 0; for (const t of this.watching.values()) if (t === tableId) n++; return n; }

  /** Snapshot the table now (call whenever it changes). */
  record(t: HoldemTable, now: number): void {
    const list = this.frames.get(t.id) ?? [];
    list.push({ at: now, view: spectateView(t, now, this.delayMs, this.rand) });
    // Keep only one frame older than the delay window.
    while (list.length > 1 && list[1]!.at <= now - this.delayMs) list.shift();
    this.frames.set(t.id, list);
  }

  /** Latest frame that is at least delayMs old (null before the delay has passed). */
  frameFor(tableId: string, now: number): HESpectateView | null {
    const list = this.frames.get(tableId) ?? [];
    let f: { at: number; view: HESpectateView } | null = null;
    for (const x of list) if (x.at <= now - this.delayMs) f = x;
    if (!f) return null;
    return { ...f.view, watchers: this.count(tableId), serverNow: f.view.serverNow };
  }

  /**
   * What to send now: viewer id -> frame (or a kick message). Re-checks eligibility every time,
   * so sitting down at the table in another tab ends the spectate session.
   */
  due(tables: HoldemTable[], now: number): Array<{ id: string; view?: HESpectateView | null; kicked?: string }> {
    const out: Array<{ id: string; view?: HESpectateView | null; kicked?: string }> = [];
    for (const [id, tableId] of this.watching) {
      const t = tables.find((x) => x.id === tableId);
      const v = this.viewers.get(id)!;
      if (!t) { this.unwatch(id); out.push({ id, kicked: 'That table closed.' }); continue; }
      const why = this.blockReason(t, v);
      if (why) { this.unwatch(id); out.push({ id, kicked: why }); continue; }
      const list = this.frames.get(tableId) ?? [];
      let at = -1;
      for (const x of list) if (x.at <= now - this.delayMs) at = x.at;
      const key = at * 1000 + this.count(tableId);
      if (this.sent.get(id) === key) continue;
      this.sent.set(id, key);
      out.push({ id, view: this.frameFor(tableId, now) });
    }
    return out;
  }
}
