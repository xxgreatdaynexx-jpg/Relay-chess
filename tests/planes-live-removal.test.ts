// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const handlers = new Map<string, (x: unknown) => void>();
vi.mock('../client/src/lib/net', () => ({ socket: { connected: false, on: (e: string, f: (x: unknown) => void) => handlers.set(e, f), off: (e: string) => handlers.delete(e), emit: () => {} } }));
vi.mock('../client/src/lib/labelSprite', () => ({ cityLabel: () => { const t = new THREE.Texture(); t.userData = { w: 100, h: 20 }; return t; } }));
HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}) })) as never;

const { createFreight } = await import('../client/src/lib/worldFreight');

describe('client freight traffic: a plane is drawn only while its live entry exists', () => {
  it('adds a genuine player plane, then removes it when the server drops the entry (cancel/arrival)', () => {
    const scene = new THREE.Scene(); const f = createFreight({ scene }, 'city');
    expect(f.live.size).toBe(0);
    const now = Date.now();
    const v = { id: 'plane:1:out', mode: 'plane', label: 'Freight plane · QA', owner: 'QA', color: 0xffffff, from: 'city', to: 'resort', departAt: now - 1000, arriveAt: now + 60_000, loads: 1, units: 5 };
    handlers.get('freight_live')!([v]); expect([...f.live.keys()]).toEqual(['plane:1:out']);
    const obj = f.live.get('plane:1:out')!.obj; expect(scene.children).toContain(obj);
    handlers.get('freight_live')!([]); expect(f.live.size).toBe(0); expect(scene.children).not.toContain(obj);
    f.dispose();
  });
});
