import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CASE_ODDS, CASE_ODDS_TABLE, rollSkin, SKINS, SKIN_BY_ID, SKIN_WEAPONS, lookKey, parseToken } from '../shared/skins';
import { ItemVault, PgItemStore } from '../server/skins';
import { ArenaWorld } from '../server/arena-world';

const P = (name: string, ms = 120_000, kills = 0, deaths = 0) => ({ name, ms, kills, deaths });

describe('skins catalog + odds', () => {
  it('has exactly 30 common / 20 rare / 5 ultra per weapon, unique ids, names and looks', () => {
    for (const w of SKIN_WEAPONS) {
      const c = (r: string) => SKINS.filter((s) => s.weapon === w && s.rarity === r).length;
      expect([c('common'), c('rare'), c('ultra')]).toEqual([30, 20, 5]);
      const mine = SKINS.filter((s) => s.weapon === w);
      expect(new Set(mine.map(lookKey)).size).toBe(55);
      expect(new Set(mine.filter((s) => s.rarity === 'ultra').map((s) => s.fx)).size).toBe(5);
    }
    expect(SKINS.length).toBe(SKIN_WEAPONS.length * 55);
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    expect(new Set(SKINS.map((s) => s.name.toLowerCase())).size).toBe(SKINS.length);
    for (const bad of ['asiimov', 'dragon lore', 'howl', 'doppler', 'fade', 'redline', 'hyper beast', 'vulcan', 'fire serpent', 'printstream', 'neo-noir', 'case hardened', 'crimson web', 'tiger tooth'])
      expect(SKINS.some((s) => s.name.toLowerCase().includes(bad))).toBe(false);
  });
  it('keeps the original 55 ids stable', () => {
    for (const w of SKIN_WEAPONS) {
      for (let i = 0; i < 6; i++) expect(SKIN_BY_ID.has(`c-${w}-${i}`)).toBe(true);
      for (let i = 0; i < 4; i++) expect(SKIN_BY_ID.has(`r-${w}-${i}`)).toBe(true);
      expect(SKIN_BY_ID.has(`u-${w}-0`)).toBe(true);
    }
    expect(SKIN_BY_ID.get('u-pistol-0')!.name).toBe('Chudlord Ascended');
  });
  it('rolls the two-step case odds (1e6 seeded rolls)', () => {
    const seeded = (seed: number) => () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const n = 1_000_000; const rng = seeded(42); const got: Record<string, number> = {};
    for (let i = 0; i < n; i++) { const s = rollSkin(rng, true); const k = `${s.weapon === 'knife' ? 'knife' : 'gun'}:${s.rarity}`; got[k] = (got[k] ?? 0) + 1; }
    const sum = CASE_ODDS_TABLE.reduce((a, o) => a + o.p, 0);
    expect(sum).toBeCloseTo(1, 9);
    for (const o of CASE_ODDS_TABLE) {
      const p = (got[`${o.group}:${o.rarity}`] ?? 0) / n, sd = Math.sqrt(o.p * (1 - o.p) / n);
      expect(Math.abs(p - o.p)).toBeLessThan(5 * sd + 1e-6);
    }
    expect(CASE_ODDS.knife * CASE_ODDS.knifeTier.common).toBeCloseTo(0.016, 6);
    expect(CASE_ODDS.knife * CASE_ODDS.knifeTier.ultra).toBeCloseTo(0.0005, 6);
    // Knives not live: never dropped, gun tiers renormalised.
    const r2 = seeded(7); let k = 0, u = 0;
    for (let i = 0; i < 200_000; i++) { const s = rollSkin(r2, false); if (s.weapon === 'knife') k++; if (s.rarity === 'ultra') u++; }
    expect(k).toBe(0); expect(Math.abs(u / 200_000 - 0.02 / 0.98)).toBeLessThan(0.002);
  });
  it('one drop per participant per match, idempotent; skips short idle players', () => {
    const v = new ItemVault();
    const a = v.dropForMatch('m1', [P('QA Alice'), P('QA Idle', 5000), P('QA Fragger', 5000, 1)]);
    expect(a.map((d) => d.name)).toEqual(['QA Alice', 'QA Fragger']);
    expect(v.dropForMatch('m1', [P('QA Alice')])).toEqual([]);
    expect(v.inventory('qa alice')).toHaveLength(1);
    expect(['case', 'key']).toContain(v.inventory('QA Alice')[0]!.kind);
  });
  it('drops are ~50/50', () => {
    const v = new ItemVault(); let cases = 0;
    for (let i = 0; i < 4000; i++) cases += v.dropForMatch(`m${i}`, [P('QA X')])[0]!.item.kind === 'case' ? 1 : 0;
    expect(cases / 4000).toBeGreaterThan(0.45); expect(cases / 4000).toBeLessThan(0.55);
  });
  it('opening needs a case and a key, consumes both, and cannot double-spend', () => {
    let r = 0; const seq = [0.1, 0.9]; const v = new ItemVault(() => seq[r++ % 2]!);
    v.dropForMatch('a', [P('QA O')]); // 0.1 -> case
    expect(() => v.openCase('QA O')).toThrow(/Key/);
    r = 1; v.dropForMatch('b', [P('QA O')]); // 0.9 -> key
    const out = v.openCase('QA O');
    expect(out.reel[out.win]).toBe(v.inventory('QA O')[0]!.skin);
    expect(v.inventory('QA O').map((i) => i.kind)).toEqual(['skin']);
    expect(() => v.openCase('QA O')).toThrow(/Case/);
  });
  it('equip is one per weapon and feeds the arena loadout token', () => {
    const v = new ItemVault();
    const s1 = v.make('QA E', 'skin', 't1', 'test', SKINS.find((s) => s.weapon === 'smg')!)!;
    const s2 = v.make('QA E', 'skin', 't2', 'test', SKINS.filter((s) => s.weapon === 'smg')[1]!)!;
    v.equip('QA E', s1.id); v.equip('QA E', s2.id);
    expect(v.inventory('QA E').filter((i) => i.equipped).map((i) => i.id)).toEqual([s2.id]);
    expect(parseToken(v.loadout('QA E').smg)?.skin.id).toBe(s2.skin);
    expect(() => v.equip('QA Other', s2.id)).toThrow();
  });
});

describe('persistence', () => {
  it('survives a restart and stays idempotent', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const v1 = new ItemVault(); await v1.attach(new PgItemStore(pool));
    v1.dropForMatch('m9', [P('QA Persist')]); await v1.flush();
    const v2 = new ItemVault(); await v2.attach(new PgItemStore(pool));
    expect(v2.inventory('QA Persist')).toHaveLength(1);
    expect(v2.dropForMatch('m9', [P('QA Persist')])).toEqual([]);
  });
});

describe('arena match end hook', () => {
  it('fires once with participants before the next map', () => {
    const w = new ArenaWorld(); const seen: string[][] = [];
    w.onMatchEnd = (r) => seen.push(r.players.map((p) => p.name));
    w.join('s1', 'QA Hook', 0);
    const end = (w as unknown as { matchEndsAt: number }).matchEndsAt || 0;
    w.tick(end + 1); w.tick(end + 2);
    if (end) expect(seen).toEqual([['QA Hook']]);
  });
});
