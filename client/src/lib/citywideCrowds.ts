/** Citywide drama-club extras: geometry-only, owned by the existing whole-joke switch/lifecycle. */
import {buildCrowdWalks,crowdWalkPose,CROWD_LOW_UPDATE_HZ} from './crowdWalking';
import * as THREE from 'three';
import { ROADS, PLATE, shoreZ, obbHit, type OBB, type Patch } from '../../../shared/worldLayout';
import { prefersReducedMotion } from './motion';
import type { WorldTier } from './worldTier';
export const CITYWIDE_CROWD_BUDGET={low:80,mid:144,high:224} as const;
export const PEOPLE_PER_CROWD=3;
export interface CrowdSite {x:number;z:number;heading:number;source:string;distance?:number}
/** Sample every real street (including neighbourhood lanes), plus public patches, then spatially spread the budget.
 * A 3-unit expanded footprint keeps figures, raised signs and entrances apart; no ownership/state is read.
 */
export function citywideCrowdSites(patches:readonly Pick<Patch,'x'|'z'|'w'|'d'|'rot'>[],obstacles:readonly OBB[],tier:WorldTier):CrowdSite[]{
 const candidates:CrowdSite[]=[];
 const add=(x:number,z:number,heading:number,source:string,distance?:number)=>{if(Math.abs(x)>PLATE-4||z< -PLATE+4||z>shoreZ(x)-4||obstacles.some(b=>obbHit(b,x,z,3)))return;if(candidates.some(p=>(p.x-x)**2+(p.z-z)**2<16))return;candidates.push({x,z,heading,source,distance});};
 for(const road of ROADS){const points=road.closed?[...road.pts,road.pts[0]]:road.pts;let next=4,travel=0;for(let i=1;i<points.length;i++){const [ax,az]=points[i-1],[bx,bz]=points[i],dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz);while(len>0&&next<=travel+len){const f=(next-travel)/len;add(ax+dx*f,az+dz*f,Math.atan2(dz,dx),road.id,next);next+=5;}travel+=len;}}
 for(const p of patches)for(let x=-p.w/2+3;x<=p.w/2-3;x+=5)for(let z=-p.d/2+3;z<=p.d/2-3;z+=5)add(p.x+Math.cos(p.rot)*x+Math.sin(p.rot)*z,p.z-Math.sin(p.rot)*x+Math.cos(p.rot)*z,p.rot,'public-space');
 // Farthest-point sampling seeds the centre, then fills ALL quadrants/periphery before increasing local density.
 const chosen:CrowdSite[]=[],remaining=[...candidates];const scores=new Map<CrowdSite,number>();for(const p of remaining)scores.set(p,Infinity);
 let next=remaining.reduce<CrowdSite|undefined>((best,p)=>!best||p.x*p.x+p.z*p.z<best.x*best.x+best.z*best.z?p:best,undefined);
 while(next&&chosen.length<CITYWIDE_CROWD_BUDGET[tier]){chosen.push(next);remaining.splice(remaining.indexOf(next),1);let best:CrowdSite|undefined,score=-1;for(const p of remaining){const d=Math.min(scores.get(p)!, (next.x-p.x)**2+(next.z-p.z)**2);scores.set(p,d);if(d>score){score=d;best=p;}}next=best;}
 return chosen;
}
interface Options {map:string;tier:WorldTier;sites:readonly Pick<Patch,'x'|'z'|'w'|'d'|'rot'>[];obstacles:readonly OBB[];signs:readonly string[];texture:(s:string)=>THREE.Texture;reducedMotion?:()=>boolean}
const noHit:THREE.Object3D['raycast']=()=>{};
export function attachCitywideCrowds(parent:THREE.Object3D,options:Options){
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),meshes:THREE.InstancedMesh[]=[];let root:THREE.Group|null=null,draw:((t:number)=>void)|null=null,dead=false,elapsed=0,last:number|null=null,pending=0,wasReduced=false;
 if(options.map==='city'){
 const sites=citywideCrowdSites(options.sites,options.obstacles,options.tier);const walks=buildCrowdWalks(sites,options.sites,options.obstacles);if(sites.length&&options.signs.length){root=new THREE.Group();root.name='citywide-protesters';root.userData.decorativeOnly=true;
 const geo=<T extends THREE.BufferGeometry>(g:T)=>{geometries.add(g);return g;},mat=(color:number)=>{const m=new THREE.MeshBasicMaterial({color});materials.add(m);return m;};
 const box=geo(new THREE.BoxGeometry(1,1,1)),sphere=geo(new THREE.IcosahedronGeometry(.33,0)),plane=geo(new THREE.PlaneGeometry(1,1)),white=mat(0xffffff),skin=mat(0xe6b687),dark=mat(0x42314b);
 const inst=(g:THREE.BufferGeometry,m:THREE.Material,count:number,name:string)=>{const mesh=new THREE.InstancedMesh(g,m,count);mesh.name=name;mesh.raycast=noHit;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root!.add(mesh);meshes.push(mesh);return mesh;};
 const count=sites.length*PEOPLE_PER_CROWD,bodies=inst(box,white,count,'citywide-bodies'),heads=inst(sphere,skin,count,'citywide-heads'),legs=inst(box,dark,count*2,'citywide-legs'),arms=inst(box,white,count*2,'citywide-arms'),poles=inst(box,dark,sites.length,'citywide-poles');
 const boards=options.signs.map((text,k)=>{const texture=options.texture(text);textures.add(texture);const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,toneMapped:false});materials.add(material);return inst(plane,material,sites.filter((_,i)=>i%options.signs.length===k).length,'citywide-sign-'+k);});
 const colors=[0xffd04c,0x39d2bd,0xff6c9e,0x9e84f5,0x59b9f4,0xff9858],color=new THREE.Color();for(let i=0;i<count;i++){bodies.setColorAt(i,color.setHex(colors[i%colors.length]));arms.setColorAt(i*2,color);arms.setColorAt(i*2+1,color);}
 const object=new THREE.Object3D(),pose=(m:THREE.InstancedMesh,i:number,x:number,y:number,z:number,sx:number,sy:number,sz:number,angle=0,swing=0)=>{object.position.set(x,y,z);object.rotation.set(swing,angle,0,'YXZ');object.scale.set(sx,sy,sz);object.updateMatrix();m.setMatrixAt(i,object.matrix);};
 draw=(t:number)=>{sites.forEach((s,i)=>{const p=crowdWalkPose(walks[i],t),c=Math.cos(p.heading),sn=Math.sin(p.heading),facing=Math.PI/2-p.heading+(p.direction<0?Math.PI:0);
 for(let k=0;k<PEOPLE_PER_CROWD;k++){const offset=(k-1)*1.15,x=p.x+c*offset,z=p.z+sn*offset,gait=Math.sin(t*5*walks[i].speed+i*1.7+k*.65)*p.pace,bob=Math.abs(gait)*.035,n=i*PEOPLE_PER_CROWD+k;pose(bodies,n,x,1.22+bob,z,.78,1.1,.48,facing);pose(heads,n,x,2.12+bob,z,1,1,1,facing);
 for(let side=0;side<2;side++){const sign=side?1:-1,lx=x-sn*sign*.23,lz=z+c*sign*.23;pose(legs,n*2+side,lx,.43,lz,.27,.8,.3,facing,gait*sign*.35);pose(arms,n*2+side,x-sn*sign*.5,1.38+bob,z+c*sign*.5,.23,.85,.25,facing,-gait*sign*.22);}}
 pose(poles,i,p.x,2.35,p.z,.09,2,.09);pose(boards[i%boards.length],Math.floor(i/boards.length),p.x,3.35,p.z,3,1.5,1,Math.PI/4);});for(const m of meshes)m.instanceMatrix.needsUpdate=true;};
 parent.add(root);draw(0);
 }}
 return {step(time:number){if(dead||!draw||!Number.isFinite(time))return;const dt=last===null?0:Math.max(0,Math.min(.1,time-last));last=time;const reduced=(options.reducedMotion??prefersReducedMotion)();if(reduced){wasReduced=true;elapsed-=pending;pending=0;return;}if(wasReduced){wasReduced=false;return;}if(!dt)return;elapsed+=dt;pending+=dt;if(options.tier==='low'&&pending<1/CROWD_LOW_UPDATE_HZ)return;pending=0;draw(elapsed);},dispose(){if(dead)return;dead=true;draw=null;root?.removeFromParent();root?.clear();root=null;for(const m of meshes)m.dispose();meshes.length=0;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();geometries.clear();materials.clear();textures.clear();}};
}
