import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  PROTEST_TARGET_OWNER,
  targetFarmIds,
  targetResortFarmIds,
  plotByFarmId,
  farmPerimeterPoints,
  farmProtestBudget,
  spawnFarmCluster,
  clusterZone,
  onAnyFarmPad,
  MAX_FARM_PROTESTERS,
  PER_FARM_COUNT,
  type OwnedProp,
} from '../client/src/lib/farmProtest';
import { planFarmProtestSites } from '../client/src/lib/farmProtest3d';
import { stepProtesters, MIN_SEP } from '../client/src/lib/townHallProtest';
import {
  makeProtestSfx,
  sharedProtestSfx,
  disposeSharedProtestSfx,
  PROTEST_MAX_VOICES,
  PROTEST_CHANT_COOLDOWN_MS,
} from '../client/src/lib/protestSfx';
import { farmPlots, plotId } from '../shared/farm';
import { roadClearance } from '../client/src/lib/worldLayout';
import { setMuted, setVolume } from '../client/src/lib/sounds';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CARTER2_LIVE = ['f:1', 'f:2', 'f:3', 'f:4', 'f:5', 'f:7', 'f:11', 'f:12', 'f:13'];

function ownedOf(pairs: Array<[string, string]>): OwnedProp[] {
  return pairs.map(([id, owner]) => ({ id, owner }));
}

describe('Farm protest targeting (owner)', () => {
  it('PROTEST_TARGET_OWNER is the verified carter2 handle (not plain carter)', () => {
    expect(PROTEST_TARGET_OWNER).toBe('carter2');
  });

  it('selects only f:* farms for the target owner (case-insensitive)', () => {
    const owned = ownedOf([
      ['f:1', 'carter2'],
      ['f:2', 'Carter2'],
      ['f:3', 'alice'],
      ['b:1', 'carter2'],
      ['rf:1', 'carter2'],
      ['f:99', 'carter'],
    ]);
    expect(targetFarmIds(owned)).toEqual(['f:1', 'f:2']);
    expect(targetResortFarmIds(owned)).toEqual(['rf:1']);
    expect(targetFarmIds(owned, 'alice')).toEqual(['f:3']);
  });

  it('empties when target sells all farms', () => {
    const before = ownedOf(CARTER2_LIVE.map((id) => [id, 'carter2']));
    expect(targetFarmIds(before).length).toBe(9);
    const after = ownedOf(CARTER2_LIVE.map((id) => [id, 'bob']));
    expect(targetFarmIds(after)).toEqual([]);
    const plan = planFarmProtestSites(after);
    expect(plan.farmIds).toEqual([]);
    expect(plan.total).toBe(0);
  });

  it('plan matches live carter2 city farm set and skips resort (none owned)', () => {
    const owned = ownedOf([
      ...CARTER2_LIVE.map((id) => [id, 'carter2'] as [string, string]),
      ['f:6', 'other'],
    ]);
    const plan = planFarmProtestSites(owned, false);
    expect(plan.owner).toBe('carter2');
    expect(plan.resortIds).toEqual([]);
    expect(plan.farmIds.length).toBeGreaterThan(0);
    expect(plan.farmIds.every((id) => CARTER2_LIVE.includes(id))).toBe(true);
    expect(plan.total).toBeLessThanOrEqual(MAX_FARM_PROTESTERS);
    expect(plan.perFarm).toBe(PER_FARM_COUNT);
  });
});

