import { describe, expect, it } from 'vitest';
import { Accounts, MemoryAccountStore, UnavailableAccountStore, connectAccountStore, SESSION_DAYS } from '../server/accounts';

describe('sessions survive a restart/deploy', () => {
  it('a token issued before a restart still resumes on a fresh process sharing the same store', async () => {
    const db = new MemoryAccountStore(); // stands in for Postgres: outlives the process
    const before = new Accounts(db);
    const { token } = await before.claim('QA-Persist', 'hunter22pw', '1.1.1.1');
    const after = new Accounts(db); // "new boot"
    expect(await after.resume(token)).toEqual({ key: 'qa-persist', name: 'QA-Persist' });
  });
  it('sliding expiry pushes an active session back out to the full length', async () => {
    const db = new MemoryAccountStore();
    const a = new Accounts(db);
    const t0 = Date.now();
    const { token } = await a.claim('QA-Slide', 'hunter22pw', '1.1.1.1', t0);
    const later = t0 + 80 * 86_400_000;
    expect(await a.resume(token, later)).not.toBeNull();
    const s = [...db.sessions.values()][0];
    expect(s.expiresAt).toBe(later + SESSION_DAYS * 86_400_000);
  });
  it('an unreachable database throws instead of saying the session is invalid', async () => {
    const a = new Accounts(new UnavailableAccountStore());
    await expect(a.resume('x'.repeat(43))).rejects.toThrow();
  });
  it('connectAccountStore retries a flaky database', async () => {
    let n = 0;
    const s = await connectAccountStore(() => { const m = new MemoryAccountStore(); if (++n < 3) m.init = async () => { throw new Error('Authentication timed out'); }; return m; }, 5, 1);
    expect(s).not.toBeNull();
    expect(n).toBe(3);
  });
});
