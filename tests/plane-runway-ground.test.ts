// @vitest-environment jsdom
/**
 * Regression: freight / own-jet models are built with the origin at the fuselage centre (nacelles hang lower),
 * while vehiclePose uses y=0 for loading, taxi, takeoff roll and landing roll. Placing the group at pose.y buried
 * the plane in the tarmac. The live-traffic loop must lift by the model's actual min-Y so the belly sits on the runway.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { arrivalOf, vehiclePose, type HubId, type LiveVehicle, type Mode } from '../shared/logistics';

const handlers = new Map<string, (x: unknown) => void>();
vi.mock('../client/src/lib/net', () => ({ socket: { connected: false, on: (e: string, f: (x: unknown) => void) => handlers.set(e, f), off: (e: string) => handlers.delete(e), emit: () => {} } }));
vi.mock('../client/src/lib/labelSprite', () => ({ cityLabel: () => { const t = new THREE.Texture(); t.userData = { w: 100, h: 20 }; return t; } }));
HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}) })) as never;

const { createFreight, plane, truck, RUNWAY_SURFACE_Y, modelMinY, freightAltitude } = await import('../client/src/lib/worldFreight');

const NOW = 1_700_000_000_000;
const hubs = ['city', 'resort', 'fortmc'] as const satisfies readonly HubId[];
const modes = ['plane', 'jet'] as const satisfies readonly Mode[];

function craft(mode: Mode, from: HubId, to: HubId, departAt: number): LiveVehicle {
  return { id: `${mode}:${from}:${to}:${departAt}`, mode, label: mode === 'jet' ? "QA's jet" : 'Freight plane · 3 shippers', owner: 'QA', color: 0xffffff, from, to, departAt, arriveAt: arrivalOf(mode === 'jet' ? 'jet' : 'plane', departAt), loads: 1, units: 3 };
}

/** Drive createFreight's 50ms pose loop and return the world-space bounds of the placed vehicle. */
function placedBox(hub: HubId, v: LiveVehicle, now: number): { box: THREE.Box3; phase: string; poseY: number } {
  vi.setSystemTime(now);
  const scene = new THREE.Scene(); const f = createFreight({ scene }, hub);
  handlers.get('freight_live')!([v]);
  vi.advanceTimersByTime(50);
  const obj = f.live.get(v.id)?.obj;
  expect(obj, `expected ${v.mode} ${v.id} to be drawn on ${hub}`).toBeTruthy();
  obj!.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj!);
  const ps = vehiclePose(v, now, hub);
  f.dispose();
  return { box, phase: ps.phase, poseY: ps.y };
}

describe('freight and jet aircraft sit on the runway', () => {
  afterEach(() => { vi.useRealTimers(); handlers.clear(); });

  it('the unplaced model extends below y=0 (fuselage origin / hanging nacelles) — the old pose.y placement would clip', () => {
    const minY = modelMinY(plane());
    expect(minY).toBeLessThan(-1); // nacelles hang well below the fuselage centre
    for (const hub of hubs) expect(minY).toBeLessThan(RUNWAY_SURFACE_Y[hub]);
    // old code: group at pose.y=0 ⇒ world bottom = minY, which is under every runway
    expect(0 + minY).toBeLessThan(RUNWAY_SURFACE_Y.city);
  });

  it('freightAltitude lifts the unplaced plane so its bottom meets the runway, and leaves trucks alone', () => {
    const p = plane();
    expect(freightAltitude('plane', 0, p, 'city') + modelMinY(p)).toBeCloseTo(RUNWAY_SURFACE_Y.city, 6);
    const tr = truck(0x3b82f6, false);
    expect(freightAltitude('truck', 0, tr, 'city')).toBe(0);
    expect(modelMinY(tr)).toBeGreaterThanOrEqual(-1e-6); // wheels sit on y=0
  });

  it('a jet still waiting to depart is not drawn (no parked private jet on the runway)', () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const scene = new THREE.Scene(); const f = createFreight({ scene }, 'city');
    const v = craft('jet', 'city', 'resort', NOW + 60_000);
    handlers.get('freight_live')!([v]); vi.advanceTimersByTime(50);
    const cur = f.live.get(v.id); expect(cur).toBeTruthy(); expect(cur!.obj.visible).toBe(false); expect(cur!.tag.visible).toBe(false);
    f.dispose();
  });

  describe.each(hubs)('%s', (hub) => {
    describe.each(modes)('%s', (mode) => {
      const travelOf = (m: Mode) => arrivalOf(m === 'jet' ? 'jet' : 'plane', NOW) - NOW;
      const dest = (h: HubId): HubId => (h === 'city' ? 'resort' : 'city');

      // Freight planes wait on the runway before the hourly departure (visible in 'loading').
      // Own jets are hidden until they actually depart — do not materialise a parked jet.
      type Phase = [string, (now: number) => { v: LiveVehicle; now: number; expectGround: boolean }];
      const phases: Phase[] = [
        ['taxi / takeoff roll (u=0)', (now) => ({ v: craft(mode, hub, dest(hub), now), now, expectGround: true })],
        ['taxi / takeoff roll (u=0.05)', (now) => { const t = travelOf(mode); return { v: craft(mode, hub, dest(hub), now - 0.05 * t), now, expectGround: true }; }],
        ['just after rotate (u=0.13)', (now) => { const t = travelOf(mode); return { v: craft(mode, hub, dest(hub), now - 0.13 * t), now, expectGround: false }; }],
        ['cruise (u=0.5)', (now) => { const t = travelOf(mode); return { v: craft(mode, hub, dest(hub), now - 0.5 * t), now, expectGround: false }; }],
        ['landing flare (u=0.85 inbound)', (now) => { const t = travelOf(mode); return { v: craft(mode, dest(hub), hub, now - 0.85 * t), now, expectGround: false }; }],
        ['landing roll (u=0.90 inbound)', (now) => { const t = travelOf(mode); return { v: craft(mode, dest(hub), hub, now - 0.90 * t), now, expectGround: true }; }],
        ['landing roll (u=0.98 inbound)', (now) => { const t = travelOf(mode); return { v: craft(mode, dest(hub), hub, now - 0.98 * t), now, expectGround: true }; }],
      ];
      if (mode === 'plane') phases.unshift(['loading (parked)', (now) => ({ v: craft(mode, hub, dest(hub), now + 60_000), now, expectGround: true })]);

      it.each(phases)('%s: bottom Y >= runway surface (createFreight placement)', (label, make) => {
        vi.useFakeTimers();
        const { v, now, expectGround } = make(NOW);
        const { box, poseY } = placedBox(hub, v, now);
        const surface = RUNWAY_SURFACE_Y[hub];
        expect(box.min.y, `${label} poseY=${poseY}`).toBeGreaterThanOrEqual(surface - 1e-5);
        if (expectGround) {
          expect(poseY, `${label} should be on the ground`).toBe(0);
          // sit on the tarmac, not hover a belly-height above it
          expect(box.min.y).toBeLessThanOrEqual(surface + 0.02);
        } else {
          expect(poseY).toBeGreaterThan(0);
        }
      });
    });
  });
});
