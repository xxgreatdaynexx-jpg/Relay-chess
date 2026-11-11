/**
 * Staged 3D models for private construction sites, Goldwood mansions, wineries, the plastics plant,
 * the shoreline dock and offshore rigs. Each build type has a distinct silhouette at every stage,
 * in the same spirit as the co-op hockey stadium.
 */
import * as THREE from 'three';
import type { EstateBuildId } from '../../../shared/estateProjects';

const mats = new Map<string, THREE.MeshStandardMaterial>();
const M = (color: number, rough = 0.8, metal = 0, emissive = 0, ei = 0, opacity = 1) => {
  const k = `${color}|${rough}|${metal}|${emissive}|${ei}|${opacity}`;
  let m = mats.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei, transparent: opacity < 1, opacity });
    mats.set(k, m);
  }
  return m;
};
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);

type Add = {
  B: (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry?: number) => THREE.Mesh;
  C: (r: number, h: number, m: THREE.Material, x: number, y: number, z: number) => THREE.Mesh;
  g: THREE.Group;
};

function tools(name: string): Add {
  const g = new THREE.Group(); g.name = name;
  const B = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const o = new THREE.Mesh(BOX, m); o.scale.set(w, h, d); o.position.set(x, y + h / 2, z); o.rotation.y = ry; g.add(o); return o;
  };
  const C = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(CYL, m); o.scale.set(r, h, r); o.position.set(x, y + h / 2, z); g.add(o); return o;
  };
  return { B, C, g };
}

function sitePad(a: Add, w: number, d: number, crane: boolean) {
  const dirt = M(0x7a5a3a, 1), hoard = M(0xf59e0b, 0.6), yellow = M(0xf5c518, 0.5, 0.3);
  a.B(w + 4, 0.2, d + 4, dirt, 0, 0, 0);
  for (const [ww, dd, x, z] of [[w + 4, 0.12, 0, -(d + 4) / 2], [w + 4, 0.12, 0, (d + 4) / 2], [0.12, d + 4, -(w + 4) / 2, 0], [0.12, d + 4, (w + 4) / 2, 0]] as const)
    a.B(ww, 1.4, dd, hoard, x, 0, z);
  if (crane) {
    a.B(0.8, 20, 0.8, yellow, w / 2 - 1, 0, -d / 2 + 1);
    a.B(16, 0.5, 0.5, yellow, w / 2 - 8, 20, -d / 2 + 1);
  }
}

export function buildEstateModel(type: EstateBuildId, done: number, frac = 0): THREE.Group {
  const stage = (i: number) => (done > i ? 1 : done === i ? frac : 0);
  if (type === 'data_center') return dataCenter(stage, done);
  if (type === 'bitcoin_farm') return bitcoinFarm(stage, done);
  if (type === 'monument') return monument(stage, done);
  if (type === 'mansion') return mansion(stage, done);
  if (type === 'highrise') return highrise(stage, done);
  return powerPlant(stage, done);
}

function dataCenter(stage: (i: number) => number, done: number) {
  const a = tools(`data-center-${done}`); const conc = M(0xb9b3a8, 0.95), dark = M(0x3a4048, 0.5, 0.4), glass = M(0x4a7f95, 0.2, 0.4, 0x3a6a80, 0.5), rack = M(0x1a1f28, 0.4, 0.3);
  if (done < 4) sitePad(a, 28, 22, true);
  if (stage(0) > 0) a.B(28 * stage(0), 0.8, 22, conc, 0, 0, 0);
  if (stage(1) > 0) {
    a.B(26, 8 * stage(1), 20, dark, 0, 0.8, 0);
    a.B(24, 6 * stage(1), 0.4, glass, 0, 1.6, 10);
  }
  if (stage(2) > 0) {
    a.B(8, 6 * stage(2), 8, M(0x8d877d, 0.9), 16, 0.8, 0);
    a.C(1.6, 4 * stage(2), M(0x6a7080, 0.4, 0.5), 16, 6, 0);
  }
  if (stage(3) > 0) {
    for (let i = 0; i < Math.round(8 * stage(3)); i++) a.B(1.2, 3, 2.4, rack, -10 + (i % 4) * 3, 1, -4 + Math.floor(i / 4) * 5);
    a.B(10, 1.2, 0.3, M(0x3aaa6a, 0.4, 0, 0x3aaa6a, 0.8), 0, 9, 10.2);
  }
  return a.g;
}

