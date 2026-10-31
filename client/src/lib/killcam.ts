/** Kill cam playback (pure, testable). The track is the server's KillCam frames: poses of killer + victim over ~4 s. */
export type CamPose = [number, number, number, number, number, number, number, string];
export interface CamFrame { t: number; p: Record<string, CamPose> }
export interface KillCard { killerId: string | null; killer: string; victimId: string; weapon: string; dist: number; head: boolean; bot: boolean; at: number }

/** The last this-many ms of the track play slowed down. */
export const SLOWMO_MS = 500;
export const SLOWMO_RATE = 0.35;

/** Real playback length of a track span at 1x (slow-mo stretches the last SLOWMO_MS). */
export function playLength(spanMs: number): number {
  const slow = Math.min(SLOWMO_MS, spanMs);
  return spanMs - slow + slow / SLOWMO_RATE;
}

/** Speed-up so the replay ends before the respawn (never delays it). >= 1; Infinity when there's no time at all. */
export function fitSpeed(spanMs: number, availableMs: number): number {
  if (availableMs <= 0) return Infinity;
  return Math.max(1, playLength(spanMs) / availableMs);
}

/** Track time (ms since first frame) at a given real elapsed time and speed. */
export function contentTime(spanMs: number, realMs: number, speed = 1): number {
  const r = Math.max(0, realMs * speed);
  const slow = Math.min(SLOWMO_MS, spanMs);
  const fast = spanMs - slow;
  if (r <= fast) return r;
  return Math.min(spanMs, fast + (r - fast) * SLOWMO_RATE);
}

export interface CamSample { t: number; slow: boolean; done: boolean; killer: CamPose | null; victim: CamPose | null }

function lerpPose(a: CamPose, b: CamPose, k: number): CamPose {
  const da = Math.atan2(Math.sin(b[3] - a[3]), Math.cos(b[3] - a[3]));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + da * k, a[4] + (b[4] - a[4]) * k, k < 0.5 ? a[5] : b[5], k < 0.5 ? a[6] : b[6], k < 0.5 ? a[7] : b[7]];
}

/** Interpolated killer / victim poses at real elapsed time. */
export function sampleKillCam(track: CamFrame[], killerId: string, victimId: string, realMs: number, speed = 1): CamSample {
  const t0 = track[0]?.t ?? 0;
  const span = (track[track.length - 1]?.t ?? t0) - t0;
  const ct = contentTime(span, realMs, speed);
  const at = t0 + ct;
  const done = realMs * speed >= playLength(span);
  const pick = (id: string): CamPose | null => {
    let prev: CamFrame | null = null;
    for (const f of track) {
      if (f.t >= at) {
        const b = f.p[id], a = prev?.p[id];
        if (!b) return a ?? null;
        if (!a || !prev) return b;
        return lerpPose(a, b, (at - prev.t) / (f.t - prev.t || 1));
      }
      prev = f;
    }
    // past the end: last known pose
    for (let i = track.length - 1; i >= 0; i--) if (track[i].p[id]) return track[i].p[id];
    return null;
  };
  return { t: ct, slow: ct > span - SLOWMO_MS, done, killer: pick(killerId), victim: pick(victimId) };
}

/** "KILLED BY name — weapon, 23.4 m, HS" */
export function killCardText(c: KillCard, weaponName: (w: string) => string): string {
  const bits = [weaponName(c.weapon)];
  if (c.dist > 0) bits.push(`${c.dist.toFixed(1)} m`);
  if (c.head) bits.push('HS');
  return `KILLED BY ${c.killer} — ${bits.join(', ')}`;
}
