/** Tess misc: why a mine gear/tool buy button is locked (shown as a tooltip on a wrapper, since disabled buttons don't hover). */
export function gearLockReason(list: ReadonlyArray<{ id: string; tier: number; name: string }>, item: { tier: number }, can: boolean, guest: boolean, wallet: number | null | undefined, price: number): string {
  if (guest) return 'Locked: sign in to buy gear.';
  if (!can) { const prev = list.find((x) => x.tier === item.tier - 1); return `Locked: buy the ${prev?.name ?? 'previous tier'} first (tiers unlock in order).`; }
  if (wallet != null && wallet < price) return `Locked: you need 🪙 ${(price - wallet).toLocaleString()} more chips.`;
  return '';
}
