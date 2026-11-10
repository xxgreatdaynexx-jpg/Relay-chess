import * as THREE from 'three';
import { JAIL_SITE, JAIL_HALF } from '../shared/jail';
import { describe, expect, it } from 'vitest';
import { farmBarns, barnPrice } from '../shared/farmBarns';
import { barnFarms, isBarnProperty } from '../shared/barnFarms';
import { properties, propertyById, workerBonusOf } from '../shared/realEstate';
import { isHomeProperty } from '../shared/homes';
import { BARNS } from '../shared/farm';
import { outskirts } from '../shared/outskirts';
import { readFileSync } from 'node:fs';
const row = (id: string, owner='Jay') => ({ id, owner, price: 10000, arrears: 0, boughtAt: 1 });
describe('all physical barns have separate paid deeds; no farm-derived ownership', () => {
  it('dedicated transparent barn volumes are raycastable; unlisted sheds do not intercept clicks', () => {
    const hit = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,colorWrite:false}), 1);
    hit.setMatrixAt(0,new THREE.Matrix4().makeScale(6,3.4,4.5)); hit.updateMatrixWorld(true);
    const ray=new THREE.Raycaster(new THREE.Vector3(0,10,0),new THREE.Vector3(0,-1,0));expect(ray.intersectObjects([hit],false).length).toBeGreaterThan(0);
    ray.set(new THREE.Vector3(20,10,0),new THREE.Vector3(0,-1,0));expect(ray.intersectObjects([hit],false)).toHaveLength(0);
    hit.geometry.dispose();(hit.material as THREE.Material).dispose();
  });
  it('34 stable barn ids cover 2 district, 20 country and all 12 Big Farm barns', () => {
    const bs=farmBarns(); expect(bs).toHaveLength(34); expect(new Set(bs.map(b=>b.id)).size).toBe(34);
    expect(bs.filter(b=>b.family==='district')).toHaveLength(2);expect(bs.filter(b=>b.family==='country')).toHaveLength(20);expect(bs.filter(b=>b.family==='big')).toHaveLength(12);
    expect(bs.every(b=>b.id.startsWith('barn:'))).toBe(true); expect(properties()).toHaveLength(557);
    for(const b of bs) { const p=propertyById(b.id)!;expect(p).toMatchObject({kind:'building',type:'barn',x:b.x,z:b.z,w:b.w,d:b.d,price:barnPrice(b)}); expect(isHomeProperty(p)).toBe(false);expect(workerBonusOf(b.id)).toBe(0); }
  });
  it('farm 10/20 and every Big Farm owner gets no barn ownership or unlock', () => {
    const ids=['f:10','f:20',...Array.from({length:12},(_,i)=>`cf:${1000+i}`)];
    for(const id of ids){expect(isBarnProperty(id)).toBe(false);expect(barnFarms('Jay',[row(id)]).unlocked).toBe(false);}
    for(const b of farmBarns()){expect(barnFarms('Jay',[row(b.id)]).unlocked).toBe(true);expect(barnFarms('Other',[row(b.id)]).unlocked).toBe(false);}
  });
  it('district deeds preserve physical barn geometry; prices are explicit new barn prices, not farm prices', () => {
    const d=farmBarns().filter(b=>b.family==='district');expect(d.map(({x,z,w,d,rot})=>({x,z,w,d,rot}))).toEqual(BARNS);
    expect(d.map(b=>barnPrice(b))).toEqual([17500,24000]);expect(propertyById('f:10')!.price).toBe(8000);expect(propertyById('f:20')!.price).toBe(9000);
    expect(farmBarns().filter(b=>b.family==='country').every(b=>barnPrice(b)===7000)).toBe(true);
    expect(farmBarns().filter(b=>b.family==='big').every(b=>barnPrice(b)===17500)).toBe(true);
  });
  it('orphan barn is a separate safe footprint, never restores protected former cf:23 land', () => {
    expect(propertyById('cf:23')).toBeUndefined();const b=propertyById('barn:country:23')!;expect(b).toBeTruthy();
    expect(outskirts().buildings.find(x=>x.kind==='barn'&&x.x===b.x&&x.z===b.z)).toBeTruthy(); // passed existing !hitsJail building filter
    expect(b.w*b.d).toBe(27);
    for(const f of farmBarns()) expect(Math.abs(f.x-JAIL_SITE.x)<JAIL_HALF.x+2+f.w/2 && Math.abs(f.z-JAIL_SITE.z)<JAIL_HALF.z+2+f.d/2).toBe(false);
  });
  it('all renderer families pass exact independent barn ids, never neighboring farm ids', () => {
    const s=readFileSync('client/src/lib/world3d.ts','utf8');expect(s).toContain('o.userData.spot = deed');expect(s).toContain('`barn:big:${f.n}`');expect(s).toContain('return barnIds[hit.instanceId]');expect(s).toContain('h.onBarn?.(id)');
    expect(s).toContain("const clickBarns = outb.filter((b) => b.kind === 'barn')");expect(s).toContain('pickables.push(barnHits)');expect(s).not.toContain('pickables.push(oldBarnMeshes)');
    expect(s).not.toContain('`barn:cf:${f.n}`');expect(s).not.toContain('id.slice(5)');
  });
});
