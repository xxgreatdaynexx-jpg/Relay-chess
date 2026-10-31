// Live-play HUD (ammo box, streak pips, UAV countdown) is hidden while dead or spectating.
export const arenaLiveHud = (joined: boolean, alive: boolean): boolean => !joined || alive;
// The canvas KIA strip is drawn only while spectating (sudden death); during play the text is the loadout box header.
export const kiaCanvasStrip = (phase: string): boolean => phase === 'sudden';
