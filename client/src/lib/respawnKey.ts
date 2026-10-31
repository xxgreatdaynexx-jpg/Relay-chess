/** Space on the death / loadout screen respawns right away (same path as the Respawn button). */
export const SPACE_RESPAWN_GUARD_MS = 400;

export function spaceRespawns(s: { repeat: boolean; alive: boolean; phase: string; broke: boolean; sinceDeathMs: number; typing: boolean }): boolean {
  // Held jump (key repeat) or a press right after dying must not insta-respawn; chat typing never; no respawns outside 'play'.
  return !s.repeat && !s.alive && !s.typing && !s.broke && s.phase === 'play' && s.sinceDeathMs >= SPACE_RESPAWN_GUARD_MS;
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  const tag = (el.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}
