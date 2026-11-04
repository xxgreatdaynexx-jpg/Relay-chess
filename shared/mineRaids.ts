/**
 * Co-op mine raids (Millionaire Update): parties of 2-4 enter any mine together in their own instance.
 *  - Creatures in a party instance scale with party size (more HP, a little more damage).
 *  - Personal ore: every member has their own copy of each vein, and every member on the floor gets their own loot when a party creature dies.
 *  - Party bosses: tougher, and a kill adds a group loot roll (one d100 per member on the floor; the highest roll takes the bonus pot).
 * Pure rules only; server/mineRaids.ts owns the parties and server/mines.ts the instances.
 */
export const RAID_MAX = 4;
export const RAID_CODE = /^[A-Z0-9]{5}$/;
export const RAID_INVITE_MS = 10 * 60_000;
/** Creature HP multiplier for a party of n (solo = 1). */
export const raidHpMul = (n: number) => 1 + 0.75 * (Math.max(1, Math.min(RAID_MAX, n)) - 1);
/** Creature damage multiplier for a party of n. */
export const raidDmgMul = (n: number) => 1 + 0.15 * (Math.max(1, Math.min(RAID_MAX, n)) - 1);
/** Party boss HP: on top of raidHpMul. */
export const RAID_BOSS_HP_MUL = 1.25;
export const raidBossHpMul = (n: number) => raidHpMul(n) * (n > 1 ? RAID_BOSS_HP_MUL : 1);
/** Bonus ore in the party-boss pot: 2 per member, floored by depth. */
export const raidPotSize = (n: number, floor: number) => 2 * Math.max(1, Math.min(RAID_MAX, n)) + Math.floor(Math.min(40, floor) / 10);
/** Who may join a raid: signed-in players only; no QA, bot or jailed accounts. */
const BOT = /^(qa-bot-|bot[-_ ]|cpu[-_ ])/i;
export function raidBlockReason(name: string | null, o: { qa: boolean; jailed: boolean }): string | null {
  if (!name) return 'Sign in to join a raid party.';
  if (o.qa || BOT.test(name.trim())) return 'QA and bot accounts can’t join raid parties.';
  if (o.jailed) return 'You can’t raid from jail.';
  return null;
}
export interface RaidRoll { name: string; roll: number }
/** Group loot roll: one 1..100 roll per member (ties re-rolled), highest wins. Deterministic given rng. */
export function lootRoll(names: string[], rng: () => number): { rolls: RaidRoll[]; winner: string | null } {
  if (!names.length) return { rolls: [], winner: null };
  const r = () => 1 + Math.floor(Math.min(0.999999, Math.max(0, rng())) * 100);
  let rolls = names.map((name) => ({ name, roll: r() }));
  for (let i = 0; i < 20; i++) {
    const top = Math.max(...rolls.map((x) => x.roll)); const tied = rolls.filter((x) => x.roll === top);
    if (tied.length === 1) return { rolls, winner: tied[0].name };
    rolls = rolls.map((x) => (x.roll === top ? { ...x, roll: r() } : x));
  }
  return { rolls, winner: rolls.reduce((a, b) => (b.roll > a.roll ? b : a)).name };
}
export interface RaidView { id: string; code: string; leader: string; members: Array<{ name: string; online: boolean; cave: string | null; floor: number | null }>; size: number }
export interface RaidLootMsg { floor: number; boss: string; rolls: RaidRoll[]; winner: string | null; pot: Array<{ id: string; qty: number }> }
