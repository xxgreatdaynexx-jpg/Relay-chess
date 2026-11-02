import { describe, it, expect } from 'vitest';
import { modeStatus, clockOf } from '../client/src/lib/arenaModeHud';
import type { ModeView } from '../shared/arenaModes';

const names = (id: string) => id.toUpperCase();
const snd = (bomb: NonNullable<ModeView['snd']>['bomb'], extra: Partial<NonNullable<ModeView['snd']>> = {}): ModeView => ({
  mode: 'snd', teams: { score: [1, 0], size: [3, 3], alive: [3, 2] }, tm: { me: 0, foe: 1 },
  snd: { round: 2, attackers: 0, phase: 'live', left: 60000, sites: [], bomb, ...extra },
});

describe('arena mode HUD text', () => {
  it('formats clocks', () => { expect(clockOf(65000)).toBe('1:05'); expect(clockOf(-5)).toBe('0:00'); });
  it('tells the bomb carrier how to plant', () => {
    const s = modeStatus(snd({ state: 'carried', x: 0, y: 0, z: 0, carrier: 'me' }), 'me', names);
    expect(s.line).toContain('ATTACK'); expect(s.line).toContain('YOU HAVE THE BOMB'); expect(s.hint).toMatch(/plant/);
  });
  it('tells defenders to defuse a planted bomb', () => {
    const s = modeStatus(snd({ state: 'planted', x: 0, y: 0, z: 0, site: 'A', left: 20000 }, { phase: 'planted' }), 'foe', names);
    expect(s.line).toContain('DEFEND'); expect(s.line).toContain('BOMB PLANTED A · 0:20'); expect(s.hint).toMatch(/defuse/);
  });
  it('shows CTF flag states from my side', () => {
    const mv: ModeView = { mode: 'ctf', teams: { score: [0, 0], size: [2, 2], alive: [2, 2] }, tm: { me: 0 }, ctf: { left: 1, bases: [], flags: [
      { team: 0, state: 'dropped', x: 0, y: 0, z: 0, returnIn: 9000 }, { team: 1, state: 'carried', x: 0, y: 0, z: 0, carrier: 'me' }] } };
    const s = modeStatus(mv, 'me', names);
    expect(s.line).toBe('YOUR FLAG: dropped 0:09 · ENEMY FLAG: YOU');
    expect(s.hint).toMatch(/must be home/);
  });
});
