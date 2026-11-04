/** Total play time: heartbeat-credited active time. Pure helpers shared by server and client. */
export const PLAY_BEAT_MS = 60_000;      // client heartbeat interval
export const PLAY_GAP_CAP_MS = 120_000;  // max credit for any single gap between beats
export const PLAY_IDLE_MS = 120_000;     // no input for this long = idle (client side)

/** Credit for one beat: elapsed since the user's last credited beat, capped; 0 when inactive or first beat. */
export function creditFor(last: number | undefined, now: number, active: boolean): number {
  if (!active || last == null) return 0;
  const gap = now - last;
  if (!(gap > 0)) return 0;
  return Math.min(gap, PLAY_GAP_CAP_MS);
}

/** '123h 45m' (always both parts; minutes floored). */
export function formatPlayTime(ms: number | null | undefined): string {
  const m = Math.max(0, Math.floor((Number(ms) || 0) / 60_000));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
