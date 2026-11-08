/** Decorative CITY-only gag. EASY OFF: set CITY_PROTEST_JOKE_ENABLED=false, rebuild/redeploy, reopen city.
 * Does not read players/ownership or call gameplay, audio, network, collision, timers or event APIs.
 * Existing civic/farm protest systems are unrelated and are not changed by this switch.
 */
import * as THREE from 'three';
import { prefersReducedMotion } from './motion';
import type { Patch } from '../../../shared/worldLayout';
import type { WorldTier } from './worldTier';

export const CITY_PROTEST_JOKE_ENABLED = true; // THE ONLY feature switch. No changelog entry, by request.
export const JOKE_SIGNS = ['WE DEMAND SNACKS', 'MORE NAPS', 'HONK FOR SOUP', 'THIS IS FINE', 'RETURN THE REMOTE', 'TOO MANY MEETINGS'];
export const JOKE_BUDGET = { low: { sites: 8, people: 3, smoke: 2 }, mid: { sites: 12, people: 4, smoke: 3 }, high: { sites: 16, people: 4, smoke: 4 } } as const;
type Site = Pick<Patch, 'x'|'z'|'w'|'d'|'rot'>;
export interface JokeOptions {
  map: string; tier: WorldTier; sites: readonly Site[]; enabled?: boolean;
  reducedMotion?: () => boolean;
  /** Injectable texture factory keeps lifecycle tests independent of WebGL/canvas. */
  label?: (words: string) => THREE.Texture;
}
export interface CityProtestJoke { setEnabled(enabled: boolean): void; step(time: number): void; dispose(): void }
/** Read-only open-space patches only; leave a margin for signs/props and keep them off streets/doors. */
export function jokeSites(sites: readonly Site[], tier: WorldTier): Site[] {
  const valid = sites.filter(s => [s.x,s.z,s.w,s.d,s.rot].every(Number.isFinite) && s.w >= 8 && s.d >= 6);
  // Interleave opposite ends so lower device budgets still cover the city rather than one neighbourhood.
  const spread: Site[]=[]; for(let i=0;i<Math.ceil(valid.length/2);i++){spread.push(valid[i]);if(valid.length-1-i!==i)spread.push(valid[valid.length-1-i]);}
  return spread.slice(0,JOKE_BUDGET[tier].sites);
}
function signTexture(words: string): THREE.Texture {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
  const c=canvas.getContext('2d');if(c){c.fillStyle='#fff0b5';c.fillRect(0,0,512,256);c.strokeStyle='#3b2854';c.lineWidth=12;c.strokeRect(7,7,498,242);c.fillStyle='#30203d';c.font='bold 46px sans-serif';c.textAlign='center';
    const parts=words.split(' '),mid=Math.ceil(parts.length/2);c.fillText(parts.slice(0,mid).join(' '),256,90,470);c.fillText(parts.slice(mid).join(' '),256,150,470);c.font='22px sans-serif';c.fillText('CITY DRAMA CLUB · PROPS ONLY',256,216,470);}
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;return t;
}
const noHit: THREE.Object3D['raycast'] = () => {};
/** Owns every resource it creates. Off/dispose removes the root BEFORE freeing shared GPU resources, once each. */
export function attachCityProtestJoke(scene: THREE.Scene, options: JokeOptions): CityProtestJoke {
  let root: THREE.Group|null=null, closed=false;
  let animate: ((time:number)=>void)|null=null;
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),instances=new Set<THREE.InstancedMesh>();
  const clear=()=>{animate=null;if(root){root.removeFromParent();root.clear();root=null;}for(const m of instances)m.dispose();instances.clear();for(const g of geometries)g.dispose();geometries.clear();for(const m of materials)m.dispose();materials.clear();for(const t of textures)t.dispose();textures.clear();};
  const setEnabled=(enabled:boolean)=>{
    if(closed)return;
    if(!enabled||options.map!=='city'){clear();return;}
    if(root)return;
    const sites=jokeSites(options.sites,options.tier);if(!sites.length)return;
    root=new THREE.Group();root.name='city-protest-joke';root.userData.decorativeOnly=true;
    const geo=<T extends THREE.BufferGeometry>(g:T)=>{geometries.add(g);return g;};
    const mat=(color:number)=>{const m=new THREE.MeshBasicMaterial({color});materials.add(m);return m;};
    const cube=geo(new THREE.BoxGeometry(1,1,1)),head=geo(new THREE.IcosahedronGeometry(.27,0)),cone=geo(new THREE.ConeGeometry(.55,1.3,5)),puff=geo(new THREE.IcosahedronGeometry(.58,0));
    const clothes=mat(0xffffff),skin=mat(0xe6b687),dark=mat(0x3b3347),cardboard=mat(0xc79458),flame=mat(0xff9f2b);
    const smoke=new THREE.MeshBasicMaterial({color:0x777682,transparent:true,opacity:.24,depthWrite:false});materials.add(smoke);
    const budget=JOKE_BUDGET[options.tier],count=sites.length*budget.people;
    const inst=(g:THREE.BufferGeometry,m:THREE.Material,n:number)=>{const mesh=new THREE.InstancedMesh(g,m,n);mesh.raycast=noHit;mesh.castShadow=false;mesh.receiveShadow=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);instances.add(mesh);root!.add(mesh);return mesh;};
    const bodies=inst(cube,clothes,count),heads=inst(head,skin,count),legs=inst(cube,dark,count*2),arms=inst(cube,clothes,count*2),boxes=inst(cube,cardboard,sites.length),fires=inst(cone,flame,sites.length*3),clouds=inst(puff,smoke,sites.length*budget.smoke),poles=inst(cube,dark,sites.length*2);
    const object=new THREE.Object3D(),color=new THREE.Color(),palette=[0x41b8b0,0xd85e87,0x8c7ada,0xe2bb47];
    for(let i=0;i<count;i++){bodies.setColorAt(i,color.setHex(palette[i%palette.length]));arms.setColorAt(i*2,color);arms.setColorAt(i*2+1,color);}
    const labelMaterials=new Map<string,THREE.SpriteMaterial>();
    const label=(text:string)=>{let m=labelMaterials.get(text);if(!m){const t=(options.label??signTexture)(text);textures.add(t);m=new THREE.SpriteMaterial({map:t,depthWrite:false});materials.add(m);labelMaterials.set(text,m);}const s=new THREE.Sprite(m);s.raycast=noHit;root!.add(s);return s;};
    const point=(site:Site,x:number,z:number)=>[site.x+Math.cos(site.rot)*x+Math.sin(site.rot)*z,site.z-Math.sin(site.rot)*x+Math.cos(site.rot)*z] as const;
    const lootLabels:THREE.Sprite[]=[];
    sites.forEach((site,i)=>{for(let k=0;k<2;k++){const [x,z]=point(site,(k?1.3:-1.3)+.35,-1.0);const sign=label(JOKE_SIGNS[(i*2+k)%JOKE_SIGNS.length]);sign.position.set(x,3.1,z);sign.scale.set(2.6,1.3,1);}
      const [x,z]=point(site,0,1.45);const prop=label(i%2?'EMPTY BOX':'PROP TV');lootLabels.push(prop);prop.position.set(x,1.6,z+.42);prop.scale.set(1.1,.55,1);});
    const pose=(mesh:THREE.InstancedMesh,i:number,x:number,y:number,z:number,sx:number,sy:number,sz:number,ry=0)=>{object.position.set(x,y,z);object.scale.set(sx,sy,sz);object.rotation.set(0,ry,0);object.updateMatrix();mesh.setMatrixAt(i,object.matrix);};
    const offsets=[[-1.3,-1],[1.3,-1],[-1.3,.7],[.8,.45]];
    let drawn=false,wasStatic=false;
    animate=(time:number)=>{
      const still=(options.reducedMotion??prefersReducedMotion)()||options.tier==='low';if(drawn&&still&&wasStatic)return;drawn=true;wasStatic=still;
      const t=still?0:time;
      sites.forEach((site,i)=>{for(let k=0;k<budget.people;k++){const n=i*budget.people+k;const carrier=k===budget.people-1;const localX=offsets[k][0]+(carrier?Math.sin(t*.65+i)*.45:0),localZ=offsets[k][1];const [x,z]=point(site,localX,localZ);const bob=carrier?Math.sin(t*1.3+i)*.035:Math.sin(t*.7+n)*.04;
        pose(bodies,n,x,1.08+bob,z,.65,.9,.42,site.rot);pose(heads,n,x,1.82+bob,z,1,1,1,site.rot);
        for(let side=0;side<2;side++){const [lx,lz]=point(site,localX+(side?-.19:.19),localZ);pose(legs,n*2+side,lx,.37,lz,.23,.66,.27,site.rot);const [ax,az]=point(site,localX+(side?-.46:.46),localZ);pose(arms,n*2+side,ax,1.13+bob,az,.19,.68,.22,site.rot);}
      }
      const carrier=offsets[budget.people-1];const [bx,bz]=point(site,carrier[0]+Math.sin(t*.65+i)*.45,carrier[1]+.45);pose(boxes,i,bx,1.05,bz,.9,.7,.7,site.rot);lootLabels[i].position.set(bx,1.2,bz+.42);
      for(let k=0;k<2;k++){const [px,pz]=point(site,(k?1.3:-1.3)+.35,-1);pose(poles,i*2+k,px,2.1,pz,.08,1.8,.08,site.rot);}
      for(let f=0;f<3;f++){const [x,z]=point(site,1.8+(f-1)*.27,1.7);pose(fires,i*3+f,x,.8+f*.12,z,.55,.75+(t?Math.sin(t*1.1+i+f)*.09:0),.55);}
      for(let j=0;j<budget.smoke;j++){const age=t?((t*.18+j/budget.smoke)%1):j/budget.smoke;const [x,z]=point(site,1.8+age*.25,1.7);pose(clouds,i*budget.smoke+j,x,2+age*3,z,1+age,1+age,1+age);}
      });
      for(const mesh of instances)mesh.instanceMatrix.needsUpdate=true;
    };
    // All descendants are deliberately absent from city pickables and cannot intercept even recursive raycasts.
    root.traverse(o=>{o.raycast=noHit;});scene.add(root);animate(0);
  };
  setEnabled(options.enabled??CITY_PROTEST_JOKE_ENABLED);
  return {setEnabled,step(time){if(!closed&&animate)animate(Number.isFinite(time)?time:0);},dispose(){if(closed)return;clear();closed=true;}};
}
