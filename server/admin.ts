import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { getAccounts, nameKey } from './accounts.js';
import { getBank } from './casino-store.js';
import { getVault } from './skins.js';

/** Constant-time token check. Rejects everything when ADMIN_GRANT_TOKEN is unset or short. */
export function adminAuthorized(header: string | undefined, token = process.env.ADMIN_GRANT_TOKEN): boolean {
  if (!token || token.length < 32 || !header?.startsWith('Bearer ')) return false;
  const a = createHash('sha256').update(header.slice(7)).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

/** POST /api/admin/grant {player, amount, memo, key}: credit chips through the bank (memory + ledger + Postgres + live wallet push). */
export function adminRouter(): express.Router {
  const r = express.Router();
  r.post('/api/admin/grant', express.json({ limit: '4kb' }), async (req, res) => {
    const ip = req.ip ?? '?';
    if (!adminAuthorized(req.get('authorization'))) {
      console.warn(`[admin] grant rejected: unauthorized from ${ip}`);
      return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    }
    const { player, amount, memo, key } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof player !== 'string' || !player.trim()) return res.status(400).json({ ok: false, error: 'player is required.' });
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 10_000) return res.status(400).json({ ok: false, error: 'amount must be an integer 1..10000.' });
    if (typeof key !== 'string' || !/^[\w:.\-]{8,120}$/.test(key)) return res.status(400).json({ ok: false, error: 'key (idempotency key) is required.' });
    if (memo !== undefined && (typeof memo !== 'string' || memo.length > 200)) return res.status(400).json({ ok: false, error: 'memo must be a string up to 200 chars.' });
    let row;
    try { row = await getAccounts().store.get(nameKey(player)); } catch { return res.status(503).json({ ok: false, error: 'Accounts unavailable.' }); }
    if (!row) return res.status(404).json({ ok: false, error: 'Unknown player.' });
    const bank = getBank();
    const before = bank.account(row.name).chips;
    const applied = bank.transfer(row.name, amount, { key, game: 'admin', memo: typeof memo === 'string' && memo ? memo : 'admin_grant' });
    const after = bank.account(row.name).chips;
    console.log(`[admin] grant ${applied ? 'applied' : 'replay ignored'}: ${row.name} +${amount} key=${key} memo=${JSON.stringify(memo ?? '')} ${before}->${after} from ${ip}`);
    await bank.flush();
    res.json({ ok: true, applied, player: row.name, amount, before, after, key });
  });
  /** POST /api/admin/grant-item {player, kind: 'case'|'key', key}: QA- accounts ONLY. Mints one case or key (idempotent by key), logged. */
  r.post('/api/admin/grant-item', express.json({ limit: '4kb' }), async (req, res) => {
    const ip = req.ip ?? '?';
    if (!adminAuthorized(req.get('authorization'))) {
      console.warn(`[admin] grant-item rejected: unauthorized from ${ip}`);
      return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    }
    const { player, kind, key } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof player !== 'string' || !/^QA-/i.test(player.trim())) return res.status(400).json({ ok: false, error: 'Item grants are for QA- accounts only.' });
    if (kind !== 'case' && kind !== 'key') return res.status(400).json({ ok: false, error: "kind must be 'case' or 'key'." });
    if (typeof key !== 'string' || !/^[\w:.\-]{8,120}$/.test(key)) return res.status(400).json({ ok: false, error: 'key (idempotency key) is required.' });
    let row;
    try { row = await getAccounts().store.get(nameKey(player)); } catch { return res.status(503).json({ ok: false, error: 'Accounts unavailable.' }); }
    if (!row) return res.status(404).json({ ok: false, error: 'Unknown player.' });
    const vault = getVault();
    const it = vault.make(row.name, kind, `admin:${key}`, 'admin-qa');
    if (it) vault.commit([it], [{ item: it.id, kind: 'drop', from: null, to: it.owner, memo: `admin QA grant ${kind} key=${key}`, at: Date.now() }]);
    console.log(`[admin] grant-item ${it ? 'applied' : 'replay ignored'}: ${row.name} ${kind} key=${key} from ${ip}`);
    res.json({ ok: true, applied: !!it, player: row.name, kind, ...(it ? { id: it.id } : {}) });
  });
  return r;
}
