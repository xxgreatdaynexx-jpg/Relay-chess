import { describe, expect, it } from 'vitest';
import { gridMap, TICK_HZ } from '../shared/fps.js';
import { INPUT_SEND_MS } from '../shared/arenaPredict.js';
import { ArenaWorld } from '../server/arena-world.js';
import { ArenaAntiCheat, FLICK_DEG, type ArenaFlag } from '../server/arena-anticheat.js';

const OPEN = gridMap(['#############', '#...........#', '#...........#', '#...........#', '#############']);

describe('arena rates', () => {
  it('server ticks at 30 Hz and the client sends one move packet per tick', () => {
    expect(TICK_HZ).toBe(30);
    expect(INPUT_SEND_MS).toBeLessThanOrEqual(1000 / TICK_HZ);
    expect(INPUT_SEND_MS).toBeGreaterThanOrEqual(25); // server accepts at most ~40 moves/s
  });
});

describe('anti-cheat with 60 Hz batched aim', () => {
  const mk = () => { const ac = new ArenaAntiCheat(() => {}, (_i, n) => n); ac.join('x', 'x'); return ac; };
  it('a 90° snap split across 60 Hz samples is still a flick', () => {
    const ac = mk();
    let t = 1000, last = 0;
    ac.aim('x', 0, 0, t);
    for (let i = 1; i <= 4; i++) last = ac.aim('x', (Math.PI / 2) * (i / 4), 0, t += 16);
    expect(last * 180 / Math.PI).toBeGreaterThanOrEqual(FLICK_DEG);
  });
  it('a smooth human turn (90° over 400 ms) is not', () => {
    const ac = mk();
    let t = 1000, worst = 0;
    ac.aim('x', 0, 0, t);
    for (let i = 1; i <= 25; i++) worst = Math.max(worst, ac.aim('x', (Math.PI / 2) * (i / 25), 0, t += 16));
    expect(worst).toBe(0);
  });
  it('world.move feeds batched samples to the audit; a snap delivered in one batch flags on the shot', () => {
    const flags: ArenaFlag[] = [];
    const w = new ArenaWorld(OPEN, () => 0.5);
    w.audit = new ArenaAntiCheat((f) => flags.push(f), (_i, n) => n);
    const a = w.join('a', 'Ann', 0);
    Object.assign(a, { x: 2.5, y: 2.5, a: Math.PI, p: 0 });
    w.move('a', 2.5, 2.5, Math.PI, 1000, 0, false, false, 1);
    // Next packet: samples swinging from 180° to 0° over 48 ms, then the final pose.
    w.move('a', 2.5, 2.5, 0, 1032, 0, false, false, 2, [[48, Math.PI * 0.75, 0], [32, Math.PI * 0.4, 0], [16, 0.1, 0]]);
    const flick = w.audit.aim('a', 0, 0, 1040);
    expect(flick * 180 / Math.PI).toBeGreaterThanOrEqual(FLICK_DEG);
  });
  it('junk batches are ignored safely', () => {
    const w = new ArenaWorld(OPEN, () => 0.5);
    w.audit = new ArenaAntiCheat(() => {}, (_i, n) => n);
    w.join('a', 'Ann', 0);
    expect(() => w.move('a', 2.5, 2.5, 0, 1000, 0, false, false, 1, [null, 'x', [NaN, 'a', {}], [1e9, 0, 0]] as never)).not.toThrow();
  });
});
