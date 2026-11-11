// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { properties, PUBLIC_SERVICE_DEEDS, taxOf, sellBackOf } from '../shared/realEstate';
import { incomeEligible, incomeEntitlement, incomeBasisOf, PROPERTY_PAYBACK_MS } from '../shared/propertyIncome';
import { PropertyIncomeDetails } from '../client/src/components/PropertyIncomeDetails';
import { readFileSync } from 'node:fs';
afterEach(cleanup);
describe('automatic business income and public service deeds',()=>{
 it('covers exactly three gas stations, three rural warehouses and the city warehouse, no other maps/classes',()=>{
  const eligible=properties().filter(p=>incomeEligible(p.id));expect(eligible).toHaveLength(7);
  expect(eligible.filter(p=>p.type==='gas')).toHaveLength(3);expect(eligible.filter(p=>p.type==='depot')).toHaveLength(3);expect(eligible.filter(p=>p.type==='warehouse')).toHaveLength(1);
  expect(incomeEligible('lm:jail')).toBe(false);expect(incomeEligible('lm:harbour')).toBe(false);expect(incomeEligible('cf:1000')).toBe(false);
 });
 it('exact seven-day cumulative entitlement continues forever, using integer remainder not per-tick rounding',()=>{
  for(const cost of [60000,90000,500000,150001]) {expect(incomeEntitlement(cost,10,10+PROPERTY_PAYBACK_MS)).toBe(BigInt(cost));expect(incomeEntitlement(cost,10,10+PROPERTY_PAYBACK_MS*2)).toBe(BigInt(cost)*2n);}
  expect(incomeEntitlement(1,0,PROPERTY_PAYBACK_MS-1)).toBe(0n);expect(incomeEntitlement(1,0,PROPERTY_PAYBACK_MS)).toBe(1n);expect(incomeEntitlement(60000,100,99)).toBe(0n);
 });
 it('rejects invalid rate data instead of inventing purchase costs',()=>{expect(()=>incomeEntitlement(0,0,1)).toThrow();expect(()=>incomeEntitlement(1.2,0,1)).toThrow();});
 it('adds only two stable public deeds, retains all 555 other entries and thirty-four independent barns',()=>{
  expect(properties().filter(p=>!/^(sky|isl):/.test(p.id))).toHaveLength(557);expect(new Set(properties().map(p=>p.id)).size).toBe(properties().length);expect(properties().filter(p=>p.type==='barn')).toHaveLength(34);expect(properties().filter(p=>/^(sky|isl):/.test(p.id))).toHaveLength(10);
  expect(PUBLIC_SERVICE_DEEDS.map(p=>[p.id,p.price])).toEqual([['lm:jail',750000],['lm:harbour',1500000]]);
  for(const p of PUBLIC_SERVICE_DEEDS){expect(taxOf(p.price)).toBe(p.price*.005);expect(sellBackOf(p.price)).toBe(p.price*.7);expect(p.retired).toBeUndefined();}
 });
 it('rendered income disclosure uses exact recorded/quoted cost and explains offline, cadence, continuing rate and separate taxes without a claim button',()=>{
  const {container,rerender}=render(<dl><PropertyIncomeDetails id="b:gas:600:1600" cost={70000}/></dl>);expect(screen.getByTestId('deed-passive-income').textContent).toContain('10,000/day');
  expect(container.textContent).toContain('while offline');expect(container.textContent).toContain('every 10 minutes');expect(container.textContent).toContain('same rate forever');expect(container.textContent).toContain('Separate property and purchase taxes still apply');expect(container.querySelector('button')).toBeNull();
  rerender(<dl><PropertyIncomeDetails id="lm:jail" cost={750000}/></dl>);expect(screen.queryByTestId('deed-passive-income')).toBeNull();
 });
 it('buyout disclosure uses the original city-paid basis, not the reciprocal premium, while normal purchases keep actual cost',()=>{
  expect(incomeBasisOf(66000,66000)).toBe(66000);expect(incomeBasisOf(4000000,500000)).toBe(500000);expect(incomeBasisOf(60000,null)).toBe(60000);
  render(<dl><PropertyIncomeDetails id="lm:warehouse" cost={4000000} cityBasis={500000}/></dl>);
  expect(screen.getByTestId('deed-passive-income').textContent).toContain('71,428.57/day');expect(screen.getByTestId('deed-income-buyout-cap').textContent).toContain('premium is not repaid in seven days');expect(screen.getByTestId('deed-income-buyout-cap').textContent).toContain('500,000');
 });
 it('jail models and harbour terminal route to deeds without changing public service/travel/shipping handlers or mobile sheet structure',()=>{
  const src=readFileSync('client/src/lib/world3d.ts','utf8');expect(src).toContain("o.userData.spot = 'lm:jail'");expect(src).toContain("id.startsWith('lm:')");expect(src).toContain('new THREE.BoxGeometry(14.6, 6, 8.6)');
  const ui=readFileSync('client/src/components/WorldMap.tsx','utf8');expect(ui).toContain('Ownership never restricts jail/law enforcement');expect(ui).toContain('No owner-controlled fees and no passive income');expect(ui).toContain('<MapSheet className="world-deed"');
 });
});
