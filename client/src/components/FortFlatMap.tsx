import { FORT_SPOTS,FORT_X0,FORT_X1,FORT_Z0,FORT_Z1,TRACTS,tractInfo,ownerColor,type FortSite,type FortState } from '../../../shared/fortmc';
/** Real coordinate map, not a navigation list. No WebGL/canvas required; touch-scroll the readable map on small screens. */
export function FortFlatMap({fort,site,onPick}:{fort:FortState|null;site?:FortSite|null;onPick:(id:string)=>void}){
 const place=(x:number,z:number)=>({left:`${(x-FORT_X0)/(FORT_X1-FORT_X0)*100}%`,top:`${(z-FORT_Z0)/(FORT_Z1-FORT_Z0)*100}%`});
 return <div className="fort-flat-map" data-testid="fort-flat-map" aria-label="Fort McChud 2D map" tabIndex={0}><div className="fort-flat-board">
 <svg viewBox={`${FORT_X0} ${FORT_Z0} ${FORT_X1-FORT_X0} ${FORT_Z1-FORT_Z0}`} aria-hidden="true" preserveAspectRatio="none"><rect x={FORT_X0} y={FORT_Z0} width={FORT_X1-FORT_X0} height={FORT_Z1-FORT_Z0} fill="#384632"/><path d="M -135 -4 H 135 M -135 56 H 135 M -128 -15 V 55 M 128 -113 V 57" stroke="#9b927f" strokeWidth="6" fill="none"/><path d="M 74 99 H 140 V 100 H 74" stroke="#3b819d" strokeWidth="12"/></svg>
 {Array.from({length:TRACTS},(_,i)=>tractInfo(i+1)).map(t=>{
  const L=site?.leases[String(t.n)];
  const owned=!!(L?.mine || (!site && fort?.tracts[String(t.n)]?.leased));
  const style={...place(t.x,t.z), ...(L?{'--lessor':ownerColor(L.key)}:{})};
  return <button key={t.n} type="button" className={`fort-flat-tract${owned?' owned':''}`} style={style} data-lessor={L?.name||undefined} onClick={()=>onPick(`t:${t.n}`)} data-testid={`fort-flat-tract-${t.n}`}><b>🛢 Tract {t.n}</b><small>{t.name}</small>{L && <span className="fort-flat-lessor">{L.mine?'Your lease':L.name}</span>}</button>;
 })}
 {FORT_SPOTS.map(s=><button key={s.id} type="button" className="fort-flat-spot" style={place(s.x,s.z)} onClick={()=>onPick(s.id)} data-testid={`fort-flat-${s.id}`}><b>{s.icon} {s.label}</b></button>)}
 </div></div>;
}
