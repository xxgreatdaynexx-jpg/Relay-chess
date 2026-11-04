import * as THREE from 'three';
import type { BuildingId } from '../../../shared/city';

/**
 * Civic district models (mayor buildings), modelled on real Calgary/Alberta references
 * (/workspace/millionaire-shots/mayor/refs): Calgary Police HQ (red brick wings + blue glass atrium),
 * Calgary Transit stations (glass shelter, long canopy, bus bays, red/white buses), Foothills Medical Centre
 * (white podium + window-grid tower, helipad, ER canopy, red cross), Alberta elementary schools (brick, flat roof,
 * entry canopy, flagpole, playground), Prince's Island Park (paths, pond, deciduous trees, benches), Deerfoot Trail
 * (divided lanes, overpass, green gantry sign) and 17 Ave lamp posts (lit halos at night).
 * Stage 1 = partial (foundations / first floor / exposed frame), 2 = shell, 3 = finished with signage + night lights.
 * Shared unit geometries + one material palette per world, so rebuilding a plot allocates only meshes.
 */
export interface CivicKit {
  build(id: BuildingId, stage: number, building: number | null, w: number, d: number, g: THREE.Group): void;
  /** emissive materials (scale with the world's glowK) and halo sprite materials (opacity follows night) */
  glow: THREE.MeshStandardMaterial[]; halos: THREE.SpriteMaterial[]; dispose(): void;
}

