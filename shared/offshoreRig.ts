/**
 * Offshore drilling rigs: staged construction at a shoreline dock, then launch.
 * A launched rig pumps crude into the owner's Fort McChud tank (or holds it at the dock
 * until there is room / a refinery to take it).
 */
export const RIG_TOTAL = 2_800_000;
export const RIG_LAUNCH_FEE = 200_000;
export const RIG_CRUDE_PER_HOUR = 90;
export const RIG_MAX_PER_PLAYER = 3;
export const RIG_HOLD_CAP = 8_000;

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

export const rigLabel = (r: Pick<RigState, 'status' | 'stage'>) =>
  r.status === 'launched' ? 'On station' : r.status === 'ready' ? 'Ready to launch' : `Building · ${RIG_STAGES[Math.min(r.stage, 3)]!.name}`;
