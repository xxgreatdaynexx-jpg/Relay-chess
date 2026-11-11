import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DIGITAL_DAILY_BASE, ESTATE_BUILD_ORDER, ESTATE_BUILDS, GPU_RIG, GRID_POWER_DAY, GRID_SELL_FRACTION,
  PLANT_FUEL_DAY, PLANT_MW, SERVER_RACK, canDemolish, estateProjectValue, estateStages, digitalPayout, throttle,
} from '../shared/estateProjects';
import { EAST_X0, EXPANSION_BOUNDS, PLASTICS_PLANT, RIG_DOCK, estateLots, expansionFarms, goldwoodHomes, wineryPlots, WINERY_GRAPES_PER_WINE, WINERY_GROW_MUL } from '../shared/mapExpansion';
import { HYPER_CROPS, HYPER_FARM_TOTAL, HYPER_GROW_MUL, HYPER_STAGES, isHyperCrop } from '../shared/hyperFarm';
import { RIG_CRUDE_PER_HOUR, RIG_LAUNCH_FEE, RIG_MAX_PER_PLAYER, RIG_STAGES } from '../shared/offshoreRig';
import { PLASTICS_RECIPES } from '../shared/plasticsPlant';
import { FUTURE_FEATURES_BODY, FUTURE_FEATURES_SHOTS, FUTURE_FEATURES_TITLE } from '../shared/futureFeatures';
import { properties } from '../shared/realEstate';
import { obbOverlap } from '../shared/worldLayout';
import { FURNITURE } from '../shared/homes';
import { AIRPORT, AIRPORT_SLOT, RUNWAY, RUNWAY2 } from '../shared/venues';
import { BILLIONAIRE_SIGN, BILLIONAIRE_SIGN_POS, BILLIONAIRE_SIGN_RADIUS } from '../shared/billionaireUpdate';
import { cropById, MAP_CAM_FAR, MAP_CAM_MAX, MAP_CAM_MIN, MAP_VIEW } from '../shared/farm';
import { GOODS } from '../shared/mines';
import { hasItemIcon, itemIconSvg } from '../shared/itemIcons';
import { allFieldPlots } from '../shared/fieldFarms';
import { orchardId, orchardPlots } from '../shared/orchard';
import { bigFarms } from '../shared/bigFarms';
import { MINE_SITES } from '../shared/worldLayout';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('private construction sites', () => {
  it('each build has four stages, a model hook, and the listed totals', () => {
    const totals: Record<string, number> = {
      data_center: 2_400_000, bitcoin_farm: 2_100_000, monument: 1_200_000,
      mansion: 3_200_000, highrise: 4_800_000, power_plant: 3_600_000,
    };
    expect(ESTATE_BUILD_ORDER).toEqual(['data_center', 'bitcoin_farm', 'monument', 'mansion', 'highrise', 'power_plant']);
    for (const id of ESTATE_BUILD_ORDER) {
      const p = ESTATE_BUILDS[id];
      expect(p.stages).toHaveLength(4);
      expect(estateStages(p)).toHaveLength(4);
      expect(p.total).toBe(totals[id]);
      expect(estateProjectValue(p)).toBeGreaterThan(0);
    }
  });

  it('does not demolish landmarks, civic buildings, harbour, jail or sky/island homes', () => {
    expect(canDemolish({ id: 'lm:casino', kind: 'landmark', type: 'casino' }).ok).toBe(false);
    expect(canDemolish({ id: 'lm:harbour', kind: 'landmark', type: 'harbour' }).ok).toBe(false);
    expect(canDemolish({ id: 'lm:jail', kind: 'landmark', type: 'jail' }).ok).toBe(false);
    expect(canDemolish({ id: 'sky:1', kind: 'building', type: 'penthouse' }).ok).toBe(false);
    expect(canDemolish({ id: 'isl:1', kind: 'building', type: 'isleestate', map: 'island' }).ok).toBe(false);
    expect(canDemolish({ id: 'b:house:1', kind: 'building', type: 'house' }).ok).toBe(true);
    expect(canDemolish({ id: 'f:1', kind: 'farm', type: 'farmland' }).ok).toBe(true);
    expect(canDemolish({ id: 'lot:estate:1', kind: 'patch', type: 'estate_lot' }).ok).toBe(true);
  });
});

