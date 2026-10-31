/** Arena netcode smoothing: snapshot buffer + interpolation/extrapolation, and lag-compensation history. Pure; shared by client, server and tests. */
export const INTERP_DELAY_MS = 100;
export const EXTRAP_MAX_MS = 150;
export const LAG_COMP_MAX_MS = 200;
export const LOCAL_STEP_S = 1 / 120;

export interface Pose { id: string; x: number; y: number; z: number; a: number; p: number; alive?: boolean }

export function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export interface Timed<P extends Pose> { t: number; players: P[] }

/** Keeps the latest snapshots (server time t) and a clock-offset estimate (min of recv - t: least-delayed packet wins, drifts slowly up). */
export class SnapBuffer<S extends Timed<Pose>> {
  snaps: Array<S & { recv: number }> = [];
  offset: number | null = null;
  constructor(readonly keep = 30) {}
  push(s: S, recv: number) {
    const o = recv - s.t;
    this.offset = this.offset === null || o < this.offset ? o : this.offset + Math.min(0.5, o - this.offset) * 0.02 + 0.01;
    this.snaps.push({ ...s, recv });
    if (this.snaps.length > this.keep) this.snaps.shift();
  }
  clear() { this.snaps = []; this.offset = null; }
  serverNow(clientNow: number) { return clientNow - (this.offset ?? 0); }
  renderTime(clientNow: number) { return this.serverNow(clientNow) - INTERP_DELAY_MS; }
  /** Milliseconds of buffered future beyond the render time (how healthy the buffer is). */
  bufferedMs(clientNow: number) { const l = this.snaps[this.snaps.length - 1]; return l ? l.t - this.renderTime(clientNow) : 0; }
  latest() { return this.snaps[this.snaps.length - 1]; }
}

/** Players at server time `rt`: lerp between bracketing snapshots, or capped extrapolation past the newest. */
export function samplePlayers<P extends Pose>(snaps: Timed<P>[], rt: number): { players: P[]; extrapolating: boolean } {
  if (!snaps.length) return { players: [], extrapolating: false };
  let i = snaps.length - 1;
  while (i > 0 && snaps[i - 1].t > rt) i--;
  const b = snaps[i];
  const a = snaps[i - 1];
  if (!a) return { players: b.players, extrapolating: false };
  const ext = rt > b.t;
  const span = b.t - a.t || 1;
  const t = ext ? 1 + Math.min(EXTRAP_MAX_MS, rt - b.t) / span : Math.max(0, (rt - a.t) / span);
  const players = b.players.map((p) => {
    const q = a.players.find((o) => o.id === p.id);
    if (!q || q.alive === false || p.alive === false) return p;
    // Teleport (respawn) between snapshots: don't slide across the map.
    if (Math.hypot(p.x - q.x, p.y - q.y) > 4) return t >= 0.5 ? p : q;
    return { ...p, x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t, z: Math.max(Math.min(q.z, p.z) - 0.5, q.z + (p.z - q.z) * t), a: angleLerp(q.a, p.a, t), p: q.p + (p.p - q.p) * Math.min(1, t) };
  });
  return { players, extrapolating: ext };
}

/** Per-fighter position history for server-side lag compensation. */
export class PoseHistory {
  private h = new Map<string, Array<{ t: number; x: number; y: number; z: number; crouch?: boolean }>>();
  record(id: string, t: number, x: number, y: number, z: number, crouch = false) {
    const a = this.h.get(id) ?? [];
    if (a.length && a[a.length - 1].t === t) a.pop();
    a.push({ t, x, y, z, ...(crouch ? { crouch: true } : {}) });
    while (a.length && a[0].t < t - 1000) a.shift();
    this.h.set(id, a);
  }
  forget(id: string) { this.h.delete(id); }
  clear() { this.h.clear(); }
  /** Position at time t (clamped to history), or null if unknown. */
  at(id: string, t: number): { x: number; y: number; z: number; crouch?: boolean } | null {
    const a = this.h.get(id);
    if (!a?.length) return null;
    if (t <= a[0].t) return a[0];
    for (let i = a.length - 1; i >= 0; i--) {
      if (a[i].t <= t) {
        const n = a[i + 1];
        if (!n) return a[i];
        const k = (t - a[i].t) / (n.t - a[i].t || 1);
        if (Math.hypot(n.x - a[i].x, n.y - a[i].y) > 4) return k < 0.5 ? a[i] : n;
        const c = (k < 0.5 ? a[i] : n).crouch;
        return { x: a[i].x + (n.x - a[i].x) * k, y: a[i].y + (n.y - a[i].y) * k, z: a[i].z + (n.z - a[i].z) * k, ...(c ? { crouch: true } : {}) };
      }
    }
    return a[0];
  }
}

/** Clamp a client's claimed view time to the lag-comp window. */
export function rewindTime(now: number, viewT: unknown): number {
  if (typeof viewT !== 'number' || !Number.isFinite(viewT)) return now;
  return Math.min(now, Math.max(now - LAG_COMP_MAX_MS, viewT));
}
