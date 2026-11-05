/**
 * Disabled (soft-deleted) accounts. Reversible: the players row, wallet and full ledger history stay; the account just
 * can't sign in, keeps no sessions, and is left out of public boards, the map, active-player lists, bonuses, tax
 * payouts and trades. The server fills this set from players.disabled_at at boot and on every admin disable/enable.
 */
const disabled = new Set<string>();
const key = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();
export function setDisabledKeys(keys: Iterable<string>): void { disabled.clear(); for (const k of keys) disabled.add(key(k)); }
export function markDisabled(name: string, on: boolean): void { if (on) disabled.add(key(name)); else disabled.delete(key(name)); }
export const isDisabledName = (name: unknown): boolean => typeof name === 'string' && disabled.size > 0 && disabled.has(key(name));
export const disabledKeys = (): string[] => [...disabled].sort();
export const ACCOUNT_DISABLED_MSG = 'This account has been disabled.';
