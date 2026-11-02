import { describe, expect, it } from 'vitest';
import { anglerStates, anglersHere, leaveDock, markHere, HERE_MS } from '../server/fishing';
import { anglerAim } from '../shared/fishing';
import { makeFishingSfx, MAX_VOICES, OTHER_VOL } from '../client/src/lib/fishingSfx';

describe('other anglers see your fishing (pt242u)', () => {
  it('tracks pose per angler, hides your own, clears the fish when the pose moves on', () => {
    const t = 5_000_000;
    markHere('Cast1', t, { pose: 'cast', yaw: 0.3, power: 0.8 });
    markHere('Reel1', t, { pose: 'cast' }); markHere('Reel1', t + 10, { pose: 'reel' });
    markHere('Got1', t, { pose: 'catch', fish: 'koi' });
    const s = anglerStates('Got1', t + 20);
    expect(s.find((a) => a.name === 'Cast1')).toMatchObject({ pose: 'cast', yaw: 0.3, power: 0.8, since: t });
    expect(s.find((a) => a.name === 'Reel1')).toMatchObject({ pose: 'reel', since: t + 10 });
    expect(s.some((a) => a.name === 'Got1')).toBe(false);
    expect(anglerStates(null, t + 20).find((a) => a.name === 'Got1')?.fish).toBe('koi');
    markHere('Got1', t + 30); // a plain action keeps the pose and since
    expect(anglerStates(null, t + 31).find((a) => a.name === 'Got1')).toMatchObject({ pose: 'catch', since: t });
    markHere('Got1', t + 40, { pose: 'cast' });
    expect(anglerStates(null, t + 41).find((a) => a.name === 'Got1')?.fish).toBeUndefined();
    expect(anglersHere(null, t + 41)).toEqual(expect.arrayContaining(['Cast1', 'Reel1', 'Got1']));
    expect(leaveDock('Cast1')).toBe(true); expect(anglersHere(null, t + 41)).not.toContain('Cast1');
    expect(anglerStates(null, t + 41 + HERE_MS + 1)).toEqual([]);
  });
  it('clamps the cosmetic aim/power a client sends', () => {
    expect(anglerAim(9, -2)).toEqual({ yaw: 0.75, power: 0 });
    expect(anglerAim('x', NaN)).toEqual({ yaw: 0, power: 0.5 });
  });
});

/** Minimal fake WebAudio that counts live (connected) nodes. */
function fakeAudio() {
  const st = { connected: 0, created: 0, closed: false, sources: [] as Array<{ onended: (() => void) | null; stopped: boolean }> };
  const node = () => { st.created++; let on = false; return { connect(n: unknown) { if (!on) { on = true; st.connected++; } return n; }, disconnect() { if (on) { on = false; st.connected--; } } }; };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class Ctx {
    currentTime = 0; sampleRate = 8000; state = 'running'; destination = {};
    createGain() { return { ...node(), gain: param() }; }
    createBiquadFilter() { return { ...node(), type: '', frequency: param() }; }
    createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
    private src() { const s = { ...node(), onended: null as (() => void) | null, stopped: false, start() {}, stop() { s.stopped = true; } }; st.sources.push(s); return s; }
    createBufferSource() { return Object.assign(this.src(), { buffer: null }); }
    createOscillator() { const s = this.src(); return Object.assign(s, { type: '', frequency: param() }); }
    async close() { st.closed = true; }
  }
  return { st, Ctx: Ctx as unknown as new () => AudioContext };
}

describe('fishing sound effects are cleaned up (pt242u)', () => {
  it('throttles repeats, caps voices, disconnects finished nodes and closes on dispose', () => {
    const { st, Ctx } = fakeAudio(); let now = 0; const sfx = makeFishingSfx(Ctx, () => now);
    sfx.click(); sfx.click(); sfx.click(); expect(sfx.voices).toBe(1); // no machine-gun clicks
    now = 500; for (let i = 0; i < 20; i++) { now += 1000; sfx.splash(true); sfx.plop(); sfx.whoosh(); sfx.win(); }
    expect(sfx.voices).toBeLessThanOrEqual(MAX_VOICES);
    for (const s of [...st.sources]) s.onended?.(); // every voice ends → all its nodes disconnect, only the master stays wired
    expect(sfx.voices).toBe(0); expect(st.connected).toBe(1);
    now += 1000; sfx.splash(false); sfx.plop(); expect(sfx.voices).toBe(2);
    sfx.stopAll(); expect(sfx.voices).toBe(0); expect(st.connected).toBe(1);
    sfx.dispose(); expect(st.closed).toBe(true); expect(st.connected).toBe(0);
    sfx.splash(true); expect(sfx.voices).toBe(0); // nothing plays after the dock closes
  });
  it("other anglers' splashes are quiet and throttled", () => {
    const { Ctx } = fakeAudio(); let now = 0; const sfx = makeFishingSfx(Ctx, () => now);
    expect(OTHER_VOL).toBeLessThan(0.5);
    sfx.splash(true, true); sfx.splash(true, true); sfx.splash(false, true); expect(sfx.voices).toBe(1);
    now = 1000; sfx.splash(true, true); expect(sfx.voices).toBe(2);
  });
});
