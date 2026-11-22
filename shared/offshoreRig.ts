/**
 * Offshore drilling rigs: staged construction at a shoreline dock, then launch.
 * A launched rig pumps crude into the owner's Fort McChud tank (or holds it at the dock
 * until there is room / a refinery to take it).
 */
import { GOODS } from './mines.js';
import { buildCashCharge, projectCashCost, type ProjectCashCost } from './buildCosts.js';
export const RIG_TOTAL = 2_800_000;
export const RIG_LAUNCH_FEE = 200_000;
export const RIG_CRUDE_PER_HOUR = 90;
export const RIG_MAX_PER_PLAYER = 3;
export const RIG_HOLD_CAP = 8_000;
/** Convenient chip step on the dock panel (not a contribution cap). */
export const RIG_CHIP_STEP = 10_000;

export type RigStageId = 'hull' | 'derrick' | 'decks' | 'fitout';
export interface RigStagePlan { id: RigStageId; name: string; chips: number; goods: Array<[string, number]> }
export const RIG_STAGES: RigStagePlan[] = [
  { id: 'hull', name: 'Hull & pontoons', chips: 360_000, goods: [['steel_plate', 1_200], ['steel', 400], ['concrete', 600]] },
  { id: 'derrick', name: 'Derrick', chips: 400_000, goods: [['steel_beam', 800], ['steel_cable', 400], ['girder', 200]] },
  { id: 'decks', name: 'Decks & quarters', chips: 380_000, goods: [['steel_plate', 600], ['glass', 200], ['brick', 200]] },
  { id: 'fitout', name: 'Drill & pumps', chips: 360_000, goods: [['pump', 80], ['valve', 120], ['sensor', 60], ['steel_cable', 200]] },
];

export type RigStatus = 'building' | 'ready' | 'launched';
export interface RigState {
  id: string;
  owner: string;
  stage: number;
  done: Array<Record<string, number>>;
  status: RigStatus;
  berth?: number;
  hold: number;
  settledAt: number;
}

const rigPriceOf = (id: string) => GOODS[id]?.price ?? 0;
/** Cash charged if every rig part is filled in one contribute, with no warehouse goods, at `index`. Launch fee is separate. */
export const rigProjectCost = (index: number, priceOf: (id: string) => number = rigPriceOf): ProjectCashCost =>
  projectCashCost(RIG_STAGES.map((s) => ({
    id: s.id, name: s.name, chips: s.chips,
    goods: s.goods.map(([id, qty]) => ({ qty, price: priceOf(id) })),
  })), index);
export const rigLaunchCash = (index: number) => buildCashCharge(RIG_LAUNCH_FEE, index);

export const rigLabel = (r: Pick<RigState, 'status' | 'stage'>) =>
  r.status === 'launched' ? 'On station' : r.status === 'ready' ? 'Ready to launch' : `Building · ${RIG_STAGES[Math.min(r.stage, 3)]!.name}`;

/** Catalog value of one stage: its chips plus its materials at their base price. */
export const rigStageValue = (st: RigStagePlan, priceOf: (id: string) => number) => st.chips + st.goods.reduce((a, [id, n]) => a + n * priceOf(id), 0);
/** 0..1 progress of one stage by value (chips 1:1, materials at their price). */
export const rigStagePct = (st: RigStagePlan, done: Record<string, number>, priceOf: (id: string) => number) => {
  const need = rigStageValue(st, priceOf); if (need <= 0) return 1;
  const got = Math.min(st.chips, done.chips ?? 0) + st.goods.reduce((a, [id, n]) => a + Math.min(n, done[`good:${id}`] ?? 0) * priceOf(id), 0);
  return Math.max(0, Math.min(1, got / need));
};
/** 0..1 progress of the whole rig: finished stages count in full, the current one by value. Ready or launched is 1. */
export const rigPct = (stage: number, doneByStage: Array<Record<string, number> | undefined>, priceOf: (id: string) => number, status?: RigStatus) => {
  if (status === 'ready' || status === 'launched') return 1;
  const total = RIG_STAGES.reduce((a, st) => a + rigStageValue(st, priceOf), 0); if (total <= 0) return 1;
  const got = RIG_STAGES.reduce((a, st, i) => a + rigStageValue(st, priceOf) * (i < stage ? 1 : i === stage ? rigStagePct(st, doneByStage[i] ?? {}, priceOf) : 0), 0);
  return Math.max(0, Math.min(1, got / total));
};
