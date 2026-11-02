/** Arena game modes (shared by client and server). Logic lives in server/arena-modes.ts. */
export type ModeId = 'dm' | 'snd' | 'ctf';
export const MODE_IDS: ModeId[] = ['dm', 'snd', 'ctf'];
export const isModeId = (x: unknown): x is ModeId => x === 'dm' || x === 'snd' || x === 'ctf';
export const MODE_INFO: Record<ModeId, { name: string; short: string; blurb: string }> = {
  dm: { name: 'Deathmatch', short: 'DM', blurb: 'Free for all. Most kills wins.' },
  snd: { name: 'Search & Destroy', short: 'S&D', blurb: 'Two teams, one life per round. Attackers plant the bomb at A or B, defenders defuse it. First to 4 rounds.' },
  ctf: { name: 'Capture the Flag', short: 'CTF', blurb: 'Two teams. Grab the enemy flag and bring it to your base while yours is home. First to 3 captures.' },
};
export type TeamId = 0 | 1;
export const TEAM_NAMES = ['Blue', 'Red'] as const;
export const TEAM_COLORS = ['#4ea3ff', '#ff5a4e'] as const;

// ---- Search & Destroy
export const SND_WIN_ROUNDS = 4; // best of 7
export const SND_MAX_ROUNDS = SND_WIN_ROUNDS * 2 - 1;
export const SND_ROUND_MS = 90_000;
export const SND_BOMB_MS = 35_000;
export const SND_PLANT_MS = 3_000;
export const SND_DEFUSE_MS = 5_000;
export const SND_POST_MS = 5_000;
/** Late joiners (or players who hadn't pressed Play yet) may still spawn this long into a round. */
export const SND_JOIN_GRACE_MS = 12_000;
/** Elimination isn't checked until this long after a round starts (everyone is respawning). */
export const SND_START_GRACE_MS = 2_500;
export const SITE_R = 2.6;
export const DEFUSE_R = 1.6;
export const BOMB_PICKUP_R = 1.3;
export const BOMB_BLAST_R = 7;
/** Moving further than this from where you started planting/defusing cancels it. */
export const HOLD_SLIP = 0.45;

// ---- Capture the Flag
export const CTF_WIN_CAPS = 3;
export const CTF_MS = 8 * 60_000;
export const FLAG_R = 1.4;
export const FLAG_RETURN_MS = 20_000;

/** Combat XP per objective (plant, defuse, capture, flag return); capped per match. */
export const OBJ_XP = 60;
export const OBJ_XP_CAP = 10;

export interface ModeView {
  mode: ModeId;
  teams?: { score: [number, number]; size: [number, number]; alive: [number, number] };
  /** team per fighter id */
  tm?: Record<string, TeamId>;
  snd?: {
    round: number; attackers: TeamId; phase: 'live' | 'planted' | 'post'; left: number;
    sites: Array<{ id: 'A' | 'B'; x: number; y: number; z: number; r: number }>;
    bomb: { state: 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded' | 'none'; x: number; y: number; z: number; carrier?: string; site?: 'A' | 'B'; left?: number };
    hold?: { id: string; kind: 'plant' | 'defuse'; pct: number };
    lastWinner?: TeamId; lastReason?: string;
  };
  ctf?: {
    left: number;
    flags: Array<{ team: TeamId; state: 'home' | 'carried' | 'dropped'; x: number; y: number; z: number; carrier?: string; returnIn?: number }>;
    bases: Array<{ x: number; y: number; z: number }>;
  };
}
