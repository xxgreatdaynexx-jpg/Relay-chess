/**
 * Stone Quarry landmark: an open-pit cut with terraced grey benches, a haul ramp spiralling down,
 * a crusher and conveyor, stockpiles, a dump truck and an excavator on a gravel yard.
 * Built in the landmark's local space (origin at the site, +z toward the street / haul-road approach)
 * so the entrance and interaction point stay where they were.
 */
import * as THREE from 'three';

type MatFn = (o: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;
type GeoFn = <T extends THREE.BufferGeometry>(g: T) => T;

const box = (geo: GeoFn, w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), m); o.position.set(x, y + h / 2, z); return o;
};
const cyl = (geo: GeoFn, rt: number, rb: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 12) => {
  const o = new THREE.Mesh(geo(new THREE.CylinderGeometry(rt, rb, h, seg)), m); o.position.set(x, y + h / 2, z); return o;
};


export function buildStoneQuarry(mat: MatFn, geo: GeoFn, neon: THREE.Material, dark: THREE.Material, neonI: number, xm: boolean): THREE.Group {
  const g = new THREE.Group();
  const rock = mat({ color: 0x8a8680, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
  const rockD = mat({ color: 0x5e5a54, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
  const rockL = mat({ color: 0xb0aaa0, roughness: 0.92, flatShading: true, side: THREE.DoubleSide });
  const gravel = mat({ color: 0x9a9488, roughness: 1, side: THREE.DoubleSide });
  const dust = mat({ color: 0xb8b09e, roughness: 1 });
  const rust = mat({ color: 0x8a4a28, roughness: 0.55, metalness: 0.35 });
  const steel = mat({ color: 0x8a9098, roughness: 0.45, metalness: 0.55 });
  const yellow = mat({ color: 0xe0b020, roughness: 0.55, metalness: 0.25, emissive: 0x6a5010, emissiveIntensity: 0.15 });
  const black = mat({ color: 0x1c1d20, roughness: 0.85 });
  const office = mat({ color: 0xc8c2b4, roughness: 0.9 });
  const snow = mat({ color: 0xeef2f6, roughness: 0.95 });
  const earth = mat({ color: 0x5a4a38, roughness: 1, side: THREE.DoubleSide });

  const cx = 0, cz = -1.6;
  // gravel yard as a RING (hole over the pit) so the benches and floor are visible
  { const sh = new THREE.Shape(); sh.absarc(cx, -cz, 16, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(cx, -cz, 11.4, 0, Math.PI * 2, true); sh.holes.push(hole);
    const gg = new THREE.ShapeGeometry(sh, 28); gg.rotateX(-Math.PI / 2);
    const pad = new THREE.Mesh(geo(gg), gravel); pad.position.y = 0.04; pad.userData.noShadow = true; g.add(pad);
  }
  // outer dusty fringe, also a ring
  { const sh = new THREE.Shape(); sh.absarc(cx, -cz, 18, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(cx, -cz, 15.2, 0, Math.PI * 2, true); sh.holes.push(hole);
    const gg = new THREE.ShapeGeometry(sh, 24); gg.rotateX(-Math.PI / 2);
    const pad = new THREE.Mesh(geo(gg), dust); pad.position.y = 0.02; pad.userData.noShadow = true; g.add(pad);
  }

  // terraced benches: concentric ring walls stepping down. Each wall's TOP is the walking bench of that level,
  // and the inner face drops to the next terrace. A spiral gap is cut by omitting a sector (the haul ramp fills it).
  const levels: Array<{ rOut: number; rIn: number; yTop: number; yBot: number; m: THREE.Material }> = [
    { rOut: 11.5, rIn: 9.6, yTop: 0.05, yBot: -1.8, m: rockL },
    { rOut: 9.6, rIn: 7.6, yTop: -1.8, yBot: -3.5, m: rock },
    { rOut: 7.6, rIn: 5.6, yTop: -3.5, yBot: -5.15, m: rockD },
    { rOut: 5.6, rIn: 3.7, yTop: -5.15, yBot: -6.6, m: rock },
    { rOut: 3.7, rIn: 2.0, yTop: -6.6, yBot: -7.6, m: rockD },
  ];
  const gapCenter = (r: number) => 1.2 + (11.5 - r) * 0.28; // the ramp walks clockwise as it descends
  const inGap = (a: number, r: number) => { const g0 = gapCenter(r); let d = a - g0; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return Math.abs(d) < 0.38 && r > 3.8; };
  const SEG = 28;
  for (const lv of levels) {
    const h = lv.yTop - lv.yBot;
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
      if (inGap((a0 + a1) / 2, lv.rIn)) continue;
      const mid = (a0 + a1) / 2;
      const span = (a1 - a0) * ((lv.rOut + lv.rIn) / 2) * 1.08;
      // vertical face (inner)
      const face = box(geo, span, h, lv.rOut - lv.rIn, lv.m, cx + Math.cos(mid) * ((lv.rOut + lv.rIn) / 2), lv.yBot, cz + Math.sin(mid) * ((lv.rOut + lv.rIn) / 2));
      face.rotation.y = -mid; g.add(face);
      // walking lip on top of this terrace (lighter stone)
      const lip = box(geo, span * 0.98, 0.16, lv.rOut - lv.rIn + 0.15, rockL, cx + Math.cos(mid) * ((lv.rOut + lv.rIn) / 2), lv.yTop - 0.08, cz + Math.sin(mid) * ((lv.rOut + lv.rIn) / 2));
      lip.rotation.y = -mid; g.add(lip);
    }
  }
  // deep outer well (cuts cleanly through the 3-unit ground slab) — only the portion below the first terrace
  { const well = new THREE.Mesh(geo(new THREE.CylinderGeometry(11.55, 11.9, 8.4, 28, 1, true)), earth);
    well.position.set(cx, -4.1, cz); g.add(well);
    const outer = new THREE.Mesh(geo(new THREE.CylinderGeometry(12.15, 12.5, 8.4, 28, 1, true)), earth);
    outer.material = mat({ color: 0x5a4a38, roughness: 1, side: THREE.BackSide }); outer.position.set(cx, -4.1, cz); g.add(outer);
  }
  // pit floor + a little standing water
  const floor = new THREE.Mesh(geo(new THREE.CircleGeometry(2.15, 20)), rockD);
  floor.rotation.x = -Math.PI / 2; floor.position.set(cx, -7.55, cz); g.add(floor);
  const puddle = new THREE.Mesh(geo(new THREE.CircleGeometry(1.15, 14)), mat({ color: 0x3a5a68, roughness: 0.22, metalness: 0.25, emissive: 0x0a2030, emissiveIntensity: 0.3 }));
  puddle.rotation.x = -Math.PI / 2; puddle.position.set(cx + 0.2, -7.48, cz - 0.15); g.add(puddle);

  // haul ramp: gravel ribbon spiralling from the south-east rim down to the floor, filling the bench gaps
  { const pos: number[] = []; const idx: number[] = [];
    const N = 48, W = 2.35;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = 1.2 + t * (Math.PI * 1.95);
      const r = 11.15 - t * 8.7;
      const y = 0.06 - t * 7.5;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const nx = Math.cos(a), nz = Math.sin(a);
      pos.push(x + nx * W / 2, y, z + nz * W / 2, x - nx * W / 2, y, z - nz * W / 2);
      if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setIndex(idx); rg.computeVertexNormals();
    const rm = new THREE.Mesh(geo(rg), mat({ color: 0x8a8276, roughness: 1, side: THREE.DoubleSide })); g.add(rm);
    for (let i = 2; i < N - 1; i += 3) {
      const t = i / N; const a = 1.2 + t * (Math.PI * 1.95); const r = 11.15 - t * 8.7 + 1.15; const y = 0.06 - t * 7.5;
      const k = box(geo, 1.4, 0.2, 0.14, rust, cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      k.rotation.y = -a; g.add(k);
    }
    // rock under the ramp so sky never shows through the spiral gap
    for (let i = 1; i < N; i += 2) {
      const t = i / N; const a = 1.2 + t * (Math.PI * 1.95); const r = 11.15 - t * 8.7; const y = 0.06 - t * 7.5;
      const h = Math.max(0.6, y + 7.6);
      const under = box(geo, 2.6, h, 2.5, rockD, cx + Math.cos(a) * r, -7.6, cz + Math.sin(a) * r);
      under.rotation.y = -a; g.add(under);
    }
  }

  // berm / spoil around the outer rim, snow-capped in winter — leave a gap at the south entrance
  for (let i = 0; i < 16; i++) {
    const a = -0.65 + (i / 15) * (Math.PI * 2 - 1.55);
    const r = 13.4 + (i % 3) * 0.55;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const s = 1.55 + (i % 4) * 0.38;
    const m = new THREE.Mesh(geo(new THREE.DodecahedronGeometry(1, 0)), i % 2 ? rock : rockL);
    m.position.set(x, s * 0.38, z); m.scale.set(s, s * 0.58, s * 0.88); m.rotation.set(0.2, i, 0.1); g.add(m);
    if (xm) { const cap = new THREE.Mesh(geo(new THREE.SphereGeometry(0.7, 5, 4)), snow); cap.position.set(x, s * 0.75, z); cap.scale.set(s * 0.7, s * 0.28, s * 0.55); g.add(cap); }
  }

  // crushed-stone stockpiles on the west and north of the yard (outside the pit)
  const piles: Array<[number, number, number, number]> = [[-12.8, 6.8, 2.5, 1.7], [-14.2, 3.6, 1.9, 1.25], [12.2, -8.8, 2.3, 1.55], [10.2, -11.0, 1.7, 1.15], [-10.2, -11.0, 1.8, 1.2]];
  for (const [x, z, r, h] of piles) {
    const p = new THREE.Mesh(geo(new THREE.ConeGeometry(r, h, 7)), dust); p.position.set(x, h / 2, z); p.rotation.y = x; g.add(p);
  }

  // crusher house + conveyor from the west yard out to the west stockpile (kept off the pit)
  g.add(box(geo, 4.4, 4.2, 3.6, rust, -13.4, 0, 0.4));
  g.add(box(geo, 4.8, 0.35, 4.0, steel, -13.4, 4.2, 0.4));
  g.add(cyl(geo, 0.7, 0.9, 2.2, steel, -13.4, 4.5, 0.4, 8));
  g.add(box(geo, 1.6, 1.4, 0.1, mat({ color: 0xffd08a, emissive: 0xffb050, emissiveIntensity: 0.55 * neonI }), -13.4, 1.4, 2.25));
  { const ang = -0.45; const L = 8.8;
    const trough = box(geo, L, 0.35, 1.15, steel, -16.6, 1.9, 3.2); trough.rotation.y = ang; trough.rotation.z = -0.2; g.add(trough);
    const belt = box(geo, L - 0.3, 0.08, 0.85, black, -16.6, 2.15, 3.2); belt.rotation.y = ang; belt.rotation.z = -0.2; g.add(belt);
    for (const t of [-0.32, 0.05, 0.38]) {
      g.add(box(geo, 0.16, 2.1 + t * 1.5, 0.16, dark, -16.6 + Math.cos(ang) * t * L, 0, 3.2 + Math.sin(ang) * t * L));
    }
    g.add(cyl(geo, 0.15, 0.55, 1.4, dust, -19.4, 0.6, 5.0, 6));
  }

  // site office / gatehouse on the south rim — clickable entrance, same side as the old portal (local +z)
  g.add(box(geo, 5.2, 3.1, 3.6, office, 4.2, 0, 11.4));
  g.add(box(geo, 5.6, 0.3, 4.0, dark, 4.2, 3.1, 11.4));
  g.add(box(geo, 2.2, 1.5, 0.08, mat({ color: 0x9fd4ff, emissive: 0xfff2c0, emissiveIntensity: 0.3 * neonI, roughness: 0.2 }), 4.2, 1.1, 13.22));
  // portal frame (the old mine-style entrance, kept so the landmark still reads as a place you go into)
  g.add(box(geo, 0.4, 5.2, 0.4, dark, -1.6, 0, 12.2), box(geo, 0.4, 5.2, 0.4, dark, 1.6, 0, 12.2), box(geo, 4.0, 0.4, 0.4, dark, 0, 5.2, 12.2));
  g.add(box(geo, 3.4, 3.2, 1.6, mat({ color: 0x1a1612 }), 0, 0, 11.4));
  g.add(box(geo, 3.8, 0.45, 1.8, neon, 0, 3.2, 11.6));

  // dump truck on the gravel, pointing at the crusher
  {
    const tg = new THREE.Group(); tg.position.set(10.2, 0, 7.2); tg.rotation.y = -0.95;
    tg.add(box(geo, 2.2, 1.15, 1.7, yellow, 1.15, 0.85, 0));
    tg.add(box(geo, 3.4, 1.5, 2.0, rust, -1.1, 1.15, 0));
    tg.add(box(geo, 3.2, 0.12, 1.8, rust, -1.1, 2.65, 0));
    for (const [x, z] of [[1.3, 0.85], [1.3, -0.85], [-0.5, 0.85], [-0.5, -0.85], [-2.1, 0.85], [-2.1, -0.85]] as const) {
      tg.add(cyl(geo, 0.42, 0.42, 0.35, black, x, 0.15, z, 10));
    }
    g.add(tg);
  }
  // excavator on the east rim, arm reaching into the pit
  {
    const eg = new THREE.Group(); eg.position.set(13.2, 0, -1.0); eg.rotation.y = 1.25;
    eg.add(box(geo, 2.6, 0.45, 1.8, black, 0, 0.35, 0));
    eg.add(box(geo, 1.8, 1.15, 1.5, yellow, 0, 0.85, 0));
    eg.add(box(geo, 0.85, 0.7, 0.95, mat({ color: 0x4a80a8, emissive: 0x204060, emissiveIntensity: 0.25 }), 0.55, 1.55, 0.1));
    const boom = box(geo, 4.2, 0.35, 0.35, yellow, -2.4, 2.15, 0); boom.rotation.z = 0.45; eg.add(boom);
    const stick = box(geo, 3.1, 0.28, 0.28, yellow, -5.0, 1.15, 0); stick.rotation.z = -0.7; eg.add(stick);
    eg.add(box(geo, 0.85, 0.7, 0.7, steel, -6.3, 0.15, 0));
    g.add(eg);
  }

  for (const [x, z, s] of [[-5.6, 11.6, 0.9], [-6.6, 10.4, 0.7], [10.4, 11.2, 0.8]] as const) {
    g.add(box(geo, s * 1.4, s, s * 1.1, rockL, x, 0, z));
  }
  g.add(cyl(geo, 0.07, 0.09, 2.6, dark, -3.6, 0, 13.0, 5));
  const lamp = new THREE.Mesh(geo(new THREE.SphereGeometry(0.22, 8, 6)), mat({ color: 0xfff0c0, emissive: 0xffd080, emissiveIntensity: 1 }));
  lamp.position.set(-3.6, 2.7, 13.0); g.add(lamp);

  return g;
}
