/** Bill Chud 4: zoning deed caps raised to 10; farmland tile cap raised to 2,000. Grandfathering and exemptions unchanged. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { implementationOf, bill4Identity } from '../server/billImplementations';
import { MayorLaws as Panel } from '../client/src/components/MayorLaws';
import type { MayorLaw, BillImplementation } from '../shared/mayorLaws';
import { BILL3_IMPLEMENTATION_TEXT } from '../shared/bill3';
import {
  BILL4_IDENTITY_SHA256, BILL4_IMPLEMENTATION_TEXT, BILL4_NUMBER, BILL4_DAY, BILL4_BY, BILL4_AT, BILL4_ORIGINAL_TEXT,
} from '../shared/bill4';
import { CHANGELOG } from '../shared/changelog';
import { FARMLAND_TILE_CAP, ZONE_DEED_CAP, zoneRefusal } from '../shared/zoning';

const OFFICIAL = {
  number: BILL4_NUMBER, day: BILL4_DAY, text: BILL4_ORIGINAL_TEXT, by_name: BILL4_BY, at: BILL4_AT, status: 'pending',
  vetoed_at: null, vetoed_by_key: null, vetoed_by_name: null, vetoed_role: null, vetoed_term_week: null,
};

const law = (number: string, title: string, text: string, day: string, implementation?: BillImplementation, status: MayorLaw['status'] = 'pending'): MayorLaw => ({
  number, title, text, by: 'carter2', at: 1, day, status, vetoedAt: status === 'vetoed' ? 2 : null, vetoedBy: status === 'vetoed' ? 'Vice' : null, vetoedRole: status === 'vetoed' ? 'vice' : null, implementation,
});

const enacted = (text: string, release = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'): BillImplementation => ({
  status: 'enacted', revision: 1, implementedAt: 1, release, text,
});

describe('Bill Chud 4 identity and enacted wording', () => {
  it('hashes [number, day, text, by_name, at] and only matches the official pending row', () => {
    expect(BILL4_IDENTITY_SHA256).toBe(createHash('sha256').update(JSON.stringify([BILL4_NUMBER, BILL4_DAY, BILL4_ORIGINAL_TEXT, BILL4_BY, BILL4_AT])).digest('hex'));
    expect(bill4Identity(OFFICIAL)).toBe(BILL4_IDENTITY_SHA256);
    expect(implementationOf({ ...OFFICIAL, text: 'not the official text' })).toBeUndefined();
    expect(implementationOf({ ...OFFICIAL, status: 'vetoed', vetoed_at: 1, vetoed_by_name: 'Vice', vetoed_role: 'vice' })).toBeUndefined();
    expect(BILL4_IMPLEMENTATION_TEXT).toContain('10 residential');
    expect(BILL4_IMPLEMENTATION_TEXT).toContain('10 commercial');
    expect(BILL4_IMPLEMENTATION_TEXT).toContain('2,000 full-plot tiles');
    expect(BILL4_IMPLEMENTATION_TEXT).toMatch(/grandfathered/);
    expect(BILL4_IMPLEMENTATION_TEXT).toMatch(/Resort lots and land patches remain exempt/);
    expect(BILL4_IMPLEMENTATION_TEXT.toLowerCase()).not.toMatch(/dayne/);
    expect(CHANGELOG[0]?.title ?? '').not.toMatch(/Bill Chud 4/i);
  });

  it('attaches enacted metadata when the official identity hash matches a pending un-vetoed row', () => {
    const m = implementationOf(OFFICIAL)!;
    expect(m).toMatchObject({ status: 'enacted', revision: 1, text: BILL4_IMPLEMENTATION_TEXT, implementedAt: 1794663044789 });
    expect(m.release).toMatch(/^(release-queue|[a-f0-9]{40})$/);
    const copy = implementationOf(OFFICIAL)!;
    copy.text = 'tampered';
    expect(implementationOf(OFFICIAL)!.text).toBe(BILL4_IMPLEMENTATION_TEXT);
    for (const [k, v] of Object.entries({ number: '5', day: '2026-11-14', text: BILL4_ORIGINAL_TEXT + ' ', by_name: 'Other', at: BILL4_AT + 1 })) {
      expect(implementationOf({ ...OFFICIAL, [k]: v }), k).toBeUndefined();
    }
  });
});

describe('Bill Chud 4 caps and history display', () => {
  it('raises deed caps to 10 and the farmland cap to 2,000, keeping grandfathering and exemptions', () => {
    expect(ZONE_DEED_CAP).toBe(10);
    expect(FARMLAND_TILE_CAP).toBe(2000);
    const house = { kind: 'building' as const, type: 'house', map: undefined, label: 'House' };
    expect(zoneRefusal({ residential: 9, commercial: 10, farmlandTiles: 2000 }, house)).toBeNull();
    expect(zoneRefusal({ residential: 10, commercial: 0, farmlandTiles: 0 }, house)).toMatch(/already own 10 residential/);
  });

  it('history shows Bills 1–4 with Bill 4 Enacted, and older enacted wording is unchanged', () => {
    const bill1Text = 'New acquisitions are limited separately to 5 residential deeds and 5 commercial deeds per citizen. Farmland is limited to 1,500 full-plot tiles per citizen.';
    const history = [
      law('4', 'Bill Chud 4', BILL4_ORIGINAL_TEXT, '2026-11-13', implementationOf(OFFICIAL)),
      law('3', 'Bill Chud 3', 'original bill 3', '2026-11-11', enacted(BILL3_IMPLEMENTATION_TEXT, 'c669c10d50f95757820e6a925c70a756af801210')),
      law('2', 'Bill Chud 2', 'Unimplemented vetoed bill', '2026-11-09', undefined, 'vetoed'),
      law('1', 'Bill Chud 1', 'original bill 1', '2026-11-08', enacted(bill1Text, 'fc56eedcc90c5008b53d0c13319a15649c66e82f')),
    ];
    const html = renderToStaticMarkup(<Panel view={{ history, nextBefore: null, submittedToday: true }} isMayor isVice today="2026-11-14" busy={false} onPass={async () => {}} onVeto={async () => {}} />);
    expect(html).toContain('Bill Chud 4'); expect(html).toContain('Bill Chud 3'); expect(html).toContain('Bill Chud 2'); expect(html).toContain('Bill Chud 1');
    expect(html.match(/Enacted — revised wording/g)).toHaveLength(3);
    expect(html).toContain('10 residential deeds'); expect(html).toContain('10 commercial deeds'); expect(html).toContain('2,000 full-plot tiles');
    expect(html).toContain('5 residential deeds'); expect(html).toContain('1,500 full-plot tiles');
    expect(html).toContain('counts toward the 5-commercial cap');
    expect(html).toContain('Vetoed');
    expect(html).toContain('Original submission (archived)');
    expect(html).toContain(BILL4_ORIGINAL_TEXT);
    expect(html).not.toMatch(/Dayne/i);
    expect((html.match(/data-testid="mayor-law-veto"/g) ?? []).length).toBe(0);
  });

  it('real-estate and factory copy use the live cap constants', () => {
    const map = readFileSync('client/src/components/WorldMap.tsx', 'utf8');
    expect(map).toContain('{ZONE_DEED_CAP} residential, {ZONE_DEED_CAP} commercial');
    expect(map).toContain("{FARMLAND_TILE_CAP.toLocaleString('en-US')} farmland tiles");
    expect(map).not.toMatch(/Zoning caps on new purchases: 5 residential/);
    const fac = readFileSync('client/src/components/FactoryBuilder.tsx', 'utf8');
    expect(fac).toContain('{ZONE_DEED_CAP}-commercial cap');
    expect(fac).not.toMatch(/within the 5-commercial cap/);
  });
});
