import { useEffect, useRef, useState } from 'react';
import { request } from '@/lib/net';
import { MODES, fmtEta, type Mode } from '../../../shared/logistics';
import { shipmentManifest } from '../../../shared/shipmentManifest';
type Stock={id:string;label:string;items:Array<{item:string;label:string;qty:number}>};
type Quote={fee:number;trips:number;arriveAt:number;capacity:number;total:number;types:number};
/** Local staging only: editing never withdraws stock. One immutable retry payload after confirming. */
export function ShipmentComposer({source,destinations,onDone,onCancel}:{source:Stock;destinations:Stock[];onDone:()=>void;onCancel:()=>void}){
  const [selected,setSelected]=useState<Record<string,number>>({});const [to,setTo]=useState(destinations[0]?.id??'');const [mode,setMode]=useState<Mode>('ship');
  const [quote,setQuote]=useState<Quote|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState<Record<string,unknown>|null>(null);const revision=useRef(0);
  const items=Object.entries(selected).map(([item,qty])=>({item,qty}));const key=JSON.stringify([source.id,to,mode,items]);
  useEffect(()=>{const n=++revision.current;setQuote(null);setError('');if(pending)return;
    try{shipmentManifest(items);}catch(e){if(items.length)setError((e as Error).message);return;}
    if(!to)return;const timer=window.setTimeout(()=>{void request('loc_batch_quote',{from:source.id,to,mode,items}).then(a=>{if(n!==revision.current)return;if(a.ok)setQuote((a as unknown as {quote:Quote}).quote);else setError(a.error??'Quote unavailable.');});},200);
    return()=>{window.clearTimeout(timer);revision.current++;};
  },[key,pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const dispatch=async()=>{if(busy||(!pending&&!quote))return;
    const payload=pending??{from:source.id,to,mode,items,maxFee:quote!.fee,requestId:crypto.randomUUID()};
    setPending(payload);setBusy(true);setError('');
    try{const a=await request('loc_batch_move',payload);if(a.ok){onDone();return;}setError(a.error??'Confirmation pending.');}
    catch{setError('Confirmation unavailable. Retry the same shipment safely.');}finally{setBusy(false);}
  };
  return <section className="freight-form manifest-form" data-testid="shipment-composer">
    <h4>Transfer to ship · {source.label}</h4><p>Choose several goods for one shipment. Nothing leaves your warehouse until you confirm.</p>
    <fieldset disabled={!!pending||busy}><legend>Goods and quantities</legend>{source.items.map(i=><label className="manifest-line" key={i.item}>
      <input type="checkbox" checked={i.item in selected} aria-label={`Select ${i.label}`} onChange={e=>setSelected(s=>{const n={...s};if(e.target.checked)n[i.item]=Math.min(i.qty,1);else delete n[i.item];return n;})}/>
      <span>{i.label} <small>({i.qty.toLocaleString()} available)</small></span>
      {i.item in selected&&<input type="number" inputMode="numeric" min={1} max={i.qty} step={1} aria-label={`${i.label} quantity`} value={selected[i.item]} onChange={e=>setSelected(s=>({...s,[i.item]:Number(e.target.value)}))}/>}
    </label>)}</fieldset>
    <fieldset disabled={!!pending||busy}><legend>Route and carrier</legend><label>To<select value={to} onChange={e=>setTo(e.target.value)}>{destinations.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      <div className="freight-modes">{(['ship','plane','boat','jet'] as Mode[]).map(m=><button key={m} type="button" className={mode===m?'on':''} onClick={()=>setMode(m)}>{MODES[m].icon} {MODES[m].label}</button>)}</div>
    </fieldset>
    <p data-testid="manifest-total">{items.length} item types · {items.reduce((n,i)=>n+i.qty,0).toLocaleString()} total units</p>
    {quote&&<p data-testid="manifest-quote">Capacity {quote.capacity.toLocaleString()} units/trip · {quote.trips} trip{quote.trips===1?'':'s'} · Fee 🪙 {quote.fee.toLocaleString()} · arrives in {fmtEta(quote.arriveAt-Date.now())}</p>}
    {pending&&<p>Shipment submitted. Retry uses the same goods, route and confirmation key; it cannot send a second load.</p>}
    {error&&<p role="status">{error}</p>}
    <button type="button" className="dealer-drive" disabled={busy||(!pending&&!quote)} onClick={()=>void dispatch()}>{busy?'Confirming…':pending?'Retry same shipment':'Confirm dispatch'}</button>
    {!pending&&<button type="button" onClick={onCancel}>Cancel</button>}
  </section>;
}
