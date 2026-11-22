/**
 * Cash the server charges for private construction (estate projects, hyper farm, offshore rig).
 * One contribute call of `base` house-set chips — or materials bought at catalog as `unitPrice * qty` —
 * is billed as indexed(base, today's price index). Display must use this same function.
 */
import { indexed } from './priceIndex.js';

/** Exact chip debit for one house-set amount (one contribute / fill of that amount). */
export const buildCashCharge = (base: number, index: number): number => indexed(base, index);

export type StageCashCost = { chips: number; materials: number; total: number };
export type ProjectCashCost = StageCashCost & {
  stages: Array<{ id: string; name: string } & StageCashCost>;
};

export function stageCashCost(
  chipsBase: number,
  goods: Array<{ qty: number; price: number }>,
  index: number,
): StageCashCost {
  const chips = buildCashCharge(chipsBase, index);
  const materials = goods.reduce((a, g) => a + buildCashCharge(g.qty * g.price, index), 0);
  return { chips, materials, total: chips + materials };
}

export function projectCashCost(
  stages: Array<{ id: string; name: string; chips: number; goods: Array<{ qty: number; price: number }> }>,
  index: number,
): ProjectCashCost {
  const out = stages.map((s) => ({ id: s.id, name: s.name, ...stageCashCost(s.chips, s.goods, index) }));
  return {
    chips: out.reduce((a, s) => a + s.chips, 0),
    materials: out.reduce((a, s) => a + s.materials, 0),
    total: out.reduce((a, s) => a + s.total, 0),
    stages: out,
  };
}
