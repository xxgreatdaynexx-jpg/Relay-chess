import { describe, expect, it } from 'vitest';
import { BOT_APOLOGY_BODIES, BOT_APOLOGY_PHRASE, BOT_APOLOGY_TARGETS, matchesBotApology } from '../shared/botApologyPopup';
import {
  CARTER2_SOFT_APOLOGY_ID,
  CARTER2_SOFT_APOLOGY_TEXT,
  PopupStore,
  seedBotApology,
  seedCarter2SoftApology,
} from '../server/popups.js';

describe('bot apology popup', () => {
  it('uses exact curly-apostrophe phrase', () => {
    expect(BOT_APOLOGY_PHRASE).toContain('\u2019');
    expect(matchesBotApology(BOT_APOLOGY_PHRASE)).toBe(true);
    expect(matchesBotApology(BOT_APOLOGY_PHRASE.replace(/\u2019/g, "'"))).toBe(false);
    expect(matchesBotApology(BOT_APOLOGY_PHRASE + ' ')).toBe(false);
  });

  it('queues only for Conner and Jay once, with confirmText (carter2 removed)', async () => {
    const s = new PopupStore();
    await seedBotApology(s); await seedBotApology(s);
    expect(BOT_APOLOGY_TARGETS.map((t) => t.key)).toEqual(['conner', 'jay']);
    for (const t of BOT_APOLOGY_TARGETS) {
      const p = await s.pending(t.player);
      expect(p).toHaveLength(1);
      expect(p[0].id).toBe(t.id);
      expect(p[0].confirmText).toBe(BOT_APOLOGY_PHRASE);
      expect(p[0].text).toBe(BOT_APOLOGY_BODIES[t.key]);
      expect(p[0].title).toBe('A message from Nora, Chief of Staff');
    }
    for (const n of ['carter2', 'carter', 'arenagawd', 'jay2', 'dayne']) expect(await s.pending(n)).toHaveLength(0);
    expect(await s.ack('conner', 'nora-bot-apology-1:jay')).toBe(false);
    expect(await s.ack('Jay', 'nora-bot-apology-1:jay')).toBe(true);
    await seedBotApology(s);
    expect(await s.pending('jay')).toHaveLength(0);
  });

  it('forceAck clears carter2 harsh id and soft seed has no confirmText', async () => {
    const s = new PopupStore();
    await s.seed({
      id: 'nora-bot-apology-1:carter2',
      player: 'carter2',
      from: 'Nora, Chief of Staff',
      text: 'harsh',
      createdAt: 1,
      ackedAt: null,
      title: 'A message from Nora, Chief of Staff',
      confirmText: BOT_APOLOGY_PHRASE,
    });
    expect(await s.status('nora-bot-apology-1:carter2')).toBe('queued');
    expect(await s.forceAck('nora-bot-apology-1:carter2')).toBe(true);
    expect(await s.status('nora-bot-apology-1:carter2')).toBe('delivered');
    expect(await s.forceAck('nora-bot-apology-1:carter2')).toBe(false);
    expect(await s.pending('carter2')).toHaveLength(0);

    await seedCarter2SoftApology(s);
    await seedCarter2SoftApology(s);
    const soft = await s.pending('carter2');
    expect(soft).toHaveLength(1);
    expect(soft[0].id).toBe(CARTER2_SOFT_APOLOGY_ID);
    expect(soft[0].confirmText).toBeNull();
    expect(soft[0].text).toBe(CARTER2_SOFT_APOLOGY_TEXT);
    expect(soft[0].text).toMatch(/sorry/i);
    expect(soft[0].text).toMatch(/not banned/i);
    expect(soft[0].text).toMatch(/soft-disable is off/i);
    expect(soft[0].text).toMatch(/hub sleep/i);
    expect(soft[0].text).toMatch(/just hit OK/i);
    expect(soft[0].text).not.toMatch(/type exactly/i);
  });
});
