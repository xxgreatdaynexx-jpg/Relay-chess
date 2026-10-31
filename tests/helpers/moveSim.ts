/** Simulated Arena client <-> server movement loop (prediction, send rate, latency, 15 Hz snapshots, reconciliation). */
import { canSprint, gridMap, moveHorizontal, MoveHistory, reconcileMove, speedOf, stepVertical, TICK_HZ, type ArenaMap } from '../../shared/fps.js';
import { ArenaWorld } from '../../server/arena-world.js';
import { ArenaAntiCheat, type ArenaFlag } from '../../server/arena-anticheat.js';

// 30x30 room with a pillar block in the middle: laps around it take corners and slide along walls.
const rows = ['##############################'];
for (let i = 1; i < 29; i++) rows.push('#' + Array.from({ length: 28 }, (_, j) => (i >= 11 && i <= 18 && j >= 10 && j <= 17 ? '#' : '.')).join('') + '#');
rows.push('##############################');
export const SIM_MAP: ArenaMap = gridMap(rows);

export interface SimResult { maxCorrection: number; corrections: number; snaps: number; flags: ArenaFlag[]; maxServerLag: number; acks: number }

export function simulate(o: { latencyMs: number; jitterMs?: number; knife?: boolean; seconds?: number; mode?: 'legacy' | 'seq'; corners?: boolean; seed?: number }): SimResult {
  let seed = o.seed ?? 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const flags: ArenaFlag[] = [];
  const w = new ArenaWorld(SIM_MAP, () => 0.5);
  w.audit = new ArenaAntiCheat((f) => flags.push(f), (_id, name) => name);
  const f = w.join('me', 'me', 0, o.knife ? 'knife' : 'pistol');
  const start = { x: 5.5, y: 5.5 };
  Object.assign(f, { x: start.x, y: start.y, z: 0, a: 0, weapon: o.knife ? 'knife' : 'pistol' });
  const m = { x: start.x, y: start.y, z: 0, vz: 0, grounded: true, a: 0, crouch: false, sprint: false, weapon: o.knife ? 'knife' : 'pistol' } as Parameters<typeof moveHorizontal>[0] & { a: number; sprint: boolean; weapon: string; crouch: boolean };
  const hist = new MoveHistory();
  const net: Array<{ at: number; fn: () => void }> = [];
  const send = (now: number, fn: () => void) => net.push({ at: now + o.latencyMs + (o.jitterMs ?? 0) * rnd(), fn });
  let q = 0, lastSend = -1e9, lastSnap = 0, corr: { x: number; y: number; left: number } | null = null;
  const res: SimResult = { maxCorrection: 0, corrections: 0, snaps: 0, flags, maxServerLag: 0, acks: 0 };
  const STEP = 1000 / 120, FRAME = 1000 / 60;
  const end = (o.seconds ?? 15) * 1000;
  let acc = 0;
  for (let now = 0; now <= end; now += FRAME) {
    // deliver due messages in order
    net.sort((a, b) => a.at - b.at);
    while (net.length && net[0].at <= now) net.shift()!.fn();
    // steer: straight line, or laps of the pillar (turn 90° left at each corner)
    if (o.corners) {
      const tgt = [[5.5, 5.5], [24.5, 5.5], [24.5, 24.5], [5.5, 24.5]];
      const i = tgt.findIndex(([x, y]) => Math.hypot(m.x - x, m.y - y) < 1.2);
      if (i >= 0) { const [nx, ny] = tgt[(i + 1) % 4]; m.a = Math.atan2(ny - m.y, nx - m.x); }
    } else if (m.x > 24) m.a = Math.PI; else if (m.x < 5) m.a = 0;
    m.sprint = canSprint(m, Math.cos(m.a), Math.sin(m.a), false);
    const sp = speedOf(m) * 0.95;
    acc += FRAME;
    while (acc >= STEP) {
      acc -= STEP;
      moveHorizontal(m, Math.cos(m.a) * sp * STEP / 1000, Math.sin(m.a) * sp * STEP / 1000, SIM_MAP);
      stepVertical(m, STEP / 1000, SIM_MAP);
      if (corr && corr.left > 0) { const k = Math.min(1, STEP / 1000 / corr.left); moveHorizontal(m, corr.x * k, corr.y * k, SIM_MAP); corr = { x: corr.x * (1 - k), y: corr.y * (1 - k), left: corr.left - STEP / 1000 }; }
    }
    if (now - lastSend > 50) {
      lastSend = now; q += 1; hist.push(q, m.x, m.y);
      const pkt = { x: m.x, y: m.y, a: m.a, s: m.sprint, q };
      send(now, () => { w.move('me', pkt.x, pkt.y, pkt.a, Math.round(now + o.latencyMs), 0, false, pkt.s, pkt.q); res.maxServerLag = Math.max(res.maxServerLag, Math.hypot(f.x - pkt.x, f.y - pkt.y)); });
    }
    if (now - lastSnap >= 1000 / TICK_HZ) {
      lastSnap = now;
      const t = Math.round(now + o.latencyMs);
      w.tick(t);
      const me = w.snapshot(t).players.find((p) => p.id === 'me')! as { x: number; y: number; q?: number };
      const snap = { x: me.x, y: me.y, q: me.q };
      send(now, () => {
        if (o.mode === 'legacy') {
          const e = Math.hypot(m.x - snap.x, m.y - snap.y);
          if (e > 1.5) { res.snaps++; res.maxCorrection = Math.max(res.maxCorrection, e); m.x = snap.x; m.y = snap.y; corr = null; }
          else if (e > 0.6) { res.corrections++; res.maxCorrection = Math.max(res.maxCorrection, e); corr = { x: snap.x - m.x, y: snap.y - m.y, left: 0.15 }; }
          return;
        }
        if (snap.q !== undefined) res.acks++;
        const r = reconcileMove(hist, snap, m);
        if (r.kind !== 'none') { res.maxCorrection = Math.max(res.maxCorrection, r.err); if (r.kind === 'snap') { res.snaps++; m.x = snap.x; m.y = snap.y; corr = null; } else { res.corrections++; corr = { x: r.dx, y: r.dy, left: 0.15 }; } }
      });
    }
  }
  return res;
}
