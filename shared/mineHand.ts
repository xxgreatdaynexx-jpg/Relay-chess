/**
 * Mine hand selector (request pt2017u): the player explicitly holds either their mining tool or their equipped sword.
 * Client-only presentation/input routing: it never grants a weapon (the server still resolves the owned, equipped weapon
 * for every mines_attack) and never changes damage, reach, cooldowns or mining rules.
 *  - 'tool'  : existing behaviour — a swing attacks a creature on the crosshair, otherwise mines the aimed rock.
 *  - 'sword' : the sword stays in hand; swings only attack, they never mine rock (switch back to the tool to mine).
 */
export type MineHand = 'tool' | 'sword';
export const MINE_HANDS: readonly MineHand[] = ['tool', 'sword'];
export const isMineHand = (v: unknown): v is MineHand => v === 'tool' || v === 'sword';
export const toggleHand = (h: MineHand): MineHand => (h === 'sword' ? 'tool' : 'sword');
/** Keyboard: 1 = mining tool, 2 = sword, Q toggles. Returns null for any other key. */
export function handForKey(key: string, cur: MineHand): MineHand | null {
  if (key === '1') return 'tool';
  if (key === '2') return 'sword';
  if (key === 'q') return toggleHand(cur);
  return null;
}
/** What one swing does: attack an aimed creature (any hand), mine only with the tool out. */
export function swingAction(hand: MineHand, mobAimed: boolean, nodeAimed: boolean): 'attack' | 'mine' | 'air' {
  if (mobAimed) return 'attack';
  if (hand === 'sword') return 'air';
  return nodeAimed ? 'mine' : 'air';
}