function bitcoinFarm(stage: (i: number) => number, done: number) {
  const a = tools(`bitcoin-${done}`); const conc = M(0xb9b3a8, 0.95), shed = M(0x5a4030, 0.9), gold = M(0xf5c518, 0.4, 0.6, 0xf5c518, 0.4);
  if (done < 4) sitePad(a, 24, 20, true);
  if (stage(0) > 0) a.B(24 * stage(0), 0.7, 20, conc, 0, 0, 0);
  if (stage(1) > 0) { a.B(22, 6 * stage(1), 18, shed, 0, 0.7, 0); a.B(23, 0.4, 19, M(0x3a2a20, 0.8), 0, 6.7 * stage(1), 0); }
  if (stage(2) > 0) for (const x of [-8, 0, 8]) a.C(1.2, 3 * stage(2), M(0x8899aa, 0.5, 0.4), x, 6.8, 8);
  if (stage(3) > 0) {
    for (let i = 0; i < Math.round(12 * stage(3)); i++) a.B(1.6, 1.2, 0.8, gold, -8 + (i % 6) * 3, 1.4, -4 + Math.floor(i / 6) * 5);
    a.B(6, 1.4, 0.3, gold, 0, 7.2, 9.2);
  }
  return a.g;
}

function monument(stage: (i: number) => number, done: number) {
  const a = tools(`monument-${done}`); const stone = M(0xcfc8b8, 0.9), bronze = M(0xb5803a, 0.4, 0.7), gold = M(0xd4af37, 0.3, 0.8, 0xd4af37, 0.35);
  if (done < 4) sitePad(a, 18, 18, done < 2);
  if (stage(0) > 0) a.C(8 * stage(0), 0.5, stone, 0, 0, 0);
  if (stage(1) > 0) a.B(8, 4 * stage(1), 8, stone, 0, 0.5, 0);
  if (stage(2) > 0) {
    a.C(1.4, 8 * stage(2), bronze, 0, 4.5, 0);
    a.C(2.2, 3 * stage(2), bronze, 0, 12.5, 0);
    a.C(1.2, 2 * stage(2), bronze, 0, 15.5, 0);
  }
  if (stage(3) > 0) {
    for (const [x, z] of [[-7, -7], [7, -7], [-7, 7], [7, 7]] as const) { a.C(0.2, 6 * stage(3), M(0x555a66, 0.4, 0.6), x, 0, z); a.C(0.5, 0.4, gold, x, 6 * stage(3), z); }
  }
  return a.g;
}

function mansion(stage: (i: number) => number, done: number) {
  const a = tools(`mansion-${done}`); const stone = M(0xe9e4d8, 0.85), roof = M(0x6a2a2a, 0.8), win = M(0x9fd4ff, 0.2, 0.3, 0x4aa0ff, 0.4);
  if (done < 4) sitePad(a, 32, 24, true);
  if (stage(0) > 0) a.B(30 * stage(0), 0.8, 22, M(0xb9b3a8, 0.95), 0, 0, 0);
  if (stage(1) > 0) { a.B(28, 7 * stage(1), 16, stone, 0, 0.8, 0); a.B(12, 7 * stage(1), 10, stone, 0, 0.8, -10); }
  if (stage(2) > 0) {
    a.B(30, 2 * stage(2), 18, roof, 0, 7.8, 0);
    a.B(14, 2 * stage(2), 12, roof, 0, 7.8, -10);
  }
  if (stage(3) > 0) {
    for (const x of [-8, -3, 3, 8]) a.B(2, 2, 0.2, win, x, 3, 8.1);
    a.C(0.8, 3 * stage(3), stone, 12, 7.8, 0);
    a.B(6, 0.4, 10, M(0x3a8a40, 1), 0, 0.2, 14);
  }
  return a.g;
}

