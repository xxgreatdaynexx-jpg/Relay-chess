import { itemIconUri } from '../../../shared/itemIcons';

/** Crafted inventory icon for any ore / bar / good. Pass `k` ("type:id") or type + id. */
export function ItemIcon({ k, type, id, size = 20, className = '' }: { k?: string; type?: string; id?: string; size?: number; className?: string }) {
  let t = type, i = id ?? '';
  if (k) { const [a, ...b] = k.replace(/^stack:/, '').split(':'); t = a; i = b.join(':'); }
  return <img src={itemIconUri(t, i)} width={size} height={size} alt="" aria-hidden draggable={false} className={`item-icon ${className}`} style={{ width: size, height: size, minWidth: size, ["--ii" as string]: `${size}px` }} />;
}
