/**
 * Chud Hub map: ONE main panel at a time (QA r8). Opening any panel replaces the current one; closing a panel never
 * re-opens a list underneath (the old `deeds && !deed` rule made the Real estate list pop back over the farm's seed buttons).
 */
export type WorldPanel =
  | { k: 'none' } | { k: 'farms' } | { k: 'deeds' } | { k: 'deed'; id: string } | { k: 'farm'; id: string }
  | { k: 'venue'; id: 'airport' | 'racetrack' } | { k: 'dealer' } | { k: 'freight' } | { k: 'coop'; tab?: 'project' | 'contracts' | 'supply' | 'fleet' | 'event' } | { k: 'mechanic' } | { k: 'dock' } | { k: 'casino' } | { k: 'home' } | { k: 'kitchen'; id: string } | { k: 'future' } | { k: 'estate'; id?: string; kind?: 'estate' | 'plastics' | 'rigdock' | 'hyper' } | { k: 'spacesim' };
export const NONE: WorldPanel = { k: 'none' };
export const openPanel = (_cur: WorldPanel, next: WorldPanel): WorldPanel => next;
/** Close `k` only if it is the one showing (stale async callbacks can't close a newer panel). */
export const closePanel = (cur: WorldPanel, k: WorldPanel['k']): WorldPanel => (cur.k === k ? NONE : cur);
export const togglePanel = (cur: WorldPanel, next: WorldPanel): WorldPanel => (cur.k === next.k ? NONE : next);
export const panelId = (cur: WorldPanel, k: 'deed' | 'farm' | 'venue' | 'kitchen') => (cur.k === k ? (cur as { id: string }).id : null);
/** Fired by app-level dialogs (Skills, Wallet, tabs) so the map drops its panel instead of leaving it behind them. */
export const CLOSE_WORLD_PANELS = 'world-close-panels';
/** Map panels fire this so the Wallet (fixed, top-right) never sits over the map's corner buttons. */
export const WALLET_CLOSE = 'wallet-close';