function highrise(stage: (i: number) => number, done: number) {
  const a = tools(`highrise-${done}`); const conc = M(0xb9b3a8, 0.95), skin = M(0x8890b0, 0.3, 0.4), glass = M(0x9fd6e8, 0.15, 0.4, 0x6fb6d8, 0.5), gold = M(0xd4af37, 0.3, 0.7, 0xd4af37, 0.5);
  if (done < 4) sitePad(a, 22, 22, true);
  if (stage(0) > 0) a.B(20 * stage(0), 1.2, 20, conc, 0, 0, 0);
  const floors = Math.max(0, Math.round(16 * stage(1)));
  if (floors) a.B(16, floors * 2.2, 16, skin, 0, 1.2, 0);
  if (stage(2) > 0) a.B(16.6, floors * 2.2 * stage(2), 0.3, glass, 0, 1.2, 8.15);
  if (stage(3) > 0 && floors) {
    a.B(8, 4 * stage(3), 8, gold, 0, 1.2 + floors * 2.2, 0);
    a.C(0.3, 8 * stage(3), gold, 0, 5.2 + floors * 2.2, 0);
  }
  return a.g;
}

function powerPlant(stage: (i: number) => number, done: number) {
  const a = tools(`power-plant-${done}`); const conc = M(0xb9b3a8, 0.95), hall = M(0x6a7080, 0.6, 0.3), rust = M(0x8a5a3a, 0.8);
  if (done < 4) sitePad(a, 36, 26, true);
  if (stage(0) > 0) a.B(36 * stage(0), 0.8, 26, conc, 0, 0, 0);
  if (stage(1) > 0) { a.B(14, 10 * stage(1), 16, hall, -8, 0.8, 0); a.C(3, 14 * stage(1), rust, -8, 0.8, 0); }
  if (stage(2) > 0) { a.B(16, 8 * stage(2), 14, hall, 10, 0.8, 0); a.C(2, 4 * stage(2), M(0xc8d4e0, 0.3, 0.6), 10, 8.8, 0); }
  if (stage(3) > 0) {
    for (let i = 0; i < Math.round(4 * stage(3)); i++) a.B(0.4, 12, 0.4, M(0x555a66, 0.3, 0.7), 16, 0.8, -8 + i * 5);
    a.B(10, 4, 6, M(0x3a4048, 0.5), -16, 0.8, 8);
  }
  return a.g;
}

export function buildHyperFarm(done: number, frac = 0, w = 20, d = 16): THREE.Group {
  const a = tools(`hyper-${done}`); const stage = (i: number) => (done > i ? 1 : done === i ? frac : 0);
  const bed = M(0x5a3a20, 1), steel = M(0x8a929a, 0.3, 0.6), glass = M(0x9fd6e8, 0.1, 0.2, 0x6fb6d8, 0.35, 0.45);
  a.B(w, 0.3, d, bed, 0, 0, 0);
  if (stage(0) > 0) for (let i = 0; i < 4; i++) a.B(w - 2, 0.4, 1.2, M(0x4a2a14, 1), 0, 0.3, -d / 2 + 2 + i * (d - 4) / 3);
  if (stage(1) > 0) {
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) a.B(0.25, 6 * stage(1), 0.25, steel, x, 0.3, z);
    a.B(w, 0.2, d, steel, 0, 6 * stage(1), 0);
  }
  if (stage(2) > 0) {
    a.B(w, 6 * stage(2), 0.1, glass, 0, 0.3, d / 2);
    a.B(w, 6 * stage(2), 0.1, glass, 0, 0.3, -d / 2);
    a.B(0.1, 6 * stage(2), d, glass, w / 2, 0.3, 0);
    a.B(0.1, 6 * stage(2), d, glass, -w / 2, 0.3, 0);
  }
  if (stage(3) > 0) {
    a.C(0.6, 2 * stage(3), M(0x8899aa, 0.4), w / 2 - 1, 6, 0);
    for (const z of [-4, 0, 4]) a.B(w - 4, 0.3, 0.8, M(0x3aaa4a, 0.8), 0, 0.6, z);
  }
  return a.g;
}

