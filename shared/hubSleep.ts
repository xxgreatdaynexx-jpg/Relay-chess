/**
 * Full Chud Hub overnight lockout: 01:00–07:00 America/Edmonton (fixed UTC-6, no DST).
 * Half-open [01:00, 07:00). Play/API refuse; /health and /api/health stay up for Render.
 */
export const HUB_UTC_OFFSET_HOURS = -6;
export const HUB_SLEEP_START_HOUR = 1;
export const HUB_SLEEP_END_HOUR = 7;
export const HUB_SLEEP_MSG = 'Chud Hub sleeps so should you.';

/** Minutes since local midnight in fixed UTC-6. */
export function hubLocalMinutes(now = Date.now()): number {
  const d = new Date(now + HUB_UTC_OFFSET_HOURS * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

/** False during the overnight sleep window. */
export function isHubAwake(now = Date.now()): boolean {
  const m = hubLocalMinutes(now);
  return m < HUB_SLEEP_START_HOUR * 60 || m >= HUB_SLEEP_END_HOUR * 60;
}

/** Next wake or sleep boundary (epoch ms). */
export function nextHubBoundary(now = Date.now()): number {
  const off = HUB_UTC_OFFSET_HOURS * 3_600_000;
  const local = new Date(now + off);
  const y = local.getUTCFullYear(), mo = local.getUTCMonth(), da = local.getUTCDate();
  const sleepMs = Date.UTC(y, mo, da, HUB_SLEEP_START_HOUR, 0, 0) - off;
  const wakeMs = Date.UTC(y, mo, da, HUB_SLEEP_END_HOUR, 0, 0) - off;
  if (now < sleepMs) return sleepMs;
  if (now < wakeMs) return wakeMs;
  return Date.UTC(y, mo, da + 1, HUB_SLEEP_START_HOUR, 0, 0) - off;
}

export function hubSleepView(now = Date.now()) {
  const awake = isHubAwake(now);
  return {
    awake,
    sleeping: !awake,
    sleepStartHour: HUB_SLEEP_START_HOUR,
    sleepEndHour: HUB_SLEEP_END_HOUR,
    tz: 'UTC-6',
    label: 'America/Edmonton (UTC-6)',
    message: HUB_SLEEP_MSG,
    nextChangeAt: nextHubBoundary(now),
  };
}
