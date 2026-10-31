/** Kill cam playback (pure, testable). The track is the server's KillCam frames: poses of killer + victim over ~4 s. */
/** [x, y, z, yaw, pitch, crouch, fired, weapon, scoped?] (scoped is missing on tracks from older servers). */
export type CamPose = [number, number, number, number, number, number, number, string, number?];
export interface CamFrame { t: number; p: Record<string, CamPose> }
export interface CamShot { t: number; id: string; w: string; o: [number, number, number]; rays: Array<[number, number, number, number]>; sc: number; hit: number }
export interface KillCard { killerId: string | null; killer: string; victimId: string; weapon: string; dist: number; head: boolean; bot: boolean; at: number }

/** The last this-many ms of the track play slowed down. */
export const SLOWMO_MS = 500;
export const SLOWMO_RATE = 0.35;
/** After the fatal shot the frame holds on the victim going down for this long (real ms, not sped up). */
export const DEATH_HOLD_MS = 900;

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

export interface CamSample { t: number; slow: boolean; done: boolean; killer: CamPose | null; victim: CamPose | null; /** ms since the fatal moment (>= 0 during the death hold), else -1 */ hold: number }

const wrapA = (d: number) => Math.atan2(Math.sin(d), Math.cos(d));
/** Centripetal-ish Catmull-Rom on one channel (uniform), falls back to linear at the ends. */
function cr(p0: number, p1: number, p2: number, p3: number, k: number): number {
  const k2 = k * k, k3 = k2 * k;
  return 0.5 * (2 * p1 + (-p0 + p2) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k2 + (-p0 + 3 * p1 - 3 * p2 + p3) * k3);
}

type Stream = Array<{ t: number; pose: CamPose }>;
const streamCache = new WeakMap<CamFrame[], Map<string, Stream>>();
/** Per-player sample lists (frames may carry only one of the two players). */
function streamOf(track: CamFrame[], id: string): Stream {
  let m = streamCache.get(track);
  if (!m) streamCache.set(track, (m = new Map()));
  let s = m.get(id);
  if (!s) { s = track.filter((f) => f.p[id]).map((f) => ({ t: f.t, pose: f.p[id] })); m.set(id, s); }
  return s;
}

/** Smooth pose at track time `at`: Catmull-Rom through the samples (yaw unwrapped), discrete flags from the nearer one. */
export function poseAt(track: CamFrame[], id: string, at: number): CamPose | null {
  const s = streamOf(track, id);
  if (!s.length) return null;
  if (at <= s[0].t) return s[0].pose;
  const n = s.length;
  if (at >= s[n - 1].t) return s[n - 1].pose;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid].t <= at) lo = mid; else hi = mid; }
  const B = s[lo].pose, C = s[hi].pose;
  const A = lo > 0 ? s[lo - 1].pose : null, D = hi < n - 1 ? s[hi + 1].pose : null;
  const k = (at - s[lo].t) / (s[hi].t - s[lo].t || 1);
  // Big gaps (a teleport / respawn inside the window) don't get splined across.
  if (Math.hypot(C[0] - B[0], C[1] - B[1]) > 1.5 + (15 * (s[hi].t - s[lo].t)) / 1000) return k < 0.5 ? B : C;
  // Missing neighbours are mirrored (2B - C), so the ends stay linear rather than easing.
  const ch = (b: number, c: number, a: number | null, d: number | null) => cr(a ?? 2 * b - c, b, c, d ?? 2 * c - b, k);
  const out: CamPose = [0, 0, 0, 0, 0, 0, 0, '', 0];
  for (let i = 0; i < 3; i++) out[i] = ch(B[i] as number, C[i] as number, A ? (A[i] as number) : null, D ? (D[i] as number) : null);
  // Yaw: unwrap around B so the spline never spins the long way.
  const b3 = B[3], c3 = b3 + wrapA(C[3] - b3);
  out[3] = ch(b3, c3, A ? b3 + wrapA(A[3] - b3) : null, D ? c3 + wrapA(D[3] - C[3]) : null);
  out[4] = ch(B[4], C[4], A ? A[4] : null, D ? D[4] : null);
  const near = k < 0.5 ? B : C;
  out[5] = near[5]; out[6] = near[6]; out[7] = near[7]; out[8] = near[8] ?? 0;
  return out;
}

/** Interpolated killer / victim poses at real elapsed time. The track ends at the fatal shot, then holds DEATH_HOLD_MS. */
export function sampleKillCam(track: CamFrame[], killerId: string, victimId: string, realMs: number, speed = 1): CamSample {
  const t0 = track[0]?.t ?? 0;
  const span = (track[track.length - 1]?.t ?? t0) - t0;
  const ct = contentTime(span, realMs, speed);
  const at = t0 + ct;
  const playMs = playLength(span) / speed;
  const hold = realMs >= playMs ? realMs - playMs : -1;
  const done = realMs >= playMs + DEATH_HOLD_MS / Math.max(1, speed);
  return { t: ct, slow: ct > span - SLOWMO_MS, done, killer: poseAt(track, killerId, at), victim: poseAt(track, victimId, at), hold };
}

/** The killer's shots that happened in track time (fromCt, toCt] (ct = ms since the first frame). */
export function shotsBetween(track: CamFrame[], shots: CamShot[] | undefined, fromCt: number, toCt: number): CamShot[] {
  if (!shots?.length || toCt <= fromCt) return [];
  const t0 = track[0]?.t ?? 0;
  return shots.filter((s) => s.t - t0 > fromCt && s.t - t0 <= toCt);
}

/** "KILLED BY name — weapon, 23.4 m, HS" */
export function killCardText(c: KillCard, weaponName: (w: string) => string): string {
  const bits = [weaponName(c.weapon)];
  if (c.dist > 0) bits.push(`${c.dist.toFixed(1)} m`);
  if (c.head) bits.push('HS');
  return `KILLED BY ${c.killer} — ${bits.join(', ')}`;
}
