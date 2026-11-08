/** A manifest groups existing item keys; individual fish/dish identities remain server rows. */
import { MAX_SHIP_QTY } from './logistics.js';
export interface ManifestLine { item: string; qty: number }
export const MAX_MANIFEST_LINES = 100;
export function shipmentManifest(value: unknown): ManifestLine[] {
 if (!Array.isArray(value) || !value.length || value.length > MAX_MANIFEST_LINES) throw Error('Select 1–100 different items.');
 const seen=new Set<string>();let total=0;
 const lines=value.map(v=>{
  if(!v || typeof v!=='object' || typeof v.item!=='string' || !/^(ore|bar|good|food|crop|gem|fish|fdish|dish):[A-Za-z0-9_]{1,40}$/.test(v.item)) throw Error('Unknown item.');
  if(seen.has(v.item))throw Error('Each item may appear only once.');seen.add(v.item);
  if(!Number.isSafeInteger(v.qty)||v.qty<1)throw Error('Every quantity must be a positive whole number.');
  total+=v.qty;if(!Number.isSafeInteger(total)||total>MAX_SHIP_QTY)throw Error(`One shipment can hold at most ${MAX_SHIP_QTY.toLocaleString('en-US')} total units.`);
  return {item:v.item,qty:v.qty};
 });
 return lines.sort((a,b)=>a.item.localeCompare(b.item));
}
export const manifestUnits=(lines:ManifestLine[])=>lines.reduce((n,l)=>n+l.qty,0);
