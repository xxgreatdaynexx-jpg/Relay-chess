/**
 * Skill-activity bus. Gameplay modules announce XP-worthy actions here; a skills system (in progress) subscribes with
 * onActivity() and turns them into levels. Fire-and-forget: listeners must not throw into the game path.
 *
 *   onActivity((e) => { if (e.skill === 'fishing') addXp(e.name, 'fishing', e.xp); });
 */
import { EventEmitter } from 'node:events';

export type SkillId = 'fishing';
export interface ActivityEvent { name: string; skill: SkillId; xp: number; action: string; detail?: Record<string, unknown>; at: number }
const bus = new EventEmitter(); bus.setMaxListeners(50);
export function emitActivity(e: ActivityEvent): void {
  try { bus.emit('activity', e); } catch (err) { console.error('[activity] listener failed:', (err as Error).message); }
}
export function onActivity(fn: (e: ActivityEvent) => void): () => void { bus.on('activity', fn); return () => { bus.off('activity', fn); }; }
