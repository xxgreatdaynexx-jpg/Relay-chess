import { FORT_SPOTS,FORT_X0,FORT_X1,FORT_Z0,FORT_Z1,FORT_YARDS,TRACTS,YARD_D,YARD_W,tractInfo,ownerColor,type FortSite,type FortState } from '../../../shared/fortmc';
import { FORT_WATERS, MINE_PIT } from '../../../shared/fortmcLand';
/** Real coordinate map, not a navigation list. No WebGL/canvas required; touch-scroll the readable map on small screens. */
export function FortFlatMap({fort,site,onPick}:{fort:FortState|null;site?:FortSite|null;onPick:(id:string)=>void}){
 const place=(x:number,z:number)=>({left:`${(x-FORT_X0)/(FORT_X1-FORT_X0)*100}%`,top:`${(z-FORT_Z0)/(FORT_Z1-FORT_Z0)*100}%`});
 return <div className="fort-flat-map" data-testid="fort-flat-map" aria-label="Fort McChud 2D map" tabIndex={0}><div className="fort-flat-board">
 <svg viewBox={`${FORT_X0} ${FORT_Z0} ${FORT_X1-FORT_X0} ${FORT_Z1-FORT_Z0}`} aria-hidden="true" preserveAspectRatio="none"><rect x={FORT_X0} y={FORT_Z0} width={FORT_X1-FORT_X0} height={FORT_Z1-FORT_Z0} fill="#384632"/>
  {FORT_WATERS.filter(w=>w.kind==='tailings').map((w,i)=><ellipse key={i} cx={w.x} cy={w.z} rx={w.rx} ry={w.rz} fill="#5b5246"/>)}
  {FORT_YARDS.map((y,i)=><rect key={i} x={y.x-YARD_W/2} y={y.z-YARD_D/2} width={YARD_W} height={YARD_D} fill={y.camp?'#4a4f3f':'#4d4a3c'} stroke="#7d7462" strokeWidth="1"/>)}
  <path d={`M ${FORT_X0+5} -4 H ${FORT_X1-5} M ${FORT_X0+5} 56 H ${FORT_X1-5} M -128 -15 V 55 M 128 -113 V 57 M -412 -62 V 98 M -157 -96 V -4`} stroke="#9b927f" strokeWidth="6" fill="none"/>
  <path d="M -400 -103 H 60" stroke="#8a9099" strokeWidth="1.5" strokeDasharray="6 4" fill="none"/>
  <circle cx={MINE_PIT.x} cy={MINE_PIT.z} r={MINE_PIT.r} fill="#6b4f33"/><path d="M 74 99 H 140 V 100 H 74" stroke="#3b819d" strokeWidth="12"/></svg>
 <span className="fort-flat-note" style={place(-352,79)}>🏕 Work Camp</span><span className="fort-flat-note" style={place(-280,-110+6)}>West Field · tracts 11–20</span><span className="fort-flat-note" style={place(-60,-110+6)}>East Field · tracts 1–10</span>
 {Array.from({length:TRACTS},(_,i)=>tractInfo(i+1)).map(t=>{
  const L=site?.leases[String(t.n)];
  const owned=!!(L?.mine || (!site && fort?.tracts[String(t.n)]?.leased));
  const style={...place(t.x,t.z), ...(L?{'--lessor':ownerColor(L.key)}:{})};
  return <button key={t.n} type="button" className={`fort-flat-tract${owned?' owned':''}`} style={style} data-lessor={L?.name||undefined} onClick={()=>onPick(`t:${t.n}`)} data-testid={`fort-flat-tract-${t.n}`}><b>🛢 Tract {t.n}</b><small>{t.name}</small>{L && <span className="fort-flat-lessor">{L.mine?'Your lease':L.name}</span>}</button>;
 })}
 {FORT_SPOTS.map(s=><button key={s.id} type="button" className="fort-flat-spot" style={place(s.x,s.z)} onClick={()=>onPick(s.id)} data-testid={`fort-flat-${s.id}`}><b>{s.icon} {s.label}</b></button>)}
 </div></div>;
}
