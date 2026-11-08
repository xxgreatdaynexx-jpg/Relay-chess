// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { CoopPanel } from '../client/src/components/CoopPanel';
import { COOP_PLAN, projectStages } from '../shared/coop';
const net=vi.hoisted(()=>({request:vi.fn(),socket:{on:vi.fn(),off:vi.fn()}}));
vi.mock('../client/src/lib/net',()=>net);
vi.mock('../client/src/components/Coop3Tabs',()=>({SupplyTab:()=>null,FleetTab:()=>null,EventTab:()=>null}));
describe('Co-op panel opening',()=>{
  it('renders a QA viewer without an eligibility gate and shows material selection from coop_view',async()=>{
    net.request.mockResolvedValue({ok:true,active:'stadium',projects:[{
      ...COOP_PLAN.stadium,state:'active',stage:0,pct:.01,top:[],
      stages:projectStages(COOP_PLAN.stadium).map(s=>({...s,done:{},pct:0})),
    }],perks:{stadium:false,bridge:false},contracts:{current:null,past:[]},have:{'bar:concrete':20},chips:1000});
    try {
      render(<CoopPanel onClose={()=>{}} me="QA-Cole-HS2"/>);
      expect(screen.getByTestId('coop-panel')).toBeTruthy();
      await waitFor(()=>expect(screen.getByTestId('coop-part')).toBeTruthy());
      expect(screen.getByTestId('coop-part').textContent).toContain('Concrete Block (you have 20)');
      expect(screen.getByTestId('coop-donate-btn').textContent).toBe('Donate');
      expect(net.request).toHaveBeenCalledWith('coop_view');
      expect(net.request).not.toHaveBeenCalledWith('coop_donate',expect.anything());
    } finally {cleanup();}
  });
});
