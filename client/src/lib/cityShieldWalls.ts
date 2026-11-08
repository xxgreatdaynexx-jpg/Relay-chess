/** Pretend marching shield walls. Entire joke is controlled by CITY_PROTEST_JOKE_ENABLED in cityProtestJoke.ts.
 * This separate switch removes ONLY these decorative officers. No weapons, law/gameplay/audio/network hooks.
 */
import * as THREE from 'three';
import { CAR_ROUTES, routePoint, type Route } from '../../../shared/worldLayout';
import { prefersReducedMotion } from './motion';
import type { WorldTier } from './worldTier';
export const CITY_SHIELD_WALLS_ENABLED = true;
export const SHIELD_WALL_BUDGET = { low:2, mid:4, high:6 } as const;
export const OFFICERS_PER_WALL=6; // two cohesive ranks, three almost-touching shields per rank
export const MARCH_SPEED=1.4;
// Extra formations share the long closed ring at separated phases; never invent a route or duplicate a reversing wall.
export function shieldWallRoutes(tier:WorldTier):Route[]{const available=CAR_ROUTES.filter(r=>r.road.width>=4.5&&r.len>40);if(!available.length)return [];const routes=available.slice(0,SHIELD_WALL_BUDGET[tier]);const loop=available.find(r=>r.road.closed);while(loop&&routes.length<SHIELD_WALL_BUDGET[tier])routes.push(loop);return routes;}
export interface OfficerPose {x:number;z:number;heading:number;row:number;column:number;gait:number}
/** Every rank samples the ACTUAL street polyline at its own arc distance (not a straight chord through a block).
 * Open roads reverse well inside their ends; closed roads loop. Lateral footprint fits the narrowest selected street.
 */
