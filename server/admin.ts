import { disabledKeys } from '../shared/disabled.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { getAccounts, nameKey } from './accounts.js';
import { getBank, WALLET_UNAVAILABLE } from './casino-store.js';
import { getVault } from './skins.js';
import { getJail } from './jail.js';
import { getPopups, POPUP_FROM_MAX, POPUP_TEXT_MAX, sendPopup } from './popups.js';

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
  /**
   * POST /api/admin/jail {username, hours, reason}: lock a player in the jail (no trading, no earning). hours: number > 0,
   * or null / omitted / 0 for no timer (released only by typing the lines or /api/admin/unjail). Never moves chips.
   */
  r.post('/api/admin/jail', express.json({ limit: '4kb' }), async (req, res) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    const { username, hours, reason } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof username !== 'string' || !username.trim()) return res.status(400).json({ ok: false, error: 'username is required.' });
    if (hours != null && (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || hours > 24 * 365)) return res.status(400).json({ ok: false, error: 'hours must be a number 0..8760, or null for no timer.' });
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 200) return res.status(400).json({ ok: false, error: 'reason is required (up to 200 chars).' });
    let row;
    try { row = await getAccounts().store.get(nameKey(username)); } catch { return res.status(503).json({ ok: false, error: 'Accounts unavailable.' }); }
    if (!row) return res.status(404).json({ ok: false, error: 'Unknown player.' });
    try { const j = await getJail().jail(row.name, hours ? hours : null, reason.trim()); console.log(`[admin] jail ${row.name} from ${req.ip ?? '?'}`); res.json({ ok: true, jail: j }); }
    catch (e) { res.status(503).json({ ok: false, error: (e as Error).message }); }
  });
  /** POST /api/admin/unjail {username}: release now. */
  r.post('/api/admin/unjail', express.json({ limit: '4kb' }), async (req, res) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    const { username } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof username !== 'string' || !username.trim()) return res.status(400).json({ ok: false, error: 'username is required.' });
    res.json({ ok: true, released: await getJail().release(username.trim(), 'admin unjail') });
  });
  /**
   * POST /api/admin/disable {usernames: string[], reason, dryRun?} and /api/admin/enable {usernames: string[]}: reversible
   * soft-disable. All-or-nothing: every username must match an existing account exactly (case-insensitive key) or
   * nothing changes. Never moves chips or edits the ledger; reports each account's chip balance at the time.
   */
  const toggle = (on: boolean) => async (req: express.Request, res: express.Response) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    const { usernames, reason, dryRun } = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(usernames) || !usernames.length || usernames.length > 200 || !usernames.every((u) => typeof u === 'string' && u.trim())) return res.status(400).json({ ok: false, error: 'usernames must be a non-empty list of names.' });
    if (on && (typeof reason !== 'string' || !reason.trim() || reason.length > 200)) return res.status(400).json({ ok: false, error: 'reason is required (up to 200 chars).' });
    const keys = [...new Set((usernames as string[]).map(nameKey))];
    if (keys.length !== usernames.length) return res.status(400).json({ ok: false, error: 'Duplicate usernames.' });
    const accts = getAccounts(); const rows = [];
    try { for (const k of keys) rows.push({ k, row: await accts.store.get(k) }); } catch { return res.status(503).json({ ok: false, error: 'Accounts unavailable.' }); }
    const missing = rows.filter((x) => !x.row).map((x) => x.k);
    if (missing.length) return res.status(404).json({ ok: false, error: 'Unknown players; nothing changed.', missing });
    const bank = getBank();
    const balance = async (name: string) => (bank.ready ? await bank.refresh(name).catch(() => null) : null);
    const out = [];
    for (const { k, row } of rows) {
      const chips = await balance(row!.name);
      if (dryRun === true) { out.push({ player: row!.name, key: k, chips, disabled: row!.disabledAt != null }); continue; }
      const r = await accts.setDisabled(k, on, on ? String(reason).trim() : null);
      out.push({ player: row!.name, key: k, chips, changed: r?.changed ?? false, sessionsRevoked: r?.sessionsRevoked ?? 0 });
      console.log(`[admin] ${on ? 'disable' : 'enable'} ${row!.name} chips=${chips} changed=${r?.changed} from ${req.ip ?? '?'}`);
    }
    res.json({ ok: true, action: on ? 'disable' : 'enable', dryRun: dryRun === true, accounts: out });
  };
  r.post('/api/admin/disable', express.json({ limit: '16kb' }), toggle(true));
  r.post('/api/admin/enable', express.json({ limit: '16kb' }), toggle(false));
  r.get('/api/admin/disabled', (req, res) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    res.json({ ok: true, keys: disabledKeys() });
  });
  /** GET /api/jail: public list of inmates for the map (name, reason, until, typed/needed). */
  r.get('/api/jail', (_req, res) => { res.json({ ok: true, inmates: getJail().list() }); });
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
  /** POST /api/admin/popup {name, text, from}: queue a modal popup for one player (no chips). GET ?id= for status. */
  r.post('/api/admin/popup', express.json({ limit: '4kb' }), async (req, res) => {
    const ip = req.ip ?? '?';
    if (!adminAuthorized(req.get('authorization'))) {
      console.warn(`[admin] popup rejected: unauthorized from ${ip}`);
      return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    }
    const { name, text, from } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ ok: false, error: 'name is required.' });
    if (typeof text !== 'string' || !text.trim() || text.length > POPUP_TEXT_MAX) return res.status(400).json({ ok: false, error: `text is required (up to ${POPUP_TEXT_MAX} chars).` });
    if (from !== undefined && (typeof from !== 'string' || !from.trim() || from.length > POPUP_FROM_MAX)) return res.status(400).json({ ok: false, error: `from must be up to ${POPUP_FROM_MAX} chars.` });
    let row;
    try { row = await getAccounts().store.get(nameKey(name)); } catch { return res.status(503).json({ ok: false, error: 'Accounts unavailable.' }); }
    if (!row) return res.status(404).json({ ok: false, error: 'Unknown player.' });
    try {
      const { popup, online } = await sendPopup(row.name, typeof from === 'string' ? from.trim() : 'Admin', text.trim());
      console.log(`[admin] popup queued ${popup.id} for ${row.name} from ${ip} online=${online}`);
      res.json({ ok: true, id: popup.id, player: row.name, online, status: 'queued' });
    } catch { res.status(503).json({ ok: false, error: 'Popup storage unavailable.' }); }
  });
  r.get('/api/admin/popup', async (req, res) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    const status = id ? await getPopups().status(id).catch(() => null) : null;
    if (!status) return res.status(404).json({ ok: false, error: 'Unknown popup.' });
    res.json({ ok: true, id, status });
  });
  return r;
}
