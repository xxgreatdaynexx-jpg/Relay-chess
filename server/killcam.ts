/** Kill cam: a short server-side ring of everyone's poses, sliced into a replay track when someone dies.
 *  Tracks are kept per victim (last death only) and only sent when that player asks for them. */
export const KILLCAM_MS = 4000;
/** Keep a bit more than one track's worth so the slice is always full. */
const RING_MS = KILLCAM_MS + 1000;
/** A kill cam can be requested for this long after the death. */
export const KILLCAM_TTL_MS = 30_000;

/** One player's pose in a frame: [x, y, z, yaw, pitch, crouch(0/1), fired(0/1), weapon]. */
export type CamPose = [number, number, number, number, number, number, number, string];
export interface CamFrame { t: number; p: Record<string, CamPose> }
export interface KillCard { killerId: string | null; killer: string; victimId: string; weapon: string; dist: number; head: boolean; bot: boolean; at: number }
export interface KillCam { card: KillCard; track: CamFrame[] | null }

interface PoseSrc { id: string; alive: boolean; x: number; y: number; z: number; a: number; p: number; crouch?: boolean; weapon: string }

const r2 = (n: number) => Math.round(n * 100) / 100;

export class KillCamBuffer {
  private ring: CamFrame[] = [];
  private fired = new Set<string>();
  private last = new Map<string, KillCam>();

  /** Mark a shot so the next frame shows a muzzle flash for this fighter. */
  shot(id: string) { this.fired.add(id); }

  /** Record one tick of every living fighter. */
  frame(now: number, fighters: Iterable<PoseSrc>) {
    const p: Record<string, CamPose> = {};
    for (const f of fighters) if (f.alive) p[f.id] = [r2(f.x), r2(f.y), r2(f.z), r2(f.a), r2(f.p), f.crouch ? 1 : 0, this.fired.has(f.id) ? 1 : 0, f.weapon];
    this.fired.clear();
    const prev = this.ring[this.ring.length - 1];
    if (prev && prev.t === now) prev.p = p; else this.ring.push({ t: now, p });
    while (this.ring.length && this.ring[0].t < now - RING_MS) this.ring.shift();
  }

  /** Store the kill for the victim. Bots, suicides and the nuke get a card only (no track). */
  kill(card: KillCard) {
    const self = !card.killerId || card.killerId === card.victimId;
    let track: CamFrame[] | null = null;
    if (!card.bot && !self) {
      const ids = [card.killerId!, card.victimId];
      track = this.ring.filter((f) => f.t >= card.at - KILLCAM_MS && f.t <= card.at && f.p[card.killerId!])
        .map((f) => ({ t: f.t, p: Object.fromEntries(ids.filter((id) => f.p[id]).map((id) => [id, f.p[id]])) }));
      if (track.length < 2) track = null; // not enough data: card only
    }
    this.last.set(card.victimId, { card, track });
  }

  /** The victim's last kill cam, or null if none / expired / they've since respawned. */
  get(victimId: string, now: number): KillCam | null {
    const k = this.last.get(victimId);
    if (!k || now - k.card.at > KILLCAM_TTL_MS) return null;
    return k;
  }
  forget(id: string) { this.last.delete(id); }
  clear() { this.ring = []; this.last.clear(); this.fired.clear(); }
  get size() { return this.ring.length; }
}
