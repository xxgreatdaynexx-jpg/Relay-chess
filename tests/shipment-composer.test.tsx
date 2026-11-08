// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {createElement} from 'react';
import {readFileSync} from 'node:fs';
const net=vi.hoisted(()=>({request:vi.fn()}));vi.mock('@/lib/net',()=>net);
import {ShipmentComposer} from '../client/src/components/ShipmentComposer';
import {FleetStore} from '../client/src/components/FleetStore';
afterEach(()=>{cleanup();vi.clearAllMocks();});
const source={id:'warehouse',label:'City warehouse',items:[{item:'ore:iron',label:'Iron',qty:10},{item:'fish:bass',label:'Bass',qty:2}]};
it('stages several types locally; submits one immutable confirmed manifest and retries same key',async()=>{net.request.mockImplementation(async(ev:string)=>ev==='loc_batch_quote'?{ok:true,quote:{fee:5,trips:1,arriveAt:Date.now()+10000,capacity:100000,total:3,types:2}}:{ok:false,error:'Pending'});
 render(createElement(ShipmentComposer,{source,destinations:[{id:'resort',label:'Resort',items:[]}],onDone:vi.fn(),onCancel:vi.fn()}));
 fireEvent.click(screen.getByLabelText('Select Iron'));fireEvent.change(screen.getByLabelText('Iron quantity'),{target:{value:'2'}});fireEvent.click(screen.getByLabelText('Select Bass'));
 await screen.findByTestId('manifest-quote');expect(net.request.mock.calls.filter(c=>c[0]==='loc_batch_move')).toHaveLength(0);expect(screen.getByTestId('manifest-total').textContent).toContain('2 item types · 3 total units');
 fireEvent.click(screen.getByText('Confirm dispatch'));await screen.findByText('Retry same shipment');expect((screen.getByLabelText('Iron quantity').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);fireEvent.click(screen.getByText('Retry same shipment'));
 await waitFor(()=>expect(net.request.mock.calls.filter(c=>c[0]==='loc_batch_move')).toHaveLength(2));const calls=net.request.mock.calls.filter(c=>c[0]==='loc_batch_move');expect(calls[0][1]).toEqual(calls[1][1]);expect(calls[0][1].items).toEqual([{item:'ore:iron',qty:2},{item:'fish:bass',qty:1}]);expect(calls[0][1].maxFee).toBe(5);
});
it('rejects noninteger quantities before quoting or dispatch',async()=>{render(createElement(ShipmentComposer,{source,destinations:[{id:'resort',label:'Resort',items:[]}],onDone:vi.fn(),onCancel:vi.fn()}));fireEvent.click(screen.getByLabelText('Select Iron'));fireEvent.change(screen.getByLabelText('Iron quantity'),{target:{value:'1.5'}});expect((await screen.findByRole('status')).textContent).toContain('whole number');expect(net.request).not.toHaveBeenCalled();expect((screen.getByText('Confirm dispatch') as HTMLButtonElement).disabled).toBe(true);});
it('hangar-only expansion retains non-scrolling sibling header, viewport bounds and touch controls',()=>{const css=readFileSync('client/src/index.css','utf8');const src=readFileSync('client/src/components/FleetStore.tsx','utf8');expect(src).toContain("boat ? '' : ' private-hangar'");expect(src).toContain('return boat ? panel : createPortal(panel, document.body)');expect(src.indexOf('<header>')).toBeLessThan(src.indexOf('<div className="dealer-body">'));expect(css).toContain('.private-hangar > .dealer-box > header { flex: none; position: relative;');expect(css).toContain('height: 100dvh; max-height: 100dvh;');expect(css).toContain('.private-hangar .dealer-body { flex: 1; min-height: 0; overflow-y: auto;');expect(css).toContain('min-height: 44px');});

it('actual hangar DOM portals out of the airport, keeps close outside scroll body, and marina stays inline',()=>{
 const errors=vi.spyOn(console,'error').mockImplementation(()=>{});const context=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);net.request.mockResolvedValue({ok:true});
 try{const close=vi.fn();const jet=render(createElement(FleetStore,{kind:'jet',onClose:close}));const panel=screen.getByTestId('hangar');expect(panel.parentElement).toBe(document.body);const button=screen.getByTestId('fleet-close');expect(button.closest('header')?.parentElement).toBe(panel.querySelector('.dealer-box'));expect(button.closest('.dealer-body')).toBe(null);fireEvent.click(button);expect(close).toHaveBeenCalledOnce();jet.unmount();const boat=render(createElement(FleetStore,{kind:'boat',onClose:close}));expect(screen.getByTestId('marina').parentElement).toBe(boat.container);boat.unmount();}finally{context.mockRestore();errors.mockRestore();}
});
