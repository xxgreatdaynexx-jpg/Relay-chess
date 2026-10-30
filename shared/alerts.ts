export const TIME_ALARM_MS = 10_000;

/**
 * Whether the 10-second alarm should sound for this client: its side's clock is running,
 * at or under 10 s, not flagged yet, and it has not already rung this ply.
 */
export function shouldTimeAlarm(opts: {
  mySide: 'white' | 'black' | null;
  active: 'white' | 'black' | null;
  running: boolean;
  remainingMs: number;
  ply: number;
  alarmedPly: number | null;
}): boolean {
  const { mySide, active, running, remainingMs, ply, alarmedPly } = opts;
  if (!mySide || !running || active !== mySide) return false;
  if (remainingMs > TIME_ALARM_MS || remainingMs <= 0) return false;
  return alarmedPly !== ply;
}

/** True only on the transition into "your move", never on the first render. */
export function becameYourTurn(previous: boolean | null, now: boolean): boolean {
  return previous === false && now;
}
