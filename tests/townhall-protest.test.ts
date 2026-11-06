import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  spawnProtesters,
  stepProtesters,
  inProtestZone,
  protestWorldXZ,
  protestUpdateBudget,
  PROTEST_ZONE,
  ENTRANCE_AISLE,
  MIN_SEP,
  CHANT_SLOGANS,
  PROTEST_COUNT_DEFAULT,
} from '../client/src/lib/townHallProtest';
import {
  makeProtestSfx,
  PROTEST_MAX_VOICES,
  PROTEST_CHANT_COOLDOWN_MS,
  PROTEST_AUDIO_MAX_DIST,
} from '../client/src/lib/protestSfx';
import { landmarks, clearOfRoads } from '../client/src/lib/worldLayout';
import { setMuted, setVolume, getVolume, isMuted } from '../client/src/lib/sounds';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Town Hall protest crowd (movement)', () => {
  it('spawns inside the front plaza, off the entrance aisle, and clear of roads', () => {
    const hall = landmarks()['cityhall']!;
    const list = spawnProtesters(42, PROTEST_COUNT_DEFAULT);
    expect(list.length).toBe(PROTEST_COUNT_DEFAULT);
    for (const p of list) {
      expect(inProtestZone(p.lx, p.lz), `out of zone ${p.lx},${p.lz}`).toBe(true);
      expect(Math.abs(p.lx)).toBeGreaterThanOrEqual(ENTRANCE_AISLE * 0.9);
      const { x, z } = protestWorldXZ(hall.x, hall.z, hall.rot, p.lx, p.lz);
      expect(clearOfRoads({ x, z, w: 0.6, d: 0.6, rot: 0 }, 0.35), `on road @ ${x.toFixed(2)},${z.toFixed(2)}`).toBe(true);
    }
    // no heavy overlaps at spawn
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const d = Math.hypot(list[i]!.lx - list[j]!.lx, list[i]!.lz - list[j]!.lz);
      expect(d).toBeGreaterThan(MIN_SEP * 0.55);
    }
  });

  it('mills along irregular paths without leaving the zone or lockstepping', () => {
    const list = spawnProtesters(7, 12);
    const start = list.map((p) => ({ lx: p.lx, lz: p.lz }));
    let t = 0;
    for (let i = 0; i < 240; i++) {
      t += 1 / 30;
      stepProtesters(list, 1 / 30, t, { reducedMotion: false, allowBubbles: true });
      for (const p of list) expect(inProtestZone(p.lx, p.lz, 0.05)).toBe(true);
    }
    // moved (not frozen idle)
    const moved = list.filter((p, i) => Math.hypot(p.lx - start[i]!.lx, p.lz - start[i]!.lz) > 0.35).length;
    expect(moved).toBeGreaterThanOrEqual(8);
    // not lockstep: pairwise deltas differ
    const dx = list.map((p, i) => p.lx - start[i]!.lx);
    const unique = new Set(dx.map((v) => v.toFixed(2)));
    expect(unique.size).toBeGreaterThan(3);
    // some bubbles / slogans fired
    expect(CHANT_SLOGANS.length).toBeGreaterThanOrEqual(2);
    expect(list.some((p) => p.bubbleUntil > 0)).toBe(true);
  });

  it('reduced motion freezes travel and suppresses bubbles', () => {
    const list = spawnProtesters(3, 10);
    const snap = list.map((p) => ({ lx: p.lx, lz: p.lz }));
    let t = 0;
    for (let i = 0; i < 90; i++) {
      t += 1 / 30;
      stepProtesters(list, 1 / 30, t, { reducedMotion: true });
    }
    for (let i = 0; i < list.length; i++) {
      expect(list[i]!.lx).toBeCloseTo(snap[i]!.lx, 5);
      expect(list[i]!.lz).toBeCloseTo(snap[i]!.lz, 5);
      expect(list[i]!.bubbleUntil).toBe(-1);
    }
  });

  it('performance budget skips far cameras and caps low-detail count', () => {
    expect(protestUpdateBudget(120, false).step).toBe(false);
    expect(protestUpdateBudget(40, true).count).toBeLessThan(protestUpdateBudget(40, false).count);
    expect(protestUpdateBudget(70, false).bubbles).toBe(false);
    expect(protestUpdateBudget(20, false).bubbles).toBe(true);
  });

  it('plaza world sample stays within the City Hall front pad (not behind the building)', () => {
    const hall = landmarks()['cityhall']!;
    // local +lz is toward the street in front; with rot=-π/2 that is −X in world
    const front = protestWorldXZ(hall.x, hall.z, hall.rot, 0, 7);
    const behind = protestWorldXZ(hall.x, hall.z, hall.rot, 0, -4);
    expect(front.x).toBeLessThan(hall.x);
    expect(behind.x).toBeGreaterThan(hall.x);
    expect(PROTEST_ZONE.lz0).toBeGreaterThan(4);
  });
});

