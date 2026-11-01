export * from '../shared/farm';
import { farmPlots } from '../shared/farm';
import { PARK_AREA, obbOverlap } from '../shared/worldLayout';
export const PARK_SAFE = farmPlots().every((p) => !obbOverlap(p, PARK_AREA, 2));
