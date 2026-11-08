/** Geometry-only precomputed wander corridors. No scene, state, network or animation timers. */
import {ROADS,PLATE,shoreZ,obbHit,routePoint,type Route,type OBB,type Patch} from '../../../shared/worldLayout';
import type {CrowdSite} from './citywideCrowds';
type Point={x:number;z:number;heading:number};
export interface CrowdWalk {points:Point[];cum:number[];length:number;phase:number;speed:number;source:string}
const STEP=.5,REACH=8;
export const CROWD_LOW_UPDATE_HZ=8;
export function buildCrowdWalks(sites:readonly CrowdSite[],patches:readonly Pick<Patch,'x'|'z'|'w'|'d'|'rot'>[],obstacles:readonly OBB[]):CrowdWalk[]{
 const routes=new Map<string,Route>();for(const road of ROADS){const p=road.closed?[...road.pts,road.pts[0]]:road.pts,cum=[0];for(let i=1;i<p.length;i++)cum.push(cum[i-1]+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));routes.set(road.id,{road,p,cum,len:cum[cum.length-1]});}
 return sites.map((site,index)=>{
  const route=routes.get(site.source);
  const nearby=obstacles.filter(b=>Math.abs(b.x-site.x)<(b.w+b.d)/2+REACH+4&&Math.abs(b.z-site.z)<(b.w+b.d)/2+REACH+4);
  const inPatch=(p:Pick<Patch,'x'|'z'|'w'|'d'|'rot'>,x:number,z:number)=>{const dx=x-p.x,dz=z-p.z;return Math.abs(Math.cos(p.rot)*dx-Math.sin(p.rot)*dz)<=p.w/2-2+.001&&Math.abs(Math.sin(p.rot)*dx+Math.cos(p.rot)*dz)<=p.d/2-2+.001;};
  const patch=route?undefined:patches.find(p=>inPatch(p,site.x,site.z));
  const angle=patch?(patch.w>=patch.d?-patch.rot:Math.PI/2-patch.rot):site.heading;
  const at=(distance:number):Point|null=>{if(route){const arc=(site.distance??0)+distance;if(!route.road.closed&&(arc<0||arc>route.len))return null;const [x,z,heading]=routePoint(route,arc/route.len/(route.road.closed?1:2),0);return{x,z,heading};}return{x:site.x+Math.cos(angle)*distance,z:site.z+Math.sin(angle)*distance,heading:angle};};
  const safe=(p:Point)=>Math.abs(p.x)<=PLATE-4&&p.z>=-PLATE+4&&p.z<=shoreZ(p.x)-4&&!nearby.some(b=>obbHit(b,p.x,p.z,2.8))&&(!!route||!!patch&&inPatch(patch,p.x,p.z));
  const middle=at(0)??{...site},negative:Point[]=[],positive:Point[]=[];
  for(const direction of [-1,1])for(let d=STEP;d<=REACH;d+=STEP){const p=at(d*direction);if(!p||!safe(p))break;(direction<0?negative:positive).push(p);}
  const points=[...negative.reverse(),middle,...positive],cum=[0];for(let i=1;i<points.length;i++)cum.push(cum[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z));
  return{points,cum,length:cum[cum.length-1],phase:index*2.399963229728653,speed:.9+(index%9)*.075,source:site.source};
 });
}
/** Smooth positional out-and-back motion, independently phased/speeded per group. Figures keep their order at turns. */
export function crowdWalkPose(path:CrowdWalk,time:number){
 if(path.length<.01)return{...path.points[0],direction:1,pace:0};
 const phase=time*path.speed/(path.length/2)+path.phase,wave=Math.sin(phase),direction=Math.cos(phase)>=0?1:-1,distance=(wave+1)*path.length/2;
 let lo=0,hi=path.cum.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(path.cum[m]<=distance)lo=m;else hi=m;}
 const a=path.points[lo],b=path.points[Math.min(lo+1,path.points.length-1)],f=(distance-path.cum[lo])/(path.cum[Math.min(lo+1,path.cum.length-1)]-path.cum[lo]||1),angle=Math.atan2(Math.sin(b.heading-a.heading),Math.cos(b.heading-a.heading));
 return{x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f,heading:a.heading+angle*f,direction,pace:Math.abs(Math.cos(phase))};
}