export function buildRig(done: number, frac = 0, launched = false): THREE.Group {
  const a = tools(`rig-${done}`); const stage = (i: number) => (done > i ? 1 : done === i ? frac : 0);
  const steel = M(0x6a7080, 0.4, 0.6), deck = M(0xc4b49a, 0.8), flame = M(0xff7a1a, 0.4, 0, 0xff7a1a, 1.2);
  if (!launched && done < 4) sitePad(a, 22, 16, true);
  if (stage(0) > 0) { a.B(20 * stage(0), 2, 10, steel, 0, launched ? 4 : 0, 0); for (const x of [-8, 8]) a.C(2, 3, steel, x, launched ? 1 : 0, 0); }
  if (stage(1) > 0) { a.B(1.2, 16 * stage(1), 1.2, steel, 0, launched ? 6 : 2, 0); a.B(8, 0.4, 0.4, steel, 0, (launched ? 6 : 2) + 16 * stage(1), 0); }
  if (stage(2) > 0) { a.B(16, 3 * stage(2), 10, deck, 0, launched ? 6 : 2, 0); a.B(6, 3 * stage(2), 6, M(0xe9e4d8, 0.8), 6, launched ? 9 : 5, 0); }
  if (stage(3) > 0) { a.C(0.4, 8 * stage(3), steel, -6, launched ? 9 : 5, 0); a.C(0.7, 1, flame, -6, (launched ? 9 : 5) + 8 * stage(3), 0); }
  if (launched) a.B(24, 0.2, 14, M(0x1a3a5a, 0.3, 0, 0x1a3a5a, 0.2, 0.5), 0, 0, 0);
  return a.g;
}

export function buildPlasticsPlant(): THREE.Group {
  const a = tools('plastics-plant'); const hall = M(0xcfd6dc, 0.7), tank = M(0x8ad0e0, 0.3, 0.4), pipe = M(0x6a7080, 0.4, 0.5);
  a.B(20, 8, 14, hall, 0, 0, 0);
  a.B(20.4, 0.5, 14.4, M(0x4a5560, 0.6), 0, 8, 0);
  for (const x of [-7, 0, 7]) a.C(2.2, 10, tank, x, 0, 9);
  a.B(16, 0.4, 0.4, pipe, 0, 9, 9);
  a.B(8, 4, 6, M(0x3a4048, 0.5), -10, 0, -6);
  a.B(6, 1.4, 0.3, M(0x8ad0e0, 0.4, 0, 0x8ad0e0, 0.7), 0, 6, 7.2);
  return a.g;
}

export function buildRigDock(): THREE.Group {
  const a = tools('rig-dock'); const wood = M(0x8a6440, 0.9), steel = M(0x6a7080, 0.4, 0.6);
  a.B(28, 1, 16, wood, 0, 0, 0);
  a.B(8, 8, 10, M(0x5a4030, 0.85), -8, 1, 0);
  a.B(0.8, 16, 0.8, steel, 8, 1, 0);
  a.B(18, 0.6, 0.6, steel, 0, 17, 0);
  a.B(20, 0.4, 6, wood, 4, 1, 10);
  return a.g;
}

export function buildWinery(): THREE.Group {
  const a = tools('winery'); const stone = M(0xe9e4d8, 0.85), roof = M(0x6a2a2a, 0.8), vine = M(0x3a7a3a, 0.9);
  a.B(16, 7, 12, stone, 0, 0, 0);
  a.B(18, 2.2, 14, roof, 0, 7, 0);
  for (let i = 0; i < 6; i++) a.B(10, 0.8, 0.5, vine, 0, 0.2, 8 + i * 1.4);
  a.C(1.2, 4, M(0x7a1a3a, 0.6), 8, 0, -2);
  return a.g;
}

export function buildGoldwoodMansion(floors = 2): THREE.Group {
  return mansion((i) => 1, 4);
  void floors;
}

export function buildAirportTerminal(): THREE.Group {
  const a = tools('intl-terminal');
  const hall = M(0xe8ecf2, 0.5, 0.2), dark = M(0x1a1d24, 0.5), win = M(0x9fd4ff, 0.15, 0.3, 0x4aa0ff, 0.55, 0.75), neon = M(0xd4af37, 0.4, 0.4, 0xd4af37, 0.7);
  // Long international hall + two concourses + a taller control tower
  a.B(42, 8, 16, hall, 0, 0, 2);
  a.B(42.6, 0.5, 16.6, dark, 0, 8, 2);
  a.B(41, 5, 0.3, win, 0, 2, 10.1);
  a.B(28, 5, 8, hall, -22, 0, -10);
  a.B(28, 5, 8, hall, 22, 0, -10);
  a.C(2.2, 22, dark, -14, 0, 6);
  a.C(3.4, 3, win, -14, 22, 6);
  a.C(3.6, 0.4, neon, -14, 25, 6);
  a.B(10, 2, 4, hall, 0, 0, 12); // arrivals canopy
  a.B(16, 1.2, 0.3, neon, 0, 9, 10.2);
  return a.g;
}
