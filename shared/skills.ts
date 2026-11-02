/**
 * RuneScape-style skills: shared registry + XP curve (client and server).
 * Level perks live in shared/skillPerks.ts (perkText shows them in the Skills panel).
 * To add a skill: add an entry to SKILLS (id, label, icon, how) and award XP with awardXp(name, '<id>', n) on the server.
 */
export const SKILLS = [
  { id: 'mining', label: 'Mining', icon: '⛏️', how: 'Break ore in any mine (deeper ores give more XP). Higher levels swing faster and sometimes get double ore.' },
  { id: 'engineering', label: 'Engineering', icon: '⚙️', how: 'Bars and goods your factory produces. Higher levels craft faster.' },
  { id: 'farming', label: 'Farming', icon: '🌾', how: 'Harvest crops on your farm. Higher levels grow crops faster.' },
  { id: 'racing', label: 'Racing', icon: '🏁', how: 'Complete laps at the Speedway (personal bests give a bonus). Higher levels get a Daily Cup entry discount.' },
  { id: 'combat', label: 'Combat', icon: '⚔️', how: 'Arena kills, finishing matches and winning them. Higher levels take a little less damage.' },
  { id: 'trading', label: 'Trading', icon: '📈', how: 'Stock, options and Market trades. Higher levels pay lower stock and Market fees.' },
  { id: 'gambling', label: 'Gambling', icon: '🎰', how: 'Bets placed at the casino (by stake).' },
  { id: 'chess', label: 'Chess', icon: '♟️', how: 'Finish chess or checkers games against people. Higher levels add a few chips to your daily bonus.' },
  { id: 'fishing', label: 'Fishing', icon: '🎣', how: 'Land fish at the Fishing Dock (rarer catches give more XP). Higher levels get quicker bites and rarer fish.' },
  { id: 'cooking', label: 'Cooking', icon: '🍳', how: 'Cook recipes or pan-fry fish in the kitchen of any home you own (harder dishes give more XP).' },
  { id: 'property', label: 'Property', icon: '🏠', how: 'Buy real estate and pay property tax. Higher levels pay less property tax.' },
] as const;
export type SkillId = (typeof SKILLS)[number]['id'];
export const isSkill = (v: unknown): v is SkillId => typeof v === 'string' && SKILLS.some((s) => s.id === v);
export const skillDef = (id: string) => SKILLS.find((s) => s.id === id);

export const MAX_LEVEL = 99;
/** XP_TABLE[L] = total XP needed for level L (L = 1..99), the classic RuneScape curve. XP caps at 200M like RS. */
export const XP_TABLE: number[] = (() => {
  const t = [0, 0]; let pts = 0;
  for (let l = 1; l < MAX_LEVEL; l++) { pts += Math.floor(l + 300 * 2 ** (l / 7)); t.push(Math.floor(pts / 4)); }
  return t;
})();
export const MAX_XP = 200_000_000;
export function levelFor(xp: number): number {
  let lo = 1, hi = MAX_LEVEL;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (XP_TABLE[mid] <= xp) lo = mid; else hi = mid - 1; }
  return lo;
}
/** Progress inside the current level, 0..1 (1 at 99). */
export function progress(xp: number) {
  const level = levelFor(xp);
  if (level >= MAX_LEVEL) return { level, into: xp - XP_TABLE[MAX_LEVEL], need: 0, pct: 1, toNext: 0 };
  const base = XP_TABLE[level], next = XP_TABLE[level + 1];
  return { level, into: xp - base, need: next - base, pct: (xp - base) / (next - base), toNext: next - xp };
}
export const totalLevel = (xp: Partial<Record<string, number>>) => SKILLS.reduce((s, k) => s + levelFor(xp[k.id] ?? 0), 0);

/** Cosmetic titles from total level (no gameplay effect). */
export const TITLES: Array<{ min: number; title: string }> = [
  { min: 0, title: 'Newcomer' }, { min: 25, title: 'Apprentice' }, { min: 75, title: 'Journeyman' }, { min: 150, title: 'Adept' },
  { min: 250, title: 'Expert' }, { min: 400, title: 'Master' }, { min: 600, title: 'Grandmaster' }, { min: SKILLS.length * MAX_LEVEL, title: 'Maxed' },
];
export const titleFor = (total: number) => [...TITLES].reverse().find((t) => total >= t.min)!.title;
/** Per-skill badge: 🥉 at 30, 🥈 at 60, 🥇 at 90, 👑 at 99. Cosmetic. */
export const badgeFor = (level: number) => (level >= 99 ? '👑' : level >= 90 ? '🥇' : level >= 60 ? '🥈' : level >= 30 ? '🥉' : '');
