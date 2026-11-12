import { BACKPACK_BASE_CAP, BACKPACK_UPGRADES, MAX_BACKPACK_CAP, type MineBackpackView } from '../../../shared/mineBackpack';

export function MinePackShop({
  view, cap, guest, wallet, msg, onBuy,
}: {
  view: MineBackpackView | null;
  cap: number;
  guest: boolean;
  wallet: number | null;
  msg: string;
  onBuy: (id: string) => void;
}) {
  const next = view?.next ?? null;
  const price = next?.price ?? 0;
  const can = !!view && !guest && !!next && (wallet == null || wallet >= price);
  return (
    <details className="mines-prices mines-tools" open data-testid="mines-pack-shop">
      <summary>🎒 Pack Upgrades</summary>
      <div className="mines-tools-now" data-testid="mines-pack-now">
        Capacity: <b>{cap}</b>{next ? ` · next ${next.cap}` : ' · maxed'}
      </div>
      <div className="mines-pack-path" data-testid="mines-pack-path" style={{ fontSize: 11, opacity: 0.75, margin: '0 0 6px' }}>
        {BACKPACK_BASE_CAP}{BACKPACK_UPGRADES.map((u) => ` → ${u.cap}`).join('')}
      </div>
      {next ? (
        <div className="mines-tool" data-testid={`mines-pack-${next.id}`}>
          <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>🎒</span>
          <span className="mines-tool-name">{next.name}<small>Carry {cap} → {next.cap}</small></span>
          {guest
            ? <em>Sign in</em>
            : (
              <span className="mines-lock" title={wallet != null && wallet < price ? 'Not enough chips' : undefined}>
                <button type="button" data-testid="mines-pack-buy" disabled={!can} onClick={() => onBuy(next.id)}>
                  🪙{price.toLocaleString()}
                </button>
              </span>
            )}
        </div>
      ) : (
        <p className="mines-note" data-testid="mines-pack-max">Your pack is at the maximum {MAX_BACKPACK_CAP} capacity.</p>
      )}
      <p className="mines-note">Bought upgrades are permanent and stay on your account. Guests keep the {BACKPACK_BASE_CAP} starter pack.</p>
      {msg && <p className="mines-note" data-testid="mines-pack-msg">{msg}</p>}
    </details>
  );
}
