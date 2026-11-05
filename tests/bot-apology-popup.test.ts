import { describe, expect, it } from 'vitest';
import { BOT_APOLOGY_BODIES, BOT_APOLOGY_PHRASE, BOT_APOLOGY_TARGETS, matchesBotApology } from '../shared/botApologyPopup';
import { PopupStore, seedBotApology } from '../server/popups.js';

describe('bot apology popup', () => {
  it('uses exact curly-apostrophe phrase', () => {
    expect(BOT_APOLOGY_PHRASE).toContain('\u2019');
    expect(matchesBotApology(BOT_APOLOGY_PHRASE)).toBe(true);
    expect(matchesBotApology(BOT_APOLOGY_PHRASE.replace(/\u2019/g, "'"))).toBe(false);
    expect(matchesBotApology(BOT_APOLOGY_PHRASE + ' ')).toBe(false);
  });

  it('queues only for carter2, Conner, Jay once, with confirmText', async () => {
    const s = new PopupStore();
    await seedBotApology(s); await seedBotApology(s);
    for (const t of BOT_APOLOGY_TARGETS) {
      const p = await s.pending(t.player);
      expect(p).toHaveLength(1);
      expect(p[0].id).toBe(t.id);
      expect(p[0].confirmText).toBe(BOT_APOLOGY_PHRASE);
      expect(p[0].text).toBe(BOT_APOLOGY_BODIES[t.key]);
      expect(p[0].title).toBe('A message from Nora, Chief of Staff');
    }
    for (const n of ['carter', 'arenagawd', 'jay2', 'dayne']) expect(await s.pending(n)).toHaveLength(0);
    expect(await s.ack('conner', 'nora-bot-apology-1:jay')).toBe(false);
    expect(await s.ack('Jay', 'nora-bot-apology-1:jay')).toBe(true);
    await seedBotApology(s);
    expect(await s.pending('jay')).toHaveLength(0);
  });
});
