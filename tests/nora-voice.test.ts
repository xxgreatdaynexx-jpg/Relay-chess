import { describe, expect, it } from 'vitest';
import { NORA_VOICE_AUDIO, PopupStore, seedNoraVoice } from '../server/popups.js';

describe('nora voice popup', () => {
  it('queues only for jay, conner, carter2 (case-insensitive) and once', async () => {
    const s = new PopupStore();
    await seedNoraVoice(s); await seedNoraVoice(s);
    for (const n of ['Jay', 'CONNER', 'carter2']) {
      const p = await s.pending(n);
      expect(p).toHaveLength(1); expect(p[0].audio).toBe(NORA_VOICE_AUDIO);
      expect(p[0].title).toBe('A message from Nora, Chief of Staff');
    }
    for (const n of ['carter', 'arenagawd', 'jay2', 'dayne']) expect(await s.pending(n)).toHaveLength(0);
    expect(await s.ack('conner', 'nora-voice-1:jay')).toBe(false);
    expect(await s.ack('Jay', 'nora-voice-1:jay')).toBe(true);
    await seedNoraVoice(s);
    expect(await s.pending('jay')).toHaveLength(0);
  });
});
