// Deterministic snapshot of every seeded, id-bearing placement on the city map (ocean regression guard, mu-visuals).
import { farmPlots } from '../shared/farm';
import { fieldPlots } from '../shared/fieldFarms';
import { cityFill, landmarks, parkLayout } from '../shared/worldLayout';
import { outskirts, countryHomes } from '../shared/outskirts';
const r = (n: number) => Math.round(n * 1000) / 1000;
export function layoutSnapshot() {
  return {
    farm: farmPlots().map((p) => [p.n, r(p.x), r(p.z), p.cols, p.rows]),
    fields: fieldPlots().map((p) => [p.n, r(p.x), r(p.z), p.cols, p.rows]),
    houses: cityFill().houses.map((h) => [r(h.x), r(h.z), r(h.w), r(h.d), r(h.rot)]),
    landmarks: Object.entries(landmarks()).map(([id, b]) => [id, r(b.x), r(b.z), r(b.rot)]),
    country: countryHomes().map((h) => [r(h.x), r(h.z), r(h.rot)]),
    park: parkLayout(60).lots.map((l) => [r(l.x), r(l.z)]),
    buildings: outskirts().buildings.map((b) => [b.kind, r(b.x), r(b.z)]),
  };
}
