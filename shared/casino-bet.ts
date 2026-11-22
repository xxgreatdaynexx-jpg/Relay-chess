/** Shared casino bet parsing, caps and validation. Play money only. */
export const CASINO_MAX_BET = 10_000_000;

/**
 * Parse a chip amount from a number or a comma/space/underscore-grouped decimal string.
 * Returns null when the value is missing, not a whole number, or not a safe integer.
 */
export function parseChipAmount(raw: unknown): number | null {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || !Number.isSafeInteger(raw) || raw < 0) return null;
    return raw;
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (!/^[0-9][0-9,_\s]*$/.test(s)) return null;
  const n = Number(s.replace(/[,_\s]/g, ''));
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

export interface BetLimits {
  min: number;
  max: number;
  balance?: number;
}

export type BetCheck = { ok: true; amount: number } | { ok: false; error: string };

/** Hard cap used everywhere: never above CASINO_MAX_BET. */
export function betCap(max: number): number {
  return Math.min(max, CASINO_MAX_BET);
}

export function validateCasinoBet(raw: unknown, opts: BetLimits): BetCheck {
  const amount = parseChipAmount(raw);
  if (amount === null) return { ok: false, error: 'Enter a whole number of chips.' };
  const cap = betCap(opts.max);
  if (amount < opts.min) return { ok: false, error: `Minimum bet is ${opts.min.toLocaleString()}.` };
  if (amount > cap) return { ok: false, error: `Maximum bet is ${cap.toLocaleString()}.` };
  if (opts.balance != null && amount > opts.balance) return { ok: false, error: 'Not enough chips.' };
  return { ok: true, amount };
}

/** Clamp a parsed amount into [min, min(max, CASINO_MAX_BET, balance)]. If balance is below min, returns min. */
export function clampChipAmount(amount: number, min: number, max: number, balance?: number): number {
  let cap = betCap(max);
  if (balance != null) cap = Math.min(cap, Math.max(0, Math.floor(balance)));
  if (cap < min) return min;
  return Math.max(min, Math.min(cap, amount));
}

/** Short chip label for buttons and board markers. */
export function formatChip(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n >= 10_000 && n % 1_000 === 0) return `${n / 1_000}K`;
  return n.toLocaleString();
}

/** Compact marker for chips already on a table (allows fractional thousands). */
export function compactChipLabel(n: number): string {
  if (n >= 1_000_000) {
    const m = Math.round(n / 100_000) / 10;
    return `${m % 1 === 0 ? m.toFixed(0) : m}M`;
  }
  if (n >= 1000) {
    const k = Math.round(n / 100) / 10;
    return `${k % 1 === 0 ? k.toFixed(0) : k}k`;
  }
  return String(n);
}
