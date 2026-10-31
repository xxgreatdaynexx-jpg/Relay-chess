/** Kill cam: a short server-side ring of everyone's poses, sliced into a replay track when someone dies.
 *  Tracks are kept per victim (last death only) and only sent when that player asks for them. */
export const KILLCAM_MS = 4000;
/** Keep a bit more than one track's worth so the slice is always full. */
const RING_MS = KILLCAM_MS + 1000;
/** A kill cam can be requested for this long after the death. */
export const KILLCAM_TTL_MS = 30_000;

/** One player's pose in a frame: [x, y, z, yaw, pitch, crouch(0/1), fired(0/1), weapon, scoped(0/1)]. */
export type CamPose = [number, number, number, number, number, number, number, string, number];
export interface CamFrame { t: number; p: Record<string, CamPose> }
/** One shot in the replay: who, when, weapon, eye-level origin, rays [yaw, pitch, dist, hit], scoped. */
export interface CamShot { t: number; id: string; w: string; o: [number, number, number]; rays: Array<[number, number, number, number]>; sc: number; hit: number }
/** Poses are also sampled on every move / shot (up to ~40 Hz), not only on the 15 Hz tick, so the replay is smooth. */
const SAMPLE_MIN_MS = 12;
export interface KillCard { killerId: string | null; killer: string; victimId: string; weapon: string; dist: number; head: boolean; bot: boolean; at: number }
export interface KillCam { card: KillCard; track: CamFrame[] | null; shots?: CamShot[] }

interface PoseSrc { id: string; alive: boolean; x: number; y: number; z: number; a: number; p: number; crouch?: boolean; weapon: string; scopedSince?: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Angles keep 3 decimals (0.06 deg): 2 decimals visibly stepped the killer's aim, worst when scoped. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const poseOf = (f: PoseSrc, fired: boolean): CamPose => [r2(f.x), r2(f.y), r2(f.z), r3(f.a), r3(f.p), f.crouch ? 1 : 0, fired ? 1 : 0, f.weapon, f.weapon === 'sniper' && (f.scopedSince ?? 0) > 0 ? 1 : 0];

export class KillCamBuffer {
  /** Per-fighter pose samples (tick + every move / shot). */
  private streams = new Map<string, Array<{ t: number; pose: CamPose }>>();
  private shotLog: CamShot[] = [];
  private fired = new Set<string>();
  private last = new Map<string, KillCam>();

  /** Mark a shot so the next frame shows a muzzle flash for this fighter. */
  shot(id: string) { this.fired.add(id); }

  /** Full shot record (origin + rays) for tracers, sound and the hit marker in the replay. */
  shotFx(t: number, s: Omit<CamShot, 't'>) {
    this.shotLog.push({ t, ...s });
    while (this.shotLog.length && this.shotLog[0].t < t - RING_MS) this.shotLog.shift();
  }

  /** One pose sample for a fighter (called on moves and shots, deduped to SAMPLE_MIN_MS). */
  sample(now: number, f: PoseSrc, fired = false) {
    if (!f.alive) return;
    let s = this.streams.get(f.id);
    if (!s) this.streams.set(f.id, (s = []));
    const pose = poseOf(f, fired);
    const prev = s[s.length - 1];
    if (prev && now - prev.t < SAMPLE_MIN_MS) { if (prev.pose[6]) pose[6] = 1; prev.pose = pose; if (now > prev.t) prev.t = now; }
    else s.push({ t: now, pose });
    while (s.length && s[0].t < now - RING_MS) s.shift();
  }

  /** Record one tick of every living fighter. */
  frame(now: number, fighters: Iterable<PoseSrc>) {
    for (const f of fighters) this.sample(now, f, this.fired.has(f.id));
    this.fired.clear();
    for (const [id, s] of this.streams) {
      while (s.length && s[0].t < now - RING_MS) s.shift();
      if (!s.length) this.streams.delete(id);
    }
  }

  /** Store the kill for the victim. Bots, suicides and the nuke get a card only (no track). */
  kill(card: KillCard) {
    const self = !card.killerId || card.killerId === card.victimId;
    let track: CamFrame[] | null = null;
    let shots: CamShot[] | undefined;
    if (!card.bot && !self) {
      const from = card.at - KILLCAM_MS;
      const ks = (this.streams.get(card.killerId!) ?? []).filter((x) => x.t >= from && x.t <= card.at);
      const vs = (this.streams.get(card.victimId) ?? []).filter((x) => x.t >= from && x.t <= card.at);
      const byT = new Map<number, CamFrame>();
      for (const [id, list] of [[card.killerId!, ks], [card.victimId, vs]] as const) {
        for (const x of list) { let f = byT.get(x.t); if (!f) byT.set(x.t, (f = { t: x.t, p: {} })); f.p[id] = x.pose; }
      }
      track = [...byT.values()].sort((a, b) => a.t - b.t);
      // Start on a killer pose so the camera has somewhere to be.
      while (track.length && !track[0].p[card.killerId!]) track.shift();
      if (ks.length < 2) track = null; // not enough data: card only
      else shots = this.shotLog.filter((x) => x.id === card.killerId && x.t >= track![0].t && x.t <= card.at);
    }
    this.last.set(card.victimId, shots ? { card, track, shots } : { card, track });
  }

  /** The victim's last kill cam, or null if none / expired / they've since respawned. */
  get(victimId: string, now: number): KillCam | null {
    const k = this.last.get(victimId);
    if (!k || now - k.card.at > KILLCAM_TTL_MS) return null;
    return k;
  }
  forget(id: string) { this.last.delete(id); this.streams.delete(id); }
  clear() { this.streams.clear(); this.shotLog = []; this.last.clear(); this.fired.clear(); }
  /** Number of pose samples held. */
  get size() { let n = 0; for (const s of this.streams.values()) n += s.length; return n; }
}
