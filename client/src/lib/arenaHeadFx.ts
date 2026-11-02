/** Server-confirmed hit feedback for our own shot. Head: always ding + head number. Body after a predicted head:
 * show the real (body) number instead. Otherwise the prediction already showed it. */
export function headHitFeedback(h: { dmg?: number; head?: boolean }, now: number, predHeadAt: number): { v: number; head: boolean } | null {
  if (h.head) return { v: Math.round(h.dmg ?? 0), head: true };
  if (now - predHeadAt < 1500) return { v: Math.round(h.dmg ?? 0), head: false };
  return null;
}

/** The hit marker shows only for a server fps_hit from me to someone else that dealt damage (dmg > 0). */
export function showsHitMarker(h: { by: string | null; target: string; dmg?: number }, meId: string): boolean {
  return h.by === meId && h.target !== meId && (h.dmg ?? 0) > 0;
}
