/**
 * One-shot Millionaire Update prelaunch lockout (Nov 6, 2026).
 * Fixed UTC-6 window: local 19:45–20:00 = [2026-11-07T01:45:00Z, 2026-11-07T02:00:00Z) half-open.
 * Separate from overnight hub sleep (01:00–07:00); does not change that schedule or message.
 * Visible client copy: headline + countdown timer ONLY (no “coming”, no extra text, no buttons).
 */
export const MILLIONAIRE_PRELAUNCH_START_MS = Date.parse('2026-11-07T01:45:00.000Z');
export const MILLIONAIRE_PRELAUNCH_END_MS = Date.parse('2026-11-07T02:00:00.000Z');
/** Exact visible heading — do not append “coming” or other copy. */
export const MILLIONAIRE_PRELAUNCH_HEADLINE = 'Millionaire Update';
/** API/socket error string (same as headline; a11y may reuse). */
export const MILLIONAIRE_PRELAUNCH_MSG = MILLIONAIRE_PRELAUNCH_HEADLINE;

/** True during the half-open prelaunch window. */
export function isMillionairePrelaunch(now = Date.now()): boolean {
  return now >= MILLIONAIRE_PRELAUNCH_START_MS && now < MILLIONAIRE_PRELAUNCH_END_MS;
}

/** ms until window ends (0 if outside / already ended). */
export function millionairePrelaunchRemainingMs(now = Date.now()): number {
  if (now < MILLIONAIRE_PRELAUNCH_START_MS) return 0;
  if (now >= MILLIONAIRE_PRELAUNCH_END_MS) return 0;
  return MILLIONAIRE_PRELAUNCH_END_MS - now;
}

/** ms until window starts (0 if already started or past). */
export function millionairePrelaunchStartsInMs(now = Date.now()): number {
  if (now >= MILLIONAIRE_PRELAUNCH_START_MS) return 0;
  return MILLIONAIRE_PRELAUNCH_START_MS - now;
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function millionairePrelaunchView(now = Date.now()) {
  const active = isMillionairePrelaunch(now);
  return {
    active,
    kind: 'millionaire_prelaunch' as const,
    headline: MILLIONAIRE_PRELAUNCH_HEADLINE,
    message: MILLIONAIRE_PRELAUNCH_MSG,
    startAt: MILLIONAIRE_PRELAUNCH_START_MS,
    endAt: MILLIONAIRE_PRELAUNCH_END_MS,
    serverNow: now,
    remainingMs: millionairePrelaunchRemainingMs(now),
    startsInMs: millionairePrelaunchStartsInMs(now),
    tz: 'UTC-6',
    label: 'America/Regina (UTC-6 fixed)',
  };
}
