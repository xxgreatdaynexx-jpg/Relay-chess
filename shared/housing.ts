/**
 * Housing types for the city filler (pure data, no three.js). Add a type here and the layout + renderer pick it up:
 * each type is one InstancedMesh body (+ optional instanced gable roof) with its own lit-window texture.
 * `id` is stable so houses can be made interactive later (pick → type + index).
 */
export interface HousingType {
  id: string;
  label: string;
  /** footprint range in world units [min, max] for width (x) and depth (z) */
  w: [number, number]; d: [number, number];
  /** floor count range and floor height */
  floors: [number, number]; floorH: number;
  roof: 'flat' | 'gable';
  /** body tints (instance colours, multiplied with the window texture) */
  colors: number[];
  /** window texture: lit colours, chance a window is lit, column/row spacing in texture px */
  windows: { lit: string[]; chance: number; cols: number; rows: number };
  /** which districts this type appears in */
  districts: District[];
}
export type District = 'downtown' | 'midtown' | 'suburb';

export const HOUSING_TYPES: HousingType[] = [
  { id: 'tower', label: 'Residential tower', w: [4, 5], d: [4, 5], floors: [10, 18], floorH: 1, roof: 'flat',
    colors: [0x8890b0, 0x9aa6c8, 0x7f8aa8, 0xa0a0b8], windows: { lit: ['#ffe9a8', '#c8a8ff', '#7fe0ff'], chance: 0.55, cols: 8, rows: 8 }, districts: ['downtown'] },
  { id: 'apartment', label: 'Apartment block', w: [5.5, 7.5], d: [3.5, 4.5], floors: [4, 8], floorH: 1, roof: 'flat',
    colors: [0xb08a78, 0x9c7f6e, 0xc0a890, 0x8f9aa8, 0xa89a80], windows: { lit: ['#ffb870', '#ffd890'], chance: 0.5, cols: 8, rows: 10 }, districts: ['downtown', 'midtown'] },
  { id: 'rowhouse', label: 'Row houses', w: [7, 9], d: [2.6, 3.2], floors: [2, 3], floorH: 1.1, roof: 'gable',
    colors: [0xc27a5a, 0xd8b07a, 0x8fa8a0, 0xb88aa0, 0xe0d0b0], windows: { lit: ['#ffc880', '#fff0b0'], chance: 0.45, cols: 6, rows: 16 }, districts: ['midtown', 'suburb'] },
  { id: 'house', label: 'Detached home', w: [2.4, 3.2], d: [2.4, 3.2], floors: [1, 2], floorH: 1.2, roof: 'gable',
    colors: [0xe8e0d0, 0xa8c8e0, 0xf0d0a0, 0xc8e0b0, 0xe0b0a8, 0xd0c0e8], windows: { lit: ['#ffcf7a'], chance: 0.4, cols: 10, rows: 20 }, districts: ['suburb'] },
];
export const housingType = (id: string) => HOUSING_TYPES.find((t) => t.id === id)!;