export function shieldWallPoses(route:Route,time:number,phase:number):OfficerPose[]{
 const margin=5,span=route.len-margin*2,travel=time*MARCH_SPEED+phase*(route.road.closed?route.len:span*2);
 const u=((travel%(span*2))+span*2)%(span*2),direction=route.road.closed?1:u<span?1:-1;
 const centre=route.road.closed?((travel%route.len)+route.len)%route.len:margin+(u<span?u:span*2-u);
 const poses:OfficerPose[]=[];
 for(let row=0;row<2;row++)for(let column=0;column<3;column++){
   let distance=centre+(row===0?.8:-.8)*direction;if(route.road.closed)distance=((distance%route.len)+route.len)%route.len;
   const t=distance/route.len/(route.road.closed?1:2),[x,z,angle]=routePoint(route,t,(column-1)*1.05*direction);
   poses.push({x,z,heading:angle+(direction<0?Math.PI:0),row,column,gait:Math.sin(time*4)});
 }
 return poses;
}
function policeTexture():THREE.Texture {
 const c=document.createElement('canvas');c.width=512;c.height=512;const x=c.getContext('2d');if(x){x.fillStyle='#223d69';x.fillRect(0,0,512,512);x.strokeStyle='#e6f4ff';x.lineWidth=24;x.strokeRect(18,18,476,476);x.fillStyle='#dbefff';x.fillRect(26,105,460,30);x.font='bold 90px sans-serif';x.textAlign='center';x.fillText('POLICE',256,295,450);x.fillStyle='#779bc4';x.fillRect(65,340,382,55);}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
export interface ShieldWallOptions {map:string;tier:WorldTier;enabled?:boolean;reducedMotion?:()=>boolean;label?:(s:string)=>THREE.Texture}
const noHit:THREE.Object3D['raycast']=()=>{};
export function attachCityShieldWalls(parent:THREE.Object3D,options:ShieldWallOptions){
 let dead=false,elapsed=0,last:number|null=null;let draw:((time:number)=>void)|null=null;
 const geometry=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),meshes:THREE.InstancedMesh[]=[];
 let root:THREE.Group|null=null;
 if((options.enabled??CITY_SHIELD_WALLS_ENABLED)&&options.map==='city'){
  const routes=shieldWallRoutes(options.tier);if(routes.length){root=new THREE.Group();root.name='city-shield-walls';root.raycast=noHit;root.userData.decorativeOnly=true;
   const geo=<T extends THREE.BufferGeometry>(g:T)=>{geometry.add(g);return g;};const mat=(color:number)=>{const m=new THREE.MeshBasicMaterial({color});materials.add(m);return m;};
   const box=geo(new THREE.BoxGeometry(1,1,1)),head=geo(new THREE.SphereGeometry(.28,8,6)),helmet=geo(new THREE.SphereGeometry(.39,8,6,0,Math.PI*2,0,Math.PI*.64)),panel=geo(new THREE.PlaneGeometry(1,1));
   const uniform=mat(0x17293d),skin=mat(0xd6ad88),shell=mat(0x344e70),glass=mat(0x83c9e3),frame=mat(0xd5e3ed),texture=(options.label?options.label('POLICE'):policeTexture());textures.add(texture);
   const label=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,toneMapped:false});materials.add(label);
   const n=routes.length*OFFICERS_PER_WALL;const inst=(g:THREE.BufferGeometry,m:THREE.Material,count:number,name:string)=>{const o=new THREE.InstancedMesh(g,m,count);o.name=name;o.raycast=noHit;o.frustumCulled=false; // Moving instances must not retain their initial-pose bounding sphere.
o.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root!.add(o);meshes.push(o);return o;};
   const bodies=inst(box,uniform,n,'police-bodies'),heads=inst(head,skin,n,'police-heads'),helmets=inst(helmet,shell,n,'police-helmets'),visors=inst(box,glass,n,'police-visors'),legs=inst(box,uniform,n*2,'police-legs'),arms=inst(box,uniform,n*2,'police-arms'),shields=inst(box,frame,n,'police-shield-frames'),labels=inst(panel,label,n,'police-shields');
   const o=new THREE.Object3D();
   const pose=(mesh:THREE.InstancedMesh,i:number,p:OfficerPose,x:number,y:number,z:number,sx:number,sy:number,sz:number,swing=0)=>{const c=Math.cos(p.heading),s=Math.sin(p.heading);o.position.set(p.x-s*x+c*z,y,p.z+c*x+s*z);o.rotation.set(swing,Math.PI/2-p.heading,0);o.scale.set(sx,sy,sz);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);};
   draw=(time:number)=>{routes.forEach((r,w)=>{const ps=shieldWallPoses(r,time,(w+.25)/routes.length);ps.forEach((p,k)=>{const i=w*OFFICERS_PER_WALL+k,bob=Math.sin(time*8)*.025;
    pose(bodies,i,p,0,1.35+bob,0,.7,1.05,.48);pose(heads,i,p,0,2.12+bob,0,1,1,1);pose(helmets,i,p,0,2.25+bob,0,1,1,1);pose(visors,i,p,0,2.25+bob,.32,.64,.24,.12);
    for(let side=0;side<2;side++){const sign=side?1:-1;pose(legs,i*2+side,p,sign*.21,.4,p.gait*sign*.11,.26,.74,.3,p.gait*sign*.18);pose(arms,i*2+side,p,sign*.43,1.35+bob,.15,.2,.75,.25);}
    pose(shields,i,p,0,1.17,.55,1.12,1.75,.13);pose(labels,i,p,0,1.17,.623,1.01,1.59,1);
   });});for(const mesh of meshes)mesh.instanceMatrix.needsUpdate=true;};
   parent.add(root);draw(0);
  }
 }
 return {step(time:number){if(dead||!draw||!Number.isFinite(time))return;const dt=last===null?0:Math.max(0,Math.min(.1,time-last));last=time;if(options.tier==='low'||(options.reducedMotion??prefersReducedMotion)())return;elapsed+=dt;draw(elapsed);},dispose(){if(dead)return;dead=true;draw=null;root?.removeFromParent();root?.clear();root=null;for(const m of meshes)m.dispose();meshes.length=0;for(const g of geometry)g.dispose();geometry.clear();for(const m of materials)m.dispose();materials.clear();for(const t of textures)t.dispose();textures.clear();}};
}
