import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { newDb } from 'pg-mem';
import { MayorLaws } from '../server/mayorLaws';
import { MAYOR_MIGRATION } from '../server/mayor';
import { lawRuleNote, LAW_RULE_NOTE_HEADING, LAW_RULE_NOTE_MAX } from '../shared/mayorLaws';
import { HOUSE_DAILY_BASE } from '../shared/mines';

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  await pool.query(MAYOR_MIGRATION);
  let now = Date.parse('2026-11-07T05:59:59Z');
  await pool.query('INSERT INTO mayor_terms (week, player_key, name, votes, starts_at, ends_at) VALUES ($1,$2,$3,1,$4,$5)', ['2026-11-02', 'alice', 'Alice', now - 10000, now + 86400000]);
  const laws = new MayorLaws(pool, () => now); await laws.init();
  return { pool, laws, set: (n: number) => { now = n; }, now: () => now };
}

const NOTE = '1. It benefits a single player. The cap applies to everyone, but only someone stockpiling at very large scale can actually use it, so the real winner is basically one player.\n2. It\'s a "remove all / delete all" bill. It doesn\'t change the cap, it wipes it out completely.\n3. It overrides core gameplay. The house cap is built into the game, not a lever the mayor controls, so a bill can\'t remove it.';

describe('lawRuleNote', () => {
  it('requires trimmed public text within the cap and keeps the heading copy name-free', () => {
    expect(lawRuleNote(`  ${NOTE}  `)).toBe(NOTE);
    for (const x of [null, undefined, '', '  ', 1, {}]) expect(() => lawRuleNote(x)).toThrow(/public note is required/i);
    expect(() => lawRuleNote('x'.repeat(LAW_RULE_NOTE_MAX + 1))).toThrow(/at most/);
    expect(LAW_RULE_NOTE_HEADING).toBe('Rules review: this bill would not be allowed because:');
    expect(`${LAW_RULE_NOTE_HEADING}\n${NOTE}`.toLowerCase()).not.toMatch(/dayne|conner|requested by|\bper\b|\badmin\b/);
  });
});

describe('admin public note on vetoed or denied official bills', () => {
  it('attaches a note to a vetoed bill without changing status, veto, or original text, and is idempotent', async () => {
    const s = await setup();
    await s.pool.query("UPDATE mayor_terms SET vice_key = 'vic', vice_name = 'Vic', vice_votes = 0, vice_settled = TRUE");
    const { bill } = await s.laws.submit('Alice', 'Henceforth and heremore there shall be no house sell cap. Freedom to the workers!');
    const v = await s.laws.veto('Vic', bill.number);
    expect(v.bill.status).toBe('vetoed');
    const notedAt = s.now() + 1; s.set(notedAt);
    const r = await s.laws.note(bill.number, NOTE);
    expect(r.already).toBe(false);
    expect(r.bill).toMatchObject({
      number: '1', title: 'Bill Chud 1', status: 'vetoed', vetoedBy: 'Vic', vetoedRole: 'vice',
      text: 'Henceforth and heremore there shall be no house sell cap. Freedom to the workers!',
      ruleNote: NOTE, by: 'Alice', day: '2026-11-06', denyReason: null,
    });
    expect(r.bill.vetoedAt).toBe(v.bill.vetoedAt);
    expect(r.bill.ruleNotedAt).toBe(notedAt);
    const again = await s.laws.note('1', NOTE);
    expect(again.already).toBe(true);
    expect(again.bill.ruleNote).toBe(NOTE);
    expect(again.bill.status).toBe('vetoed');
    await expect(s.laws.note('1', 'a different note would not apply')).rejects.toThrow('already has a public note');
    const hist = await s.laws.history();
    expect(hist.history[0]).toMatchObject({ number: '1', status: 'vetoed', vetoedBy: 'Vic', vetoedRole: 'vice', ruleNote: NOTE, text: 'Henceforth and heremore there shall be no house sell cap. Freedom to the workers!' });
    expect(hist.submittedToday).toBe(true);
    await s.pool.end();
  });

  it('can note a denied bill without changing the denial, and refuses pending or invalid bills', async () => {
    const s = await setup();
    const { bill } = await s.laws.submit('Alice', 'pending stays pending');
    await expect(s.laws.note(bill.number, NOTE)).rejects.toThrow('vetoed or denied');
    await expect(s.laws.note('99', NOTE)).rejects.toThrow('No such bill');
    await expect(s.laws.note('1; DROP', NOTE)).rejects.toThrow('Invalid bill number');
    s.set(Date.parse('2026-11-07T06:00:00Z'));
    const b2 = (await s.laws.submit('Alice', 'denied bill')).bill;
    const denied = await s.laws.deny(b2.number, 'Public denial reason.');
    const n = await s.laws.note(b2.number, NOTE);
    expect(n.bill).toMatchObject({ status: 'denied', denyReason: 'Public denial reason.', ruleNote: NOTE, text: 'denied bill', deniedAt: denied.bill.deniedAt });
    await s.pool.end();
  });

  it('does not change house-sell cap constants and has no economy side effects in the note path', () => {
    expect(HOUSE_DAILY_BASE).toBe(100_000);
    const src = readFileSync('server/mayorLaws.ts', 'utf8');
    const start = src.indexOf('async note(');
    expect(start).toBeGreaterThan(0);
    const fn = src.slice(start, src.indexOf('\n  }\n', start) + 6);
    expect(fn).toMatch(/rule_note/);
    expect(fn).not.toMatch(/status = /);
    expect(fn).not.toMatch(/houseCap|HOUSE_DAILY|transfer\(|getBank|sellCap|payoutFor/);
    expect(src).not.toContain('adminAuthorized');
  });

  it('the note route is admin-token only and is not a player socket event', () => {
    const mayor = readFileSync('server/mayor.ts', 'utf8');
    expect(mayor).toMatch(/\/api\/admin\/mayor\/note-bill[\s\S]{0,400}adminAuthorized\(req\.get\('authorization'\)\)/);
    expect(mayor).not.toMatch(/on\(['"]mayor_law_note['"]/);
    expect(HOUSE_DAILY_BASE).toBe(100_000);
  });
});