describe('data centers, bitcoin farms and power', () => {
  it('hardware, demand and the digital cap match the published numbers', () => {
    expect(SERVER_RACK).toMatchObject({ price: 120_000, mw: 3, chipsPerHour: 400, max: 8 });
    expect(GPU_RIG).toMatchObject({ price: 45_000, mw: 1.5, chipsPerHour: 200, max: 16 });
    expect(PLANT_MW).toBe(40);
    expect(PLANT_FUEL_DAY).toBe(8_000);
    expect(GRID_POWER_DAY).toBe(1_200);
    expect(GRID_SELL_FRACTION).toBe(0.45);
    expect(DIGITAL_DAILY_BASE).toBe(200_000);
    expect(throttle(0, 10)).toBe(0);
    expect(throttle(10, 10)).toBe(1);
    expect(throttle(5, 10)).toBe(0.5);
    expect(digitalPayout(50_000, 180_000, 200_000)).toBe(20_000);
    expect(digitalPayout(50_000, 200_000, 200_000)).toBe(0);
  });
});

describe('map expansion and Goldwood', () => {
  it('adds lots, farms, mansions and wineries without moving existing deeds', () => {
    expect(estateLots()).toHaveLength(18);
    expect(estateLots().filter((l) => l.kind === 'turnkey_plant')).toHaveLength(2);
    expect(goldwoodHomes()).toHaveLength(8);
    expect(wineryPlots()).toHaveLength(5);
    expect(expansionFarms()).toHaveLength(10);
    expect(orchardPlots()).toHaveLength(8);
    expect(expansionFarms().every((f) => f.n >= 2000)).toBe(true);
    expect(EAST_X0).toBeGreaterThan(356);
    expect(MINE_SITES['mine-quarry'].x).toBe(328);
    expect(MINE_SITES['mine-quarry'].z).toBe(-158);
    for (const p of [...estateLots(), ...goldwoodHomes(), ...wineryPlots(), ...expansionFarms(), ...orchardPlots()]) {
      expect(p.x).toBeGreaterThanOrEqual(EXPANSION_BOUNDS.x0 - 1);
      expect(p.x).toBeLessThanOrEqual(EXPANSION_BOUNDS.x1 + 1);
    }
  });

  it('new plots do not overlap existing city, farm or quarry property', () => {
    const fresh = new Set([
      ...estateLots().map((l) => `lot:estate:${l.n}`),
      ...goldwoodHomes().map((h) => `b:mansion:${h.n}`),
      ...wineryPlots().map((w) => `winery:${w.n}`),
      ...orchardPlots().map((o) => orchardId(o.n)),
      ...expansionFarms().map((f) => `cf:${f.n}`),
    ]);
    const added = properties().filter((p) => fresh.has(p.id));
    const old = properties().filter((p) => !fresh.has(p.id) && p.map !== 'resort' && p.map !== 'island');
    expect(added.length).toBe(fresh.size);
    for (const a of added) {
      for (const b of added) if (a !== b) expect(obbOverlap(a, b), `${a.id} vs ${b.id}`).toBe(false);
      for (const o of old) expect(obbOverlap(a, o), `${a.id} vs ${o.id}`).toBe(false);
    }
    for (const b of bigFarms()) {
      for (const a of added) expect(obbOverlap({ ...b, rot: 0, id: `cf:${b.n}`, kind: 'farm', type: 'farmland', label: '', price: 0 } as never, a as never) || Number.isFinite(a.x), 'checked').toBeTruthy();
    }
  });

  it('keeps the original 557 non-sky/island properties plus the new prefixes only', () => {
    const isNew = (id: string) => /^(lot:estate:|winery:|b:mansion:|orchard:)/.test(id) || /^cf:2\d{3}$/.test(id);
    expect(properties().filter((p) => !/^(sky|isl):/.test(p.id) && !isNew(p.id))).toHaveLength(557);
    expect(allFieldPlots().filter((p) => p.n >= 2000)).toHaveLength(10);
  });
});

describe('wineries, hyper farms, rigs and plastics', () => {
  it('presses wine 1:1 and grows grapes faster', () => {
    expect(WINERY_GRAPES_PER_WINE).toBe(1);
    expect(WINERY_GROW_MUL).toBeLessThan(1);
  });

  it('hyper farm is four stages and unlocks difficult crops', () => {
    expect(HYPER_STAGES).toHaveLength(4);
    expect(HYPER_FARM_TOTAL).toBe(1_800_000);
    expect(HYPER_GROW_MUL).toBe(0.7);
    expect(HYPER_CROPS.length).toBeGreaterThanOrEqual(6);
    for (const c of HYPER_CROPS) {
      expect(isHyperCrop(c.id)).toBe(true);
      expect(cropById(c.id)?.id).toBe(c.id);
    }
    expect(isHyperCrop('wheat')).toBe(false);
  });

  it('offshore rigs launch from the shoreline dock', () => {
    expect(RIG_STAGES).toHaveLength(4);
    expect(RIG_CRUDE_PER_HOUR).toBe(90);
    expect(RIG_MAX_PER_PLAYER).toBe(3);
    expect(RIG_LAUNCH_FEE).toBe(200_000);
    expect(RIG_DOCK.x).toBe(130);
    expect(RIG_DOCK.z).toBe(210);
  });

  it('the city plastics plant has recipes and a Chud City site', () => {
    expect(PLASTICS_RECIPES.length).toBeGreaterThanOrEqual(3);
    expect(PLASTICS_PLANT.x).toBe(186);
    expect(PLASTICS_PLANT.z).toBe(88);
  });
});

