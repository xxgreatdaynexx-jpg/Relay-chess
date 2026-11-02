import { fishById } from '../../../shared/fishing';
import { hasItemIcon } from '../../../shared/itemIcons';
import { ItemIcon } from './ItemIcon';

/** Species glyph for coolers and boards: the crafted fish icon when there is one (reef species), else the emoji. */
export function FishGlyph({ id, size = 18 }: { id: string; size?: number }) {
  if (hasItemIcon('fish', id)) return <ItemIcon type="fish" id={id} size={size} className="fish-glyph" />;
  return <>{fishById(id)?.emoji ?? '🐟'}</>;
}