export function createCivicKit(low: boolean, glowTex: THREE.Texture): CivicKit {
  const own: Array<{ dispose(): void }> = []; const glow: THREE.MeshStandardMaterial[] = []; const halos: THREE.SpriteMaterial[] = [];
  const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, low ? 8 : 14), cone = new THREE.ConeGeometry(0.5, 1, low ? 6 : 10),
    sph = new THREE.IcosahedronGeometry(0.5, low ? 0 : 1), disc = new THREE.CylinderGeometry(0.5, 0.5, 1, low ? 16 : 32); own.push(box, cyl, cone, sph, disc);
  const M = (o: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.8, ...o }); own.push(m); if ((o.emissiveIntensity ?? 0) > 0) { m.userData.ei = o.emissiveIntensity; glow.push(m); } return m; };
  const C = {
    pad: M({ color: 0x9c9384, roughness: 0.95 }), conc: M({ color: 0xd9d4ca }), concDk: M({ color: 0xa8a39a }), white: M({ color: 0xf1f3f4, roughness: 0.6 }),
    brick: M({ color: 0x9a4a35, roughness: 0.9 }), brickDk: M({ color: 0x7a3626, roughness: 0.9 }), tan: M({ color: 0xc9b48e }),
    glass: M({ color: 0x5f8fb8, metalness: 0.5, roughness: 0.15, emissive: 0xffd99a, emissiveIntensity: 0.35 }), // warm lit windows at night
    glassBlue: M({ color: 0x2f6fb3, metalness: 0.6, roughness: 0.12, emissive: 0x9fd0ff, emissiveIntensity: 0.4 }),
    glassClr: M({ color: 0xa9d6f0, metalness: 0.3, roughness: 0.1, transparent: true, opacity: 0.55, emissive: 0xcfe8ff, emissiveIntensity: 0.25 }),
    mullion: M({ color: 0x3a3f46, metalness: 0.6, roughness: 0.4 }), steel: M({ color: 0xb9bec4, metalness: 0.6, roughness: 0.4 }), dark: M({ color: 0x24282d }),
    asphalt: M({ color: 0x2b2e33, roughness: 1 }), lineW: M({ color: 0xf4f4f0 }), lineY: M({ color: 0xffc928 }), barrier: M({ color: 0xc8c4bb }),
    grass: M({ color: 0x4d9c45, roughness: 1 }), grassDk: M({ color: 0x3c8137, roughness: 1 }), path: M({ color: 0xd8c9a3, roughness: 1 }), water: M({ color: 0x3f86b8, metalness: 0.2, roughness: 0.15, emissive: 0x0a2a44, emissiveIntensity: 0.2 }),
    trunk: M({ color: 0x5a3e2a }), leaf: M({ color: 0x3f8a3a }), leaf2: M({ color: 0x5aa441 }), leafAut: M({ color: 0xd9a330 }), pine: M({ color: 0x2c6b35 }), wood: M({ color: 0x8a5a36 }),
    red: M({ color: 0xd42a2a }), redLit: M({ color: 0xe02020, emissive: 0xff2020, emissiveIntensity: 1.1 }), blueLit: M({ color: 0x2050e0, emissive: 0x3060ff, emissiveIntensity: 1.1 }),
    lamp: M({ color: 0xfff3c4, emissive: 0xffe0a0, emissiveIntensity: 1.6 }), yellow: M({ color: 0xffc21a }), orange: M({ color: 0xff7a1a }), green: M({ color: 0x1d6b3a }),
    busRed: M({ color: 0xc8202a }), helipad: M({ color: 0x4a5058 }), rubber: M({ color: 0x8b4a3a, roughness: 1 }), play1: M({ color: 0x2f9be0 }), play2: M({ color: 0xffb020 }),
  };
  const texCache = new Map<string, THREE.MeshStandardMaterial>();
  const signMat = (text: string, bg: string, fg: string, lit = 0.9) => { const k = text + bg + fg; const hit = texCache.get(k); if (hit) return hit;
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d')!; x.fillStyle = bg; x.fillRect(0, 0, 512, 128); x.fillStyle = fg;
    x.font = '800 78px Outfit Variable, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 68, 490);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; own.push(t); const m = M({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: lit, roughness: 0.6 }); texCache.set(k, m); return m; };
  const haloMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffe2a6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }); own.push(haloMat); halos.push(haloMat);
  const redHalo = new THREE.SpriteMaterial({ map: glowTex, color: 0xff3030, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }); own.push(redHalo); halos.push(redHalo);

  const build: CivicKit['build'] = (id, st, bld, W, D, g) => {
    const add = (gm: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, ry = 0) => { const o = new THREE.Mesh(gm, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = !low; o.receiveShadow = !low; o.matrixAutoUpdate = false; o.updateMatrix(); g.add(o); return o; };
    /** box by its bottom (y0 = base height) */
    const B = (w: number, h: number, d: number, m: THREE.Material, x: number, y0: number, z: number, ry = 0) => add(box, m, w, h, d, x, y0 + h / 2, z, ry);
    const Cy = (r: number, h: number, m: THREE.Material, x: number, y0: number, z: number) => add(cyl, m, r * 2, h, r * 2, x, y0 + h / 2, z);
    const halo = (x: number, y: number, z: number, s = 1.6, m = haloMat) => { const sp = new THREE.Sprite(m); sp.scale.set(s, s, 1); sp.position.set(x, y, z); g.add(sp); };
    const G = 0.12; // pad top
    /** a window band on the +z face (and optionally +x): glass strip + mullions */
    const winRow = (w: number, x: number, y: number, z: number, m: THREE.Material = C.glass, h = 0.55) => { B(w, h, 0.06, m, x, y, z); if (!low) for (let k = 0; k <= Math.floor(w / 0.8); k++) B(0.05, h, 0.08, C.mullion, x - w / 2 + k * (w / Math.floor(w / 0.8)), y, z); };
    const winRowX = (d: number, x: number, y: number, z: number, m: THREE.Material = C.glass, h = 0.55) => { B(0.06, h, d, m, x, y, z); if (!low) for (let k = 0; k <= Math.floor(d / 0.8); k++) B(0.08, h, 0.05, C.mullion, x, y, z - d / 2 + k * (d / Math.floor(d / 0.8))); };
    const tree = (x: number, z: number, s: number, m: THREE.Material = C.leaf) => { Cy(0.09 * s, 0.9 * s, C.trunk, x, G, z); add(sph, m, 1.3 * s, 1.15 * s, 1.3 * s, x, G + 1.35 * s, z); if (!low) add(sph, m, 0.9 * s, 0.8 * s, 0.9 * s, x + 0.25 * s, G + 1.75 * s, z - 0.1 * s); };
    const lampPost = (x: number, z: number, h = 2.6, arm = 0.5, dir = 1) => { Cy(0.05, h, C.mullion, x, G, z); B(0.06, 0.06, arm, C.mullion, x, G + h - 0.03, z - dir * arm / 2); B(0.28, 0.1, 0.36, C.lamp, x, G + h - 0.12, z - dir * arm); halo(x, G + h - 0.2, z - dir * arm, 1.7); };
    const car = (x: number, z: number, m: THREE.Material, ry = 0) => { const o = new THREE.Group(); o.position.set(x, G, z); o.rotation.y = ry; g.add(o); const sub = (w: number, h: number, d: number, mm: THREE.Material, xx: number, y0: number, zz: number) => { const k = new THREE.Mesh(box, mm); k.scale.set(w, h, d); k.position.set(xx, y0 + h / 2, zz); o.add(k); return k; };
      sub(1.5, 0.35, 0.7, m, 0, 0.12, 0); sub(0.8, 0.28, 0.62, C.glass, -0.05, 0.47, 0); return { o, sub }; };
    const flag = (x: number, z: number, h: number) => { Cy(0.04, h, C.steel, x, G, z); const f = signMat('🍁', '#ffffff', '#d42a2a', 0.15); B(0.9, 0.5, 0.03, f, x + 0.47, G + h - 0.55, z); B(0.2, 0.5, 0.035, C.red, x + 0.12, G + h - 0.55, z); B(0.2, 0.5, 0.035, C.red, x + 0.82, G + h - 0.55, z); };

    if (id === 'police') { // Calgary Police HQ: two red-brick wings, curved blue-glass atrium, flags, cruisers
      if (st >= 1) { B(10.4, 1.5, 4.6, C.brick, 0, G, -0.6); winRow(3.6, -3.2, G + 0.55, 1.72); winRow(3.6, 3.2, G + 0.55, 1.72); B(10.6, 0.15, 4.8, C.concDk, 0, G + 1.5, -0.6);
        if (st === 1) for (const x of [-5, -2.5, 2.5, 5]) for (const z of [-2.6, 1.4]) B(0.14, 2, 0.14, C.steel, x, G + 1.65, z); }
      if (st >= 2) { for (const s of [-1, 1]) { B(4, 2.6, 4.6, C.brick, s * 3.2, G + 1.65, -0.6); winRow(3.6, s * 3.2, G + 2.1, 1.72); winRow(3.6, s * 3.2, G + 3.25, 1.72); winRowX(3.8, s * 5.22, G + 2.1, -0.6); winRowX(3.8, s * 5.22, G + 3.25, -0.6);
          B(4.2, 0.2, 4.8, C.conc, s * 3.2, G + 4.25, -0.6); B(4.1, 0.12, 0.2, C.tan, s * 3.2, G + 1.5, 1.72); }
        add(cyl, C.glassBlue, 2.6, st >= 3 ? 4.9 : 3, 2.6, 0, G + (st >= 3 ? 4.9 : 3) / 2, 1.0); }
      if (st >= 3) { add(cyl, C.white, 2.9, 0.2, 2.9, 0, G + 4.95, 1.0); for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + (k / 5) * Math.PI; B(0.06, 4.9, 0.06, C.mullion, Math.sin(a) * 1.31, G, 1.0 + Math.cos(a) * 1.31); }
        B(3.4, 0.14, 1.4, C.conc, 0, G + 1.9, 2.6); for (const x of [-1.5, 1.5]) Cy(0.06, 1.9, C.steel, x, G, 3.2);
        B(3.2, 0.5, 0.06, signMat('POLICE', '#14306e', '#ffffff'), 0, G + 2.1, 3.32); B(2.6, 0.35, 0.05, signMat('CALGARY · CHUD HUB', '#14306e', '#bcd4ff', 0.5), 3.2, G + 3.75, 1.78);
        flag(-5.4, 3.0, 3.6); flag(-4.4, 3.0, 3.2);
        for (const [x, ry] of [[3.6, 0.2], [5.1, -0.1]] as const) { const c = car(x, 2.9, C.white, ry); c.sub(1.52, 0.12, 0.72, C.dark, 0, 0.28, 0); c.sub(0.3, 0.08, 0.5, C.redLit, -0.12, 0.76, 0.12); c.sub(0.3, 0.08, 0.5, C.blueLit, -0.12, 0.76, -0.12); }
        if (!low) for (const x of [-5.6, 5.6]) tree(x, -3, 0.8); }
    } else if (id === 'transit') { // Calgary Transit station: bus bays, glass shelter building, long canopy, red/white buses
      if (st >= 1) { B(11.6, 0.1, 6.6, C.asphalt, 0, G, 0); B(11.6, 0.2, 1.4, C.conc, 0, G, -0.2); for (let k = 0; k < 4; k++) { B(0.08, 0.02, 1.8, C.lineW, -4.5 + k * 3, G + 0.1, 1.8); B(2.4, 0.02, 0.08, C.lineY, -3 + k * 3 - 1.5, G + 0.21, 0.52); }
        if (st === 1) for (let k = 0; k < 6; k++) B(0.12, 2.2, 0.12, C.steel, -5 + k * 2, G + 0.2, -0.2); }
      if (st >= 2) { B(4.2, 2.4, 2.2, C.glassClr, -3.4, G + 0.2, -2.3); for (let k = 0; k <= 5; k++) B(0.08, 2.4, 0.08, C.mullion, -5.5 + k * 0.84, G + 0.2, -1.18); B(4.4, 0.2, 2.4, C.green, -3.4, G + 2.6, -2.3);
        B(1.6, 1.6, 1.4, C.concDk, -3.4, G + 0.2, -2.6); for (let k = 0; k < 6; k++) Cy(0.08, 2.6, C.green, -5 + k * 2, G + 0.2, -0.2); }
      if (st >= 3) { for (let k = 0; k < 6; k++) add(box, C.glassClr, 2.1, 0.08, 2.4, -5 + k * 2 + 0.5, G + 2.95, -0.2).rotation.set(0.12, 0, 0); // sloped canopy panels
        B(12, 0.12, 0.14, C.green, 0, G + 2.8, -1.3); B(12, 0.12, 0.14, C.green, 0, G + 3.05, 0.9);
        B(2.8, 0.45, 0.06, signMat('🚉 TRANSIT', '#1d6b3a', '#ffffff'), -3.4, G + 2.0, -1.15);
        for (let k = 0; k < 3; k++) { B(0.5, 0.3, 0.05, signMat(`BAY ${k + 1}`, '#101418', '#ffd23a', 1.2), -4.5 + k * 3 + 1.5, G + 2.1, 0.45); halo(-4 + k * 3, G + 2.6, 0.4, 1.5); B(0.4, 0.06, 0.25, C.lamp, -4 + k * 3, G + 2.65, 0.4); }
        for (const [x, z] of [[-2.2, 2.2], [2.8, 2.2]] as const) { const b = new THREE.Group(); b.position.set(x, G, z); g.add(b); const s = (w: number, h: number, d: number, m: THREE.Material, xx: number, y0: number) => { const k = new THREE.Mesh(box, m); k.scale.set(w, h, d); k.position.set(xx, y0 + h / 2, 0); b.add(k); };
          s(3.4, 1.0, 0.95, C.white, 0, 0.18); s(3.42, 0.22, 0.97, C.busRed, 0, 0.3); s(3.3, 0.36, 0.98, C.glass, 0, 0.72); s(0.06, 0.2, 0.7, signMat('303', '#000', '#ffb000', 1.2), 1.72, 1.0); for (const xx of [-1.1, 1.1]) { const wh = new THREE.Mesh(cyl, C.dark); wh.scale.set(0.42, 0.98, 0.42); wh.rotation.x = Math.PI / 2; wh.position.set(xx, 0.2, 0); b.add(wh); } } }
    } else if (id === 'hospital') { // Foothills-style: white podium, banded tower, helipad, ER canopy, red cross
      if (st >= 1) { B(11, 2.4, 5.6, C.white, 0, G, -0.5); for (const y of [0.5, 1.6]) { winRow(10.4, 0, G + y, 2.32, C.glass, 0.5); winRowX(5, 5.52, G + y, -0.5, C.glass, 0.5); } B(11.2, 0.15, 5.8, C.concDk, 0, G + 2.4, -0.5);
        if (st === 1) for (const x of [-4, -1, 2]) for (const z of [-2.6, -0.4]) B(0.16, 3, 0.16, C.steel, x, G + 2.55, z); }
      if (st >= 2) { const th = st >= 3 ? 6.4 : 3.6; B(5.2, th, 3.6, C.white, -2.2, G + 2.55, -1.2); for (let f = 0; f < th / 1.05 - 0.4; f++) { winRow(4.8, -2.2, G + 2.85 + f * 1.05, 0.62, C.glass, 0.5); winRowX(3.2, 0.42, G + 2.85 + f * 1.05, -1.2, C.glass, 0.5); }
        for (const x of [-4.85, 0.45]) B(0.12, th, 0.12, C.concDk, x, G + 2.55, 0.62);
        // ER canopy (front right) with columns
        B(3.4, 0.18, 2.0, C.white, 3.3, G + 1.7, 3.0); for (const x of [1.8, 4.8]) Cy(0.07, 1.7, C.steel, x, G, 3.9); }
      if (st >= 3) { const top = G + 2.55 + 6.4; B(5.4, 0.25, 3.8, C.concDk, -2.2, top, -1.2); B(1.4, 0.8, 1.2, C.steel, -3.4, top + 0.25, -1.6);
        for (const [x, y, z, ry] of [[-2.2, top - 1.2, 0.66, 0], [0.47, top - 1.2, -1.2, Math.PI / 2]] as const) { B(1.4, 0.4, 0.06, C.redLit, x, y, z, ry); B(0.4, 1.4, 0.06, C.redLit, x, y - 0.5, z, ry); halo(x + (ry ? 0.3 : 0), y + 0.2, z + (ry ? 0 : 0.3), 2.2, redHalo); }
        add(disc, C.helipad, 3.2, 0.06, 3.2, 3.2, G + 2.6, -0.8); add(disc, C.lineW, 2.7, 0.065, 2.7, 3.2, G + 2.6, -0.8); add(disc, C.helipad, 2.5, 0.07, 2.5, 3.2, G + 2.6, -0.8);
        B(0.18, 0.02, 1.2, C.lineW, 2.85, G + 2.64, -0.8); B(0.18, 0.02, 1.2, C.lineW, 3.55, G + 2.64, -0.8); B(0.6, 0.02, 0.18, C.lineW, 3.2, G + 2.64, -0.8);
        for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; B(0.12, 0.08, 0.12, C.lamp, 3.2 + Math.cos(a) * 1.55, G + 2.6, -0.8 + Math.sin(a) * 1.55); }
        B(3.2, 0.42, 0.06, signMat('EMERGENCY', '#c41818', '#ffffff', 1.1), 3.3, G + 1.92, 4.02);
        const amb = car(3.3, 3.0, C.white, 0); amb.sub(0.9, 0.55, 0.72, C.white, -0.25, 0.4, 0); amb.sub(1.52, 0.1, 0.72, C.red, 0, 0.3, 0); amb.sub(0.2, 0.08, 0.5, C.redLit, -0.2, 0.96, 0); halo(-1.0, G + 9.6, -1.2, 1.2, redHalo); }
    } else if (id === 'school') { // Alberta elementary: brick classroom wing, taller gym, entry canopy, flagpole, playground
      if (st >= 1) { B(7.4, 1.9, 3.4, C.brick, -1.8, G, -1.6); B(7.6, 0.25, 0.08, C.tan, -1.8, G + 0.0, 0.12); winRow(6.6, -1.8, G + 0.7, 0.12, C.glass, 0.7); B(7.6, 0.18, 3.6, C.concDk, -1.8, G + 1.9, -1.6);
        if (st === 1) for (const x of [2.6, 4.2, 5.6]) for (const z of [-3, -0.5]) B(0.14, 2.4, 0.14, C.steel, x, G, z); }
      if (st >= 2) { B(3.6, 3.0, 4.2, C.brickDk, 4.0, G, -1.2); winRow(3.2, 4.0, G + 2.2, 0.92, C.glass, 0.45); B(3.8, 0.2, 4.4, C.concDk, 4.0, G + 3.0, -1.2);
        B(7.4, 1.6, 3.2, C.brick, -1.8, G + 2.08, -1.7); winRow(6.6, -1.8, G + 2.55, -0.08, C.glass, 0.65); B(7.6, 0.18, 3.4, C.concDk, -1.8, G + 3.68, -1.7);
        B(2.4, 0.15, 1.4, C.steel, 1.4, G + 1.9, 0.75); B(1.4, 1.5, 0.06, C.glassClr, 1.4, G, 0.14); }
      if (st >= 3) { B(3.0, 0.45, 0.06, signMat('CHUD HUB SCHOOL', '#ffffff', '#7a2a1c', 0.4), 1.4, G + 2.12, 1.46); for (const x of [0.4, 2.4]) Cy(0.05, 1.9, C.steel, x, G, 1.4);
        flag(-5.6, 2.8, 3.8);
        add(box, C.rubber, 4.4, 0.04, 2.4, -2.6, G + 0.02, 2.2); // playground: slide tower, slide, swings
        B(0.9, 1.0, 0.9, C.play1, -3.8, G, 2.2); add(cone, C.play2, 1.2, 0.6, 1.2, -3.8, G + 1.3, 2.2); const sl = add(box, C.play2, 0.4, 0.06, 1.6, -3.0, G + 0.55, 2.2); sl.rotation.set(0, 0, 0); sl.rotation.x = 0; sl.rotation.z = 0; sl.rotation.set(0, Math.PI / 2, 0.55); sl.updateMatrix();
        for (const x of [-1.6, -0.4]) { add(box, C.steel, 0.06, 1.5, 0.06, x, G + 0.75, 1.5).rotation.set(0.25, 0, 0); add(box, C.steel, 0.06, 1.5, 0.06, x, G + 0.75, 2.9).rotation.set(-0.25, 0, 0); }
        B(1.4, 0.06, 0.06, C.steel, -1.0, G + 1.45, 2.2); for (const x of [-1.3, -0.7]) { B(0.02, 0.9, 0.02, C.dark, x, G + 0.55, 2.2); B(0.3, 0.05, 0.18, C.play1, x, G + 0.5, 2.2); }
        for (const o of g.children) if (o instanceof THREE.Mesh) o.updateMatrix();
        const bus = car(4.4, 2.6, C.yellow, 0); bus.o.scale.set(1.8, 1.3, 1.2);
        for (const x of [3.0, 5.6]) lampPost(x, 1.6, 2.4, 0.3, -1); if (!low) tree(-5.5, -3.6, 0.9, C.leafAut); }
    } else if (id === 'park') { // Prince's Island Park: lawns, curving paths, pond, deciduous + spruce, benches, gazebo, lamps
      if (st >= 1) { B(W, 0.08, D, C.grass, 0, G, 0); B(W, 0.02, 0.7, C.path, 0, G + 0.08, 0.6); add(box, C.path, 7, 0.02, 0.6, -1, G + 0.09, -1.2, 0.5); add(box, C.path, 5, 0.02, 0.6, 3.4, G + 0.09, 2.0, -0.6);
        for (const [x, z] of [[-4.6, -2.6], [-1.5, 2.4], [2.2, -2.4], [5, -0.6]] as const) { Cy(0.05, 0.9, C.trunk, x, G, z); add(sph, C.leaf2, 0.5, 0.6, 0.5, x, G + 1.0, z); } }
      if (st >= 2) { add(disc, C.path, 3.8, 0.05, 2.6, -3.0, G + 0.08, 1.9); add(disc, C.water, 3.4, 0.06, 2.2, -3.0, G + 0.1, 1.9);
        for (const [x, z, s, m] of [[-5, -2.4, 1.1, C.leaf], [0.5, -2.6, 1.0, C.leafAut], [4.2, -2.5, 1.2, C.leaf], [5.2, 2.6, 0.9, C.leafAut], [1.4, 2.8, 0.8, C.leaf]] as const) tree(x, z, s, m);
        for (const [x, z] of [[-3, -0.3], [1.5, -0.2], [3.6, 1.3]] as const) { B(0.9, 0.08, 0.32, C.wood, x, G + 0.32, z); B(0.9, 0.3, 0.06, C.wood, x, G + 0.4, z - 0.16); for (const dx of [-0.38, 0.38]) B(0.06, 0.32, 0.3, C.mullion, x + dx, G, z); } }
      if (st >= 3) { Cy(1.0, 0.15, C.conc, 1.4, G + 0.08, 0.6); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; Cy(0.05, 1.5, C.white, 1.4 + Math.cos(a) * 0.85, G + 0.2, 0.6 + Math.sin(a) * 0.85); } add(cone, C.green, 2.3, 0.8, 2.3, 1.4, G + 2.1, 0.6);
        for (const [x, z] of [[-5.3, 0.4], [-0.5, 2.6], [5.6, -2.8]] as const) { add(cone, C.pine, 0.9, 2.2, 0.9, x, G + 1.2, z); Cy(0.07, 0.3, C.trunk, x, G, z); }
        for (const [x, z, m] of [[-1.2, -0.7, C.redLit], [4.6, 0.2, C.play2]] as const) { add(disc, C.brickDk, 1.0, 0.18, 1.0, x, G + 0.09, z); for (let k = 0; k < 5; k++) add(sph, m, 0.18, 0.18, 0.18, x + Math.cos(k * 1.3) * 0.3, G + 0.24, z + Math.sin(k * 1.3) * 0.3); }
        for (const x of [-5, -0.5, 4.5]) lampPost(x, 1.2, 2.0, 0.2); B(2.2, 0.4, 0.06, signMat('🌳 CITY PARK', '#2c5a2a', '#ffffff', 0.6), -4.4, G + 0.5, 3.3); for (const x of [-5.4, -3.4]) Cy(0.05, 0.5, C.wood, x, G, 3.3); }
    } else if (id === 'highway') { // Deerfoot-style: divided highway, overpass + ramps, green gantry sign, high-mast lights
      const rd = (z: number) => { B(W, 0.06, 2.2, C.asphalt, 0, G, z); for (let k = 0; k < 6; k++) B(0.8, 0.012, 0.07, C.lineW, -5 + k * 2, G + 0.06, z); B(W, 0.012, 0.06, C.lineW, 0, G + 0.06, z + 1.0); B(W, 0.012, 0.06, C.lineY, 0, G + 0.06, z - 1.0); };
      if (st >= 1) { B(W, 0.04, D, C.grassDk, 0, G, 0); rd(-1.6); if (st === 1) { B(W, 0.04, 2.2, C.path, 0, G, 1.6); for (let k = 0; k < 5; k++) add(cone, C.orange, 0.25, 0.5, 0.25, -4 + k * 2, G + 0.29, 0.4); } else rd(1.6); B(W, 0.32, 0.22, C.barrier, 0, G, 0); }
      if (st >= 2) { for (const x of [-1.6, 1.6]) for (const z of [-2.8, 0, 2.8]) Cy(0.22, 2.0, C.conc, x, G, z); B(4.4, 0.25, 0.4, C.concDk, 0, G + 2.0, -2.8); B(4.4, 0.25, 0.4, C.concDk, 0, G + 2.0, 2.8);
        add(box, C.asphalt, 5.4, 0.12, 1.4, -3.6, G + 1.0, -3.0, 0).rotation.set(0, 0, 0.36); add(box, C.asphalt, 5.4, 0.12, 1.4, 3.6, G + 1.0, 3.0, 0).rotation.set(0, 0, -0.36); for (const o of g.children) if (o instanceof THREE.Mesh) o.updateMatrix(); }
      if (st >= 3) { B(3.0, 0.3, D + 0.6, C.conc, 0, G + 2.25, 0); B(2.6, 0.02, D + 0.6, C.asphalt, 0, G + 2.55, 0); B(0.06, 0.02, D, C.lineY, 0, G + 2.57, 0); for (const x of [-1.45, 1.45]) B(0.12, 0.35, D + 0.6, C.barrier, x, G + 2.55, 0);
        for (const z of [-1.6, 1.6]) { Cy(0.08, 3.2, C.steel, 5.6, G, z + (z < 0 ? -1.2 : 1.2)); }
        B(0.12, 0.12, 6.4, C.steel, 5.6, G + 3.1, 0); B(0.08, 1.0, 2.0, signMat('HWY 2 N', '#1d6b3a', '#ffffff', 0.5), 5.55, G + 2.1, -1.6).rotation.set(0, Math.PI / 2, 0); B(0.08, 1.0, 2.0, signMat('EXIT 17 ↗', '#1d6b3a', '#ffffff', 0.5), 5.55, G + 2.1, 1.6).rotation.set(0, Math.PI / 2, 0);
        for (const o of g.children) if (o instanceof THREE.Mesh) o.updateMatrix();
        for (const x of [-4.5, 4.0]) { Cy(0.07, 4.2, C.steel, x, G, 0); for (const s of [-1, 1]) { B(0.36, 0.1, 0.3, C.lamp, x, G + 4.15, s * 0.5); halo(x, G + 4.0, s * 0.5, 2.0); } }
        const cols = [C.busRed, C.play1, C.white, C.yellow]; cols.forEach((m, k) => car(-4 + k * 2.6, k % 2 ? -1.2 : -2.0, m, 0)); car(-2.8, 1.2, C.play2, Math.PI); car(2.2, 2.0, C.dark, Math.PI); }
    } else if (id === 'lights') { // 17 Ave-style lit avenue: sidewalks, crosswalk, davit lamp posts both sides
      if (st >= 1) { B(W, 0.06, 3.2, C.asphalt, 0, G, 0); B(W, 0.14, 1.4, C.conc, 0, G, -2.4); B(W, 0.14, 1.4, C.conc, 0, G, 2.4); for (let k = 0; k < 6; k++) B(0.9, 0.012, 0.08, C.lineY, -5 + k * 2, G + 0.06, 0); }
      const n = [0, 3, 5, 7][Math.min(3, st)]!; for (let k = 0; k < n; k++) { const x = -5.2 + k * (10.4 / Math.max(1, n - 1)); lampPost(x, 2.0, st >= 3 ? 3.0 : 2.6, 0.7, 1); if (st >= 2) lampPost(x + (10.4 / Math.max(1, n - 1)) / 2 * (k < n - 1 ? 1 : 0), -2.0, st >= 3 ? 3.0 : 2.6, 0.7, -1); }
      if (st >= 2) for (let k = 0; k < 7; k++) B(0.25, 0.012, 2.6, C.lineW, 3.6 + k * 0.4, G + 0.07, 0);
      if (st >= 3) { for (let k = 0; k < 4; k++) B(0.06, 0.6, 0.35, k % 2 ? C.redLit : C.blueLit, -4.6 + k * 3.4, G + 2.3, 2.15); if (!low) for (let k = 0; k < 4; k++) tree(-4 + k * 3, -2.9, 0.55); car(-2, -0.7, C.play1); car(1.5, 0.7, C.white, Math.PI); }
    }

    if (bld) { // construction site for the next stage: hoarding fence, scaffold cage sized to the target, tower crane, cones
      const bh = [0, 2.6, 4.8, 8.2][bld]!;
      for (const s of [-1, 1]) { B(W + 0.4, 0.8, 0.05, C.white, 0, G, s * (D / 2 + 0.15)); B(0.05, 0.8, D + 0.3, C.white, s * (W / 2 + 0.2), G, 0); }
      B(2.4, 0.5, 0.06, signMat('🚧 CITY PROJECT', '#ffc21a', '#1a1a1a', 0.3), -W / 2 + 1.8, G + 0.85, D / 2 + 0.2);
      const xs = [-W / 2 + 0.7, -W / 4, 0, W / 4, W / 2 - 0.7], zs = [-D / 2 + 0.6, D / 2 - 0.6];
      for (const x of xs) for (const z of zs) B(0.08, bh, 0.08, C.yellow, x, G, z);
      for (let y = 1.0; y <= bh; y += 1.3) for (const z of zs) { B(W - 1.3, 0.07, 0.07, C.yellow, 0, G + y, z); B(W - 1.3, 0.05, 0.45, C.wood, 0, G + y - 0.06, z + (z > 0 ? -0.25 : 0.25)); }
      if (!low) for (let k = 0; k < xs.length - 1; k++) add(box, C.yellow, 0.05, Math.hypot(W / 4, bh), 0.05, (xs[k]! + xs[k + 1]!) / 2, G + bh / 2, D / 2 - 0.6).rotation.set(0, 0, Math.atan2(W / 4, bh) * (k % 2 ? 1 : -1));
      for (const o of g.children) if (o instanceof THREE.Mesh) o.updateMatrix();
      const ch = bh + 4, cx = W / 2 - 1.0; B(0.5, ch, 0.5, C.yellow, cx, G, -D / 2 + 1.0); if (!low) for (let y = 0.6; y < ch; y += 0.9) B(0.54, 0.05, 0.54, C.dark, cx, G + y, -D / 2 + 1.0);
      B(9, 0.3, 0.3, C.yellow, cx - 3.5, G + ch, -D / 2 + 1.0); B(1.2, 0.6, 0.6, C.concDk, cx + 1.4, G + ch - 0.3, -D / 2 + 1.0); B(0.7, 0.6, 0.6, C.glass, cx, G + ch - 0.6, -D / 2 + 1.0);
      B(0.03, 2.5, 0.03, C.dark, cx - 6, G + ch - 2.5, -D / 2 + 1.0); B(0.5, 0.4, 0.5, C.steel, cx - 6, G + ch - 2.9, -D / 2 + 1.0); halo(cx - 8, G + ch + 0.1, -D / 2 + 1.0, 0.9, redHalo); B(0.12, 0.12, 0.12, C.redLit, cx - 8, G + ch + 0.15, -D / 2 + 1.0);
      for (let k = 0; k < 4; k++) add(cone, C.orange, 0.3, 0.6, 0.3, -W / 2 + 1 + k * 1.1, G + 0.3, D / 2 + 0.55);
    }
  };
  return { build, glow, halos, dispose() { own.forEach((x) => x.dispose()); } };
}