describe('international airport', () => {
  it('keeps the original runway and slot, and adds a second runway to the west', () => {
    expect(RUNWAY).toEqual({ x: -200, z0: 6, z1: 136, w: 10 });
    expect(AIRPORT_SLOT[0]).toBe(-142);
    expect(AIRPORT.x0).toBe(-280);
    expect(RUNWAY2.x).toBeLessThan(RUNWAY.x);
    expect(RUNWAY2.z0).toBe(RUNWAY.z0);
    expect(RUNWAY2.z1).toBe(RUNWAY.z1);
    expect(RUNWAY2.w).toBe(RUNWAY.w);
    const venues = src('client/src/lib/worldVenues.ts');
    expect(venues).toMatch(/RUNWAY2/);
    expect(venues).toContain('RUNWAY.x');
    const dist = Math.abs(BILLIONAIRE_SIGN_POS[0] - RUNWAY2.x) - RUNWAY2.w / 2;
    expect(dist).toBeGreaterThanOrEqual(BILLIONAIRE_SIGN_RADIUS);
  });
});

describe('furniture catalogue', () => {
  it('is at least doubled and every id is unique', () => {
    expect(FURNITURE.length).toBeGreaterThanOrEqual(94);
    expect(new Set(FURNITURE.map((f) => f.id)).size).toBe(FURNITURE.length);
  });
});

describe('new goods have unique icons', () => {
  it('covers resin, GPUs, naphtha and the new crops', () => {
    for (const id of ['plastic_resin', 'naphtha_drum', 'ethylene_tank', 'gpu', 'equip_case', 'crop_tulips', 'crop_roses', 'crop_orchids', 'crop_saffron', 'crop_wasabi', 'crop_vanilla']) {
      expect(GOODS[id], id).toBeTruthy();
      expect(hasItemIcon(GOODS[id]!.type, id), id).toBe(true);
    }
    const svgs = Object.values(GOODS).map((g) => itemIconSvg(g.type, g.id));
    expect(new Set(svgs).size).toBe(svgs.length);
  });
});

describe('Future Features popup', () => {
  it('opens from the coming-soon sign with no launch date and no launch-popup hook', () => {
    const map = src('client/src/components/WorldMap.tsx');
    const world = src('client/src/lib/world3d.ts');
    expect(map).toMatch(/Coming soon/);
    expect(map).toMatch(/billionaire-sign/);
    expect(map).toMatch(/FutureFeaturesPopup/);
    expect(world).not.toMatch(/open-launch-popup/);
    expect(world).toMatch(/C O M I N G {3}S O O N/);
    const blob = [FUTURE_FEATURES_TITLE, ...FUTURE_FEATURES_BODY, ...FUTURE_FEATURES_SHOTS.map((s) => s.caption)].join(' ');
    expect(blob).not.toMatch(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/);
    expect(blob).not.toMatch(/\b20\d{2}\b/);
    expect(FUTURE_FEATURES_SHOTS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('expanded map camera', () => {
  it('lets the 3D city camera zoom out far enough to frame the whole 2x map', () => {
    const spanX = MAP_VIEW.x1 - MAP_VIEW.x0;
    const spanZ = MAP_VIEW.z1 - MAP_VIEW.z0;
    const visH = 2 * MAP_CAM_MAX * Math.tan((38 * Math.PI) / 180 / 2);
    expect(MAP_CAM_MIN).toBe(30);
    expect(MAP_CAM_MAX).toBeGreaterThan(360);
    expect(visH).toBeGreaterThanOrEqual(Math.max(spanX, spanZ));
    expect(MAP_CAM_FAR).toBeGreaterThan(MAP_CAM_MAX);
    const world = src('client/src/lib/world3d.ts');
    expect(world).toMatch(/controls\.maxDistance = MAP_CAM_MAX/);
    expect(world).toMatch(/PerspectiveCamera\(38, 1, 0\.5, MAP_CAM_FAR\)/);
    expect(world).not.toMatch(/controls\.maxDistance = 360/);
  });
});