describe('Farm protest placement safety', () => {
  it('perimeter points sit outside crop pads, off lanes, and not on road centreline', () => {
    for (const id of CARTER2_LIVE) {
      const plot = plotByFarmId(id);
      expect(plot, id).toBeTruthy();
      const pts = farmPerimeterPoints(plot!, 3, 42 + plot!.n);
      // may be sparse on tight plots but at least one when possible
      expect(pts.length).toBeGreaterThanOrEqual(1);
      for (const p of pts) {
        expect(onAnyFarmPad(p.x, p.z, 0.15), `${id} on pad ${p.x},${p.z}`).toBe(false);
        expect(roadClearance(p.x, p.z, 8)).toBeGreaterThanOrEqual(0.2);
      }
    }
  });

  it('cluster mills stay inside their local zone without invading the pad', () => {
    const plot = plotByFarmId('f:4')!;
    const pts = farmPerimeterPoints(plot, 3, 99);
    const states = spawnFarmCluster(pts, plot.x, plot.z, 7, 200);
    const zone = clusterZone(states);
    let t = 0;
    for (let i = 0; i < 180; i++) {
      t += 1 / 30;
      stepProtesters(states, 1 / 30, t, {
        reducedMotion: false, allowBubbles: true, zone, aisle: 0,
        reject: (lx, lz) => onAnyFarmPad(plot.x + lx, plot.z + lz, 0.15),
      });
      for (const s of states) {
        expect(s.lx).toBeGreaterThanOrEqual(zone.lx0 - 0.01);
        expect(s.lx).toBeLessThanOrEqual(zone.lx1 + 0.01);
        expect(s.lz).toBeGreaterThanOrEqual(zone.lz0 - 0.01);
        expect(s.lz).toBeLessThanOrEqual(zone.lz1 + 0.01);
        const wx = plot.x + s.lx, wz = plot.z + s.lz;
        expect(onAnyFarmPad(wx, wz, 0.12)).toBe(false);
      }
    }
  });

  it('spawn separation is roughly respected', () => {
    const plot = plotByFarmId('f:12')!;
    const pts = farmPerimeterPoints(plot, 3, 11);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)).toBeGreaterThanOrEqual(MIN_SEP * 0.9);
    }
  });
});

describe('Farm protest budgets', () => {
  it('caps total NPCs across many farms', () => {
    const many = farmPlots().map((p) => plotId(p.n));
    const b = farmProtestBudget(many.length, false);
    expect(b.total).toBeLessThanOrEqual(MAX_FARM_PROTESTERS);
    expect(b.farmsUsed * b.perFarm).toBe(b.total);
    const low = farmProtestBudget(many.length, true);
    expect(low.total).toBeLessThanOrEqual(MAX_FARM_PROTESTERS);
    expect(low.perFarm).toBeLessThan(PER_FARM_COUNT);
  });

  it('zero farms → zero budget', () => {
    expect(farmProtestBudget(0, false)).toEqual({ perFarm: 0, total: 0, farmsUsed: 0 });
  });
});

describe('Shared protest audio caps across City Hall + farms', () => {
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
    disposeSharedProtestSfx();
  });
  afterEach(() => {
    disposeSharedProtestSfx();
    setVolume(0.4);
    setMuted(false);
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('sharedProtestSfx is a singleton — one voice/cooldown pool for all groups', () => {
    let now = 0;
    // seed shared with fake clock via first make then replace — shared uses makeProtestSfx internally
    const a = sharedProtestSfx();
    const b = sharedProtestSfx();
    expect(a).toBe(b);
    a.chant(5, true);
    const v = a.voices;
    b.chant(5, true); // same cooldown
    expect(b.voices).toBe(v);
    disposeSharedProtestSfx();
    const c = sharedProtestSfx();
    expect(c).not.toBe(a);
  });

  it('voice cap still holds when many farm sites would chant', () => {
    const Ctx = (() => {
      let nodes = 0;
      class Osc { connect() { return this; } start() {} stop() {} frequency = { value: 0 }; type = 'sine'; }
      class Gain { connect() { return this; } gain = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
      class FakeCtx {
        state = 'running';
        currentTime = 0;
        destination = {};
        createOscillator() { nodes++; return new Osc(); }
        createGain() { return new Gain(); }
        resume() { return Promise.resolve(); }
        close() { return Promise.resolve(); }
      }
      return FakeCtx as unknown as new () => AudioContext;
    })();
    let now = 0;
    const sfx = makeProtestSfx(Ctx, () => now);
    for (let i = 0; i < 12; i++) {
      now += 40;
      sfx.shout(4);
    }
    expect(sfx.voices).toBeLessThanOrEqual(PROTEST_MAX_VOICES + 3);
    now += PROTEST_CHANT_COOLDOWN_MS + 10;
    sfx.chant(4, true);
    expect(sfx.voices).toBeLessThanOrEqual(PROTEST_MAX_VOICES + 4);
    sfx.dispose();
  });
});

describe('Farm protest — no player-facing changelog', () => {
  it('shared/changelog.ts has no farm-protest / carter farm crowd entry', () => {
    const raw = readFileSync(resolve('shared/changelog.ts'), 'utf8');
    expect(raw.toLowerCase()).not.toMatch(/farm.?protest/);
    expect(raw.toLowerCase()).not.toMatch(/outside (his|carter)/);
  });
});