/** Minimal fake WebAudio that counts live (connected) nodes — same shape as fishing-sync. */
function fakeAudio() {
  const st = { connected: 0, created: 0, closed: false, sources: [] as Array<{ onended: (() => void) | null; stopped: boolean }> };
  const node = () => { st.created++; let on = false; return { connect(n: unknown) { if (!on) { on = true; st.connected++; } return n; }, disconnect() { if (on) { on = false; st.connected--; } } }; };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class Ctx {
    currentTime = 0; sampleRate = 8000; state = 'running'; destination = {};
    createGain() { return { ...node(), gain: param() }; }
    createBiquadFilter() { return { ...node(), type: '', frequency: param(), Q: param() }; }
    createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
    private src() { const s = { ...node(), onended: null as (() => void) | null, stopped: false, start() {}, stop() { s.stopped = true; } }; st.sources.push(s); return s; }
    createBufferSource() { return Object.assign(this.src(), { buffer: null }); }
    createOscillator() { const s = this.src(); return Object.assign(s, { type: '', frequency: param() }); }
    async close() { st.closed = true; }
  }
  return { st, Ctx: Ctx as unknown as new () => AudioContext };
}

describe('Town Hall protest crowd (audio settings)', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
    setVolume(0.5);
    setMuted(false);
  });
  afterEach(() => {
    setVolume(0.4);
    setMuted(false);
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('respects mute, volume, distance falloff, cooldown, voice cap, and dispose', () => {
    const { st, Ctx } = fakeAudio();
    let now = 0;
    const sfx = makeProtestSfx(Ctx, () => now);

    setMuted(true);
    sfx.chant(10, true);
    expect(sfx.voices).toBe(0);
    expect(sfx.lastGain).toBe(0);

    setMuted(false);
    setVolume(0.8);
    now = 100;
    sfx.chant(8, true);
    expect(sfx.voices).toBeGreaterThan(0);
    expect(sfx.lastGain).toBeGreaterThan(0.3);

    // cooldown: immediate second chant ignored
    const v1 = sfx.voices;
    sfx.chant(8, true);
    expect(sfx.voices).toBe(v1);

    now += PROTEST_CHANT_COOLDOWN_MS + 50;
    // far = silent
    sfx.chant(PROTEST_AUDIO_MAX_DIST + 5);
    expect(sfx.lastGain).toBe(0);

    now += PROTEST_CHANT_COOLDOWN_MS + 50;
    for (let i = 0; i < 10; i++) {
      now += 50;
      sfx.shout(5);
    }
    expect(sfx.voices).toBeLessThanOrEqual(PROTEST_MAX_VOICES + 3); // shout stacks tones; gate caps starts

    sfx.stopAll();
    expect(sfx.voices).toBe(0);
    sfx.dispose();
    expect(st.closed).toBe(true);
    now += 5000;
    sfx.chant(5, true);
    expect(sfx.voices).toBe(0);
    expect(getVolume()).toBe(0.8);
    expect(isMuted()).toBe(false);
  });
});

describe('Town Hall protest — no player-facing changelog entry', () => {
  it('shared/changelog.ts has no new protest / Town Hall crowd entry', () => {
    const raw = readFileSync(resolve('shared/changelog.ts'), 'utf8');
    expect(raw.toLowerCase()).not.toMatch(/protest/);
    expect(raw.toLowerCase()).not.toMatch(/town hall crowd/);
    expect(raw.toLowerCase()).not.toMatch(/no carter/);
  });
});
