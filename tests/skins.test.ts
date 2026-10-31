import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CASE_ODDS, rollSkin, SKINS, SKIN_BY_ID, SKIN_WEAPONS, lookKey, parseToken } from '../shared/skins';
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
  it('rolls 79/19/2', () => {
    const n = 100_000; const got = { common: 0, rare: 0, ultra: 0 };
    for (let i = 0; i < n; i++) got[rollSkin((i + 0.5) / n, Math.random()).rarity]++;
    expect(got.ultra / n).toBeCloseTo(CASE_ODDS.ultra, 3);
    expect(got.rare / n).toBeCloseTo(CASE_ODDS.rare, 3);
  });
});

describe('drops, opening, equip', () => {
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
