import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { getAccounts, nameKey } from './accounts.js';
import { getBank, WALLET_UNAVAILABLE } from './casino-store.js';
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
    if (!bank.ready) return res.status(503).json({ ok: false, error: WALLET_UNAVAILABLE });
    const before = await bank.refresh(row.name); // DB is the source of truth
    const applied = bank.transfer(row.name, amount, { key, game: 'admin', memo: typeof memo === 'string' && memo ? memo : 'admin_grant' });
    await bank.flush();
    const after = await bank.refresh(row.name);
    console.log(`[admin] grant ${applied ? 'applied' : 'replay ignored'}: ${row.name} +${amount} key=${key} memo=${JSON.stringify(memo ?? '')} ${before}->${after} from ${ip}`);
    res.json({ ok: true, applied, player: row.name, amount, before, after, key });
  });
  /**
   * POST /api/admin/debit {player, amount, memo, key}: remove chips through the bank's atomic increment path.
   * Never below zero: debits min(amount, balance) and reports the shortfall. Idempotent by key.
   */
  r.post('/api/admin/debit', express.json({ limit: '4kb' }), async (req, res) => {
    const ip = req.ip ?? '?';
    if (!adminAuthorized(req.get('authorization'))) {
      console.warn(`[admin] debit rejected: unauthorized from ${ip}`);
      return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    }
    const { player, amount, memo, key } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof player !== 'string' || !player.trim()) return res.status(400).json({ ok: false, error: 'player is required.' });
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 10_000) return res.status(400).json({ ok: false, error: 'amount must be an integer 1..10000.' });
    if (typeof key !== 'string' || !/^[\w:.\-]{8,120}$/.test(key)) return res.status(400).json({ ok: false, error: 'key (idempotency key) is required.' });
    if (typeof memo !== 'string' || !memo.trim() || memo.length > 200) return res.status(400).json({ ok: false, error: 'memo is required (up to 200 chars).' });
    let row;
    try { row = await getAccounts().store.get(nameKey(player)); } catch { return res.status(503).json({ ok: false, error: 'Accounts unavailable.' }); }
    if (!row) return res.status(404).json({ ok: false, error: 'Unknown player.' });
    const bank = getBank();
    if (!bank.ready) return res.status(503).json({ ok: false, error: WALLET_UNAVAILABLE });
    const before = await bank.refresh(row.name); // DB is the source of truth
    if (bank.hasKey(key)) return res.json({ ok: true, applied: false, player: row.name, requested: amount, debited: 0, shortfall: 0, before, after: before, key });
    const debited = Math.min(amount, Math.max(0, before));
    let applied = false;
    if (debited > 0) {
      try { applied = bank.transfer(row.name, -debited, { key, game: 'admin', memo }); } catch (e) { return res.status(409).json({ ok: false, error: (e as Error).message }); }
    }
    await bank.flush();
    const after = await bank.refresh(row.name);
    const shortfall = amount - (applied ? debited : 0);
    console.log(`[admin] debit ${applied ? 'applied' : 'nothing taken'}: ${row.name} -${applied ? debited : 0} (requested ${amount}, shortfall ${shortfall}) key=${key} memo=${JSON.stringify(memo)} ${before}->${after} from ${ip}`);
    res.json({ ok: true, applied, player: row.name, requested: amount, debited: applied ? debited : 0, shortfall, before, after, key });
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
  /** POST /api/admin/reset-password {player, memo, key}: temp password (returned once, never logged), all sessions revoked. */
  const resetKeys = new Set<string>();
  r.post('/api/admin/reset-password', express.json({ limit: '4kb' }), async (req, res) => {
    const ip = req.ip ?? '?';
    res.set('Cache-Control', 'no-store');
    if (!adminAuthorized(req.get('authorization'))) {
      console.warn(`[admin] reset-password rejected: unauthorized from ${ip}`);
      return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    }
    const { player, memo, key, friendly } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof player !== 'string' || !player.trim()) return res.status(400).json({ ok: false, error: 'player is required.' });
    if (typeof key !== 'string' || !/^[\w:.\-]{8,120}$/.test(key)) return res.status(400).json({ ok: false, error: 'key (idempotency key) is required.' });
    if (memo !== undefined && (typeof memo !== 'string' || memo.length > 200)) return res.status(400).json({ ok: false, error: 'memo must be a string up to 200 chars.' });
    if (friendly !== undefined && typeof friendly !== 'boolean') return res.status(400).json({ ok: false, error: 'friendly must be a boolean.' });
    if (resetKeys.has(key)) return res.status(409).json({ ok: false, error: 'That key was already used.' });
    let out;
    try { out = await getAccounts().adminResetPassword(nameKey(player), friendly === true); } catch { return res.status(503).json({ ok: false, error: 'Accounts unavailable.' }); }
    if (!out) return res.status(404).json({ ok: false, error: 'Unknown player.' });
    resetKeys.add(key);
    console.log(`[admin] reset-password applied: ${out.name} sessionsRevoked=${out.sessionsRevoked} friendly=${friendly === true} key=${key} memo=${JSON.stringify(memo ?? '')} from ${ip}`);
    res.json({ ok: true, player: out.name, sessionsRevoked: out.sessionsRevoked, tempPassword: out.password });
  });
  return r;
}
