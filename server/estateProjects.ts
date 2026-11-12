/**
 * Private construction sites, digital industry, power, demolish, offshore rigs, hyper farms and the plastics plant.
 * Additive tables only. Player property rows are never deleted: demolish keeps the deed and opens a site on it.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import { playerKey } from './skins.js';
import { propertyById } from '../shared/realEstate.js';
import { getRealEstate } from './realEstate.js';
import {
  ESTATE_BUILDS, ESTATE_BUILD_ORDER, GEAR_FOR, GRID_POWER_DAY, GRID_SELL_FRACTION, PLANT_FUEL_DAY, PLANT_MW,
  SERVER_RACK, GPU_RIG, DIGITAL_DAILY_BASE, buildStageIndex, canDemolish, digitalPayout, emptySiteDone,
  estateProjectValue, estateStages, partKey, stageFull, stagePct, stageValue, throttle, DEMOLISH_RULES,
  type EstateBuildId, type EstateSiteKind, type EstateSiteState,
} from '../shared/estateProjects.js';
import { estateLotOf, RIG_BERTHS, wineryOf } from '../shared/mapExpansion.js';
import { HYPER_STAGES, HYPER_FARM_TOTAL } from '../shared/hyperFarm.js';
import { RIG_STAGES, RIG_LAUNCH_FEE, RIG_CRUDE_PER_HOUR, RIG_MAX_PER_PLAYER, RIG_HOLD_CAP, rigLabel, type RigState } from '../shared/offshoreRig.js';
import { FORT_IMPORT, PLASTICS_RECIPES, plantRecipe, type FortFeed } from '../shared/plasticsPlant.js';
import { GOODS } from '../shared/mines.js';
import { isHyperCrop } from '../shared/farm.js';

export class EstateError extends Error {}

export const ESTATE_MIGRATION = `
CREATE TABLE IF NOT EXISTS estate_sites (
  id TEXT PRIMARY KEY, lot_id TEXT NOT NULL, owner_key TEXT NOT NULL, owner_name TEXT NOT NULL, data JSONB NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS estate_sites_owner ON estate_sites (owner_key);
CREATE TABLE IF NOT EXISTS estate_players (
  player_key TEXT PRIMARY KEY, name TEXT NOT NULL, data JSONB NOT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS estate_rigs (
  id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, owner_name TEXT NOT NULL, data JSONB NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS estate_rigs_owner ON estate_rigs (owner_key);
`;

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };

type PlayerEco = {
  gridMw: number;
  digitalDay: string;
  digitalPaid: number;
  plantFuelUntil: number;
  hyper: Record<string, { stage: number; done: Array<Record<string, number>> }>;
};

const emptyEco = (): PlayerEco => ({ gridMw: 0, digitalDay: '', digitalPaid: 0, plantFuelUntil: 0, hyper: {} });
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10); // UTC day, same as other sinks

const isBuildId = (v: unknown): v is EstateBuildId => typeof v === 'string' && v in ESTATE_BUILDS;

export class Estate {
  private sites = new Map<string, EstateSiteState & { ownerName: string }>();
  private eco = new Map<string, PlayerEco>();
  private rigs = new Map<string, RigState>();
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}
  async init() {
    if (!this.pool) return;
    await this.pool.query(ESTATE_MIGRATION);
    for (const r of (await this.pool.query('SELECT * FROM estate_sites')).rows) {
      const d = r.data as EstateSiteState;
      this.sites.set(String(r.id), { ...d, ownerName: String(r.owner_name) });
    }
    for (const r of (await this.pool.query('SELECT * FROM estate_players')).rows) {
      this.eco.set(String(r.player_key), { ...emptyEco(), ...(r.data as PlayerEco) });
    }
    for (const r of (await this.pool.query('SELECT * FROM estate_rigs')).rows) {
      this.rigs.set(String(r.id), r.data as RigState);
    }
  }
  private ecoOf(name: string): PlayerEco {
    const k = playerKey(name);
    let e = this.eco.get(k);
    if (!e) { e = emptyEco(); this.eco.set(k, e); }
    const day = dayKey(this.clock());
    if (e.digitalDay !== day) { e.digitalDay = day; e.digitalPaid = 0; }
    return e;
  }
  private async saveSite(s: EstateSiteState & { ownerName: string }) {
    this.sites.set(s.id, s);
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO estate_sites (id, lot_id, owner_key, owner_name, data, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET lot_id = EXCLUDED.lot_id, owner_key = EXCLUDED.owner_key, owner_name = EXCLUDED.owner_name, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [s.id, s.lotId, playerKey(s.owner), s.ownerName, s, this.clock()],
    );
  }
  private async saveEco(name: string) {
    if (!this.pool) return;
    const k = playerKey(name);
    await this.pool.query(
      `INSERT INTO estate_players (player_key, name, data, updated_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (player_key) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [k, name.trim(), this.ecoOf(name), this.clock()],
    );
  }
  private async saveRig(r: RigState) {
    this.rigs.set(r.id, r);
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO estate_rigs (id, owner_key, owner_name, data, updated_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET owner_key = EXCLUDED.owner_key, owner_name = EXCLUDED.owner_name, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [r.id, playerKey(r.owner), r.owner, r, this.clock()],
    );
  }

  siteByLot(lotId: string) { return [...this.sites.values()].find((s) => s.lotId === lotId); }
  sitesOf(name: string) { return [...this.sites.values()].filter((s) => playerKey(s.owner) === playerKey(name)); }
  hyperOf(name: string, plotId: string) { return this.ecoOf(name).hyper[plotId] ?? null; }
  hyperComplete(name: string, plotId: string) { return (this.ecoOf(name).hyper[plotId]?.stage ?? 0) >= HYPER_STAGES.length; }

  private charge(name: string, amount: number, key: string, memo: string, game = 'estate') {
    if (amount <= 0) return;
    const bank = getBank();
    if (!bank.canAfford(name, amount)) throw new EstateError('Not enough chips.');
    try { bank.transferAtomic([{ name, amount: -amount, key, game, memo }]); }
    catch (e) { throw new EstateError(/Already/.test((e as Error).message) ? 'Already applied.' : 'Not enough chips.'); }
  }
  private pay(name: string, amount: number, key: string, memo: string, game = 'estate') {
    if (amount <= 0) return;
    try { getBank().transferAtomic([{ name, amount, key, game, memo }]); }
    catch (e) { if (!/Already/.test((e as Error).message)) throw e; }
  }

  /** Require a real-estate deed when the property service is up. Skipped only if it is not mounted (unit tests). */
  private async assertOwns(name: string, lotId: string) {
    const re = getRealEstate();
    if (!re) return;
    const owner = await re.ownerOf(lotId);
    if (!owner || playerKey(owner.name) !== playerKey(name)) throw new EstateError('You do not own that property.');
  }

  /** Open a construction site on land the player already owns (vacant lot or demolished structure). */
  async openSite(name: string, lotId: string, kind: EstateSiteKind, was?: { type: string; label: string }) {
    await this.assertOwns(name, lotId);
    const existing = this.siteByLot(lotId);
    if (existing) {
      if (playerKey(existing.owner) !== playerKey(name)) throw new EstateError('Someone else already has a site on that lot.');
      return existing;
    }
    const s: EstateSiteState & { ownerName: string } = {
      id: randomUUID(), lotId, owner: playerKey(name), ownerName: name.trim(), kind, build: null, stage: 0, done: [], gear: 0, settledAt: this.clock(), was,
    };
    await this.saveSite(s);
    return s;
  }

  async choose(name: string, lotId: string, build: unknown) {
    if (!isBuildId(build)) throw new EstateError('Pick a project to build.');
    const lot = propertyById(lotId) ?? estateLotOf(lotId);
    if (!lot && !this.siteByLot(lotId)) throw new EstateError('Unknown lot.');
    let site = this.siteByLot(lotId);
    if (!site) site = await this.openSite(name, lotId, propertyById(lotId)?.type === 'power_plant' ? 'turnkey_plant' : 'open');
    if (playerKey(site.owner) !== playerKey(name)) throw new EstateError('You do not own that site.');
    if (site.build && site.stage > 0) throw new EstateError('This site already has a project underway.');
    if (site.kind === 'turnkey_plant' && build !== 'power_plant') throw new EstateError('A turnkey plant can only be started as a power plant.');
    site.build = build;
    site.done = emptySiteDone(ESTATE_BUILDS[build]);
    site.stage = 0;
    if (site.kind === 'turnkey_plant') {
      // Already built: mark every stage complete. The purchase price was the deed.
      const plan = ESTATE_BUILDS[build];
      const stages = estateStages(plan);
      site.done = stages.map((st) => {
        const d: Record<string, number> = { chips: st.chips };
        for (const g of st.goods) d[partKey(g)] = g.qty;
        return d;
      });
      site.stage = stages.length;
    }
    await this.saveSite(site);
    return this.siteView(site);
  }

  async contribute(name: string, lotId: string, part: unknown, qtyRaw: unknown) {
    const site = this.siteByLot(lotId);
    if (!site || playerKey(site.owner) !== playerKey(name)) throw new EstateError('You do not own that site.');
    if (!site.build) throw new EstateError('Pick a project first.');
    const plan = ESTATE_BUILDS[site.build];
    const stages = estateStages(plan);
    const i = buildStageIndex(stages, site.done);
    if (i >= stages.length) throw new EstateError('This project is already finished.');
    const need = stages[i]!;
    const partS = String(part ?? '');
    const q = Number(qtyRaw);
    if (!Number.isInteger(q) || q < 1) throw new EstateError('Pick an amount.');
    const g = partS === 'chips' ? null : need.goods.find((x) => partKey(x) === partS);
    if (partS !== 'chips' && !g) throw new EstateError(`${need.name} does not need that.`);
    const row = site.done[i] ?? (site.done[i] = {});
    const left = (g ? g.qty : need.chips) - (row[partS === 'chips' ? 'chips' : partS] ?? 0);
    if (left <= 0) throw new EstateError('That part of this stage is already full.');
    const qty = Math.min(q, left);
    if (g) {
      // Goods are a v1 chip-equivalent buy at the site (house price, indexed) so a missing warehouse hook cannot soft-lock the build.
      // If the player has the goods, a later hook can waive this; the listed materials still define the stage.
      const price = px(g.price * qty);
      this.charge(name, price, `estate_mat:${site.id}:${i}:${partS}:${row[partS] ?? 0}:${qty}`, `${plan.icon} ${plan.name}: ${qty} ${g.name}`);
      row[partS] = (row[partS] ?? 0) + qty;
    } else {
      const price = px(qty);
      this.charge(name, price, `estate_chip:${site.id}:${i}:${row.chips ?? 0}:${qty}`, `${plan.icon} ${plan.name}: chips for ${need.name}`);
      row.chips = (row.chips ?? 0) + qty;
    }
    if (stageFull(need, row)) site.stage = i + 1;
    await this.saveSite(site);
    return this.siteView(site);
  }

  async buyGear(name: string, lotId: string, qtyRaw: unknown) {
    const site = this.siteByLot(lotId);
    if (!site || playerKey(site.owner) !== playerKey(name)) throw new EstateError('You do not own that site.');
    if (!site.build || (site.build !== 'data_center' && site.build !== 'bitcoin_farm')) throw new EstateError('Only a finished data center or bitcoin farm takes hardware.');
    if (site.stage < ESTATE_BUILDS[site.build].stages.length) throw new EstateError('Finish construction first.');
    const def = GEAR_FOR[site.build];
    const q = Number(qtyRaw);
    if (!Number.isInteger(q) || q < 1) throw new EstateError('Pick how many to install.');
    if (site.gear + q > def.max) throw new EstateError(`You can install at most ${def.max}.`);
    const price = px(def.price * q);
    this.charge(name, price, `estate_gear:${site.id}:${site.gear}:${q}`, `Installed ${q} × ${def.name}`);
    site.gear += q;
    await this.saveSite(site);
    return this.siteView(site);
  }

  async setGrid(name: string, mwRaw: unknown) {
    const mw = Number(mwRaw);
    if (!Number.isFinite(mw) || mw < 0 || mw > 400) throw new EstateError('Pick a utility contract between 0 and 400 MW.');
    this.ecoOf(name).gridMw = Math.round(mw * 10) / 10;
    await this.saveEco(name);
    return this.powerView(name);
  }

  async demolish(name: string, propertyId: string, confirm: unknown) {
    if (confirm !== true && confirm !== 'DEMOLISH') throw new EstateError('Confirm demolish to continue.');
    const p = propertyById(propertyId);
    const gate = canDemolish(p);
    if (!gate.ok) throw new EstateError(gate.reason ?? 'That structure cannot be demolished.');
    const re = getRealEstate();
    if (re) {
      const owner = await re.ownerOf(propertyId);
      if (!owner || playerKey(owner.name) !== playerKey(name)) throw new EstateError('You do not own that property.');
    }
    const site = await this.openSite(name, propertyId, 'demolished', p ? { type: p.type, label: p.label } : undefined);
    return { site: this.siteView(site), rules: DEMOLISH_RULES };
  }

  async startHyper(name: string, plotId: string) {
    if (typeof plotId !== 'string' || !/^(f:|cf:|winery:)/.test(plotId)) throw new EstateError('Pick one of your farms.');
    await this.assertOwns(name, plotId);
    const e = this.ecoOf(name);
    if (!e.hyper[plotId]) e.hyper[plotId] = { stage: 0, done: HYPER_STAGES.map(() => ({})) };
    await this.saveEco(name);
    return this.hyperView(name, plotId);
  }
  async contributeHyper(name: string, plotId: string, part: unknown, qtyRaw: unknown) {
    await this.assertOwns(name, plotId);
    const e = this.ecoOf(name);
    const h = e.hyper[plotId];
    if (!h) throw new EstateError('Start the glasshouse conversion first.');
    if (h.stage >= HYPER_STAGES.length) throw new EstateError('This glasshouse is already finished.');
    const st = HYPER_STAGES[h.stage]!;
    const partS = String(part ?? '');
    const q = Number(qtyRaw);
    if (!Number.isInteger(q) || q < 1) throw new EstateError('Pick an amount.');
    const g = partS === 'chips' ? null : st.goods.find(([id]) => `good:${id}` === partS || id === partS);
    const row = h.done[h.stage] ?? (h.done[h.stage] = {});
    if (g) {
      const [id, need] = g;
      const left = need - (row[`good:${id}`] ?? 0);
      if (left <= 0) throw new EstateError('That part is already full.');
      const qty = Math.min(q, left);
      const price = px((GOODS[id]?.price ?? 0) * qty);
      this.charge(name, price, `hyper_mat:${plotId}:${h.stage}:${id}:${row[`good:${id}`] ?? 0}:${qty}`, `Hyper farm: ${qty} ${GOODS[id]?.name ?? id}`);
      row[`good:${id}`] = (row[`good:${id}`] ?? 0) + qty;
      if (st.goods.every(([gid, n]) => (row[`good:${gid}`] ?? 0) >= n) && (row.chips ?? 0) >= st.chips) h.stage += 1;
    } else if (partS === 'chips') {
      const left = st.chips - (row.chips ?? 0);
      if (left <= 0) throw new EstateError('That part is already full.');
      const qty = Math.min(q, left);
      this.charge(name, px(qty), `hyper_chip:${plotId}:${h.stage}:${row.chips ?? 0}:${qty}`, `Hyper farm: chips for ${st.name}`);
      row.chips = (row.chips ?? 0) + qty;
      if (st.goods.every(([gid, n]) => (row[`good:${gid}`] ?? 0) >= n) && (row.chips ?? 0) >= st.chips) h.stage += 1;
    } else throw new EstateError('That is not needed for this stage.');
    await this.saveEco(name);
    return this.hyperView(name, plotId);
  }

  async startRig(name: string) {
    const mine = [...this.rigs.values()].filter((r) => playerKey(r.owner) === playerKey(name));
    if (mine.length >= RIG_MAX_PER_PLAYER) throw new EstateError(`You can have at most ${RIG_MAX_PER_PLAYER} rigs.`);
    const r: RigState = { id: randomUUID(), owner: name.trim(), stage: 0, done: RIG_STAGES.map(() => ({})), status: 'building', hold: 0, settledAt: this.clock() };
    await this.saveRig(r);
    return this.rigView(r);
  }
  async contributeRig(name: string, id: string, part: unknown, qtyRaw: unknown) {
    const r = this.rigs.get(id);
    if (!r || playerKey(r.owner) !== playerKey(name)) throw new EstateError('You do not own that rig.');
    if (r.status !== 'building') throw new EstateError('This rig is no longer under construction.');
    const st = RIG_STAGES[r.stage]!;
    const partS = String(part ?? '');
    const q = Number(qtyRaw);
    if (!Number.isInteger(q) || q < 1) throw new EstateError('Pick an amount.');
    const row = r.done[r.stage] ?? (r.done[r.stage] = {});
    const g = partS === 'chips' ? null : st.goods.find(([gid]) => gid === partS || `good:${gid}` === partS);
    if (g) {
      const [gid, need] = g;
      const left = need - (row[`good:${gid}`] ?? 0);
      if (left <= 0) throw new EstateError('That part is already full.');
      const qty = Math.min(q, left);
      this.charge(name, px((GOODS[gid]?.price ?? 0) * qty), `rig_mat:${r.id}:${r.stage}:${gid}:${row[`good:${gid}`] ?? 0}:${qty}`, `Rig: ${qty} ${GOODS[gid]?.name ?? gid}`);
      row[`good:${gid}`] = (row[`good:${gid}`] ?? 0) + qty;
    } else if (partS === 'chips') {
      const left = st.chips - (row.chips ?? 0);
      if (left <= 0) throw new EstateError('That part is already full.');
      const qty = Math.min(q, left);
      this.charge(name, px(qty), `rig_chip:${r.id}:${r.stage}:${row.chips ?? 0}:${qty}`, `Rig: chips for ${st.name}`);
      row.chips = (row.chips ?? 0) + qty;
    } else throw new EstateError('That is not needed for this stage.');
    const full = (row.chips ?? 0) >= st.chips && st.goods.every(([gid, n]) => (row[`good:${gid}`] ?? 0) >= n);
    if (full) { r.stage += 1; if (r.stage >= RIG_STAGES.length) r.status = 'ready'; }
    await this.saveRig(r);
    return this.rigView(r);
  }
  async launchRig(name: string, id: string) {
    const r = this.rigs.get(id);
    if (!r || playerKey(r.owner) !== playerKey(name)) throw new EstateError('You do not own that rig.');
    if (r.status !== 'ready') throw new EstateError('Finish the rig before you launch it.');
    this.charge(name, px(RIG_LAUNCH_FEE), `rig_launch:${r.id}`, 'Launch offshore drilling rig');
    const used = new Set([...this.rigs.values()].filter((x) => x.status === 'launched' && x.berth != null).map((x) => x.berth));
    const berth = RIG_BERTHS.findIndex((_, i) => !used.has(i));
    r.berth = berth >= 0 ? berth : 0;
    r.status = 'launched';
    r.settledAt = this.clock();
    await this.saveRig(r);
    return this.rigView(r);
  }

  /** Settle digital income, grid bills and rig crude since last tick. */
  async tick(name: string, creditCrude?: (owner: string, qty: number) => Promise<number>) {
    const now = this.clock();
    const e = this.ecoOf(name);
    const mine = this.sitesOf(name);
    let demand = 0; let plantMw = 0;
    const running: Array<{ site: typeof mine[number]; def: typeof SERVER_RACK; hours: number }> = [];
    for (const s of mine) {
      const hours = Math.max(0, Math.min(24, (now - s.settledAt) / 3_600_000));
      if (s.build === 'power_plant' && s.stage >= ESTATE_BUILDS.power_plant.stages.length) plantMw += PLANT_MW;
      if ((s.build === 'data_center' || s.build === 'bitcoin_farm') && s.stage >= ESTATE_BUILDS[s.build].stages.length && s.gear > 0) {
        const def = GEAR_FOR[s.build];
        demand += def.mw * s.gear;
        running.push({ site: s, def, hours });
      }
      s.settledAt = now;
    }
    const fuelOn = e.plantFuelUntil > now || plantMw === 0;
    const plantLive = plantMw > 0 && (e.plantFuelUntil > now);
    // If a plant exists and fuel has lapsed, bill a day of fuel when the owner can pay.
    if (plantMw > 0 && e.plantFuelUntil <= now) {
      const fuel = px(PLANT_FUEL_DAY);
      const bank = getBank();
      if (bank.canAfford(name, fuel)) {
        this.charge(name, fuel, `estate_fuel:${e.digitalDay}:${playerKey(name)}`, 'Power plant daily fuel contract');
        e.plantFuelUntil = now + 86_400_000;
      }
    }
    const supply = e.gridMw + (e.plantFuelUntil > now ? plantMw : 0);
    const th = throttle(supply, demand);
    let gross = 0;
    for (const r of running) gross += r.def.chipsPerHour * r.site.gear * r.hours * th;
    const cap = px(DIGITAL_DAILY_BASE);
    const paid = digitalPayout(px(gross), e.digitalPaid, cap);
    if (paid > 0) {
      this.pay(name, paid, `estate_digital:${e.digitalDay}:${e.digitalPaid}:${paid}`, 'Data center / bitcoin farm income');
      e.digitalPaid += paid;
    }
    // Grid contract bill, prorated, minus sold surplus.
    const hours = running[0]?.hours ?? Math.max(0, Math.min(24, 1 / 60));
    const usedGrid = Math.max(0, demand * th - (e.plantFuelUntil > now ? plantMw : 0));
    const bill = px(GRID_POWER_DAY * (e.gridMw > 0 ? Math.min(e.gridMw, usedGrid) : 0) * (hours / 24));
    if (bill > 0) {
      const bank = getBank();
      if (bank.canAfford(name, bill)) this.charge(name, bill, `estate_grid:${e.digitalDay}:${Math.floor(now / 60_000)}`, 'Utility power contract');
    } else {
      const surplus = Math.max(0, (e.plantFuelUntil > now ? plantMw : 0) - demand);
      const credit = px(GRID_POWER_DAY * GRID_SELL_FRACTION * surplus * (hours / 24));
      if (credit > 0) this.pay(name, credit, `estate_gridsell:${e.digitalDay}:${Math.floor(now / 60_000)}`, 'Sold surplus power to the grid');
    }
    for (const s of mine) await this.saveSite(s);
    // Rigs
    let crude = 0;
    for (const r of this.rigs.values()) {
      if (playerKey(r.owner) !== playerKey(name) || r.status !== 'launched') continue;
      const hrs = Math.max(0, Math.min(24, (now - r.settledAt) / 3_600_000));
      const make = RIG_CRUDE_PER_HOUR * hrs;
      r.hold = Math.min(RIG_HOLD_CAP, r.hold + make);
      r.settledAt = now;
      if (creditCrude && r.hold >= 1) {
        const sent = await creditCrude(name, Math.floor(r.hold));
        r.hold -= sent;
        crude += sent;
      }
      await this.saveRig(r);
    }
    await this.saveEco(name);
    return { paid, throttle: th, supply, demand, crude, plantLive: e.plantFuelUntil > now, fuelOn };
  }

  siteView(s: EstateSiteState) {
    const plan = s.build ? ESTATE_BUILDS[s.build] : null;
    const stages = plan ? estateStages(plan).map((st, i) => ({ ...st, done: s.done[i] ?? {}, pct: stagePct(st, s.done[i] ?? {}) })) : [];
    const complete = !!plan && s.stage >= (plan.stages.length);
    const gear = (s.build === 'data_center' || s.build === 'bitcoin_farm') ? GEAR_FOR[s.build] : null;
    return {
      id: s.id, lotId: s.lotId, kind: s.kind, build: s.build, stage: s.stage, complete, gear: s.gear, was: s.was, launched: s.launched,
      plan: plan && { id: plan.id, name: plan.name, icon: plan.icon, blurb: plan.blurb, total: estateProjectValue(plan), w: plan.w, d: plan.d, h: plan.h },
      stages, gearDef: gear && { ...gear, price: px(gear.price) },
    };
  }
  hyperView(name: string, plotId: string) {
    const h = this.ecoOf(name).hyper[plotId] ?? { stage: 0, done: [] };
    return { plotId, stage: h.stage, complete: h.stage >= HYPER_STAGES.length, total: HYPER_FARM_TOTAL, stages: HYPER_STAGES.map((st, i) => ({ ...st, done: h.done[i] ?? {} })) };
  }
  rigView(r: RigState) {
    return { ...r, label: rigLabel(r), launchFee: px(RIG_LAUNCH_FEE), berthAt: r.berth != null ? RIG_BERTHS[r.berth] : null, stages: RIG_STAGES };
  }
  powerView(name: string) {
    const e = this.ecoOf(name);
    const mine = this.sitesOf(name);
    let demand = 0, plantMw = 0;
    for (const s of mine) {
      if (s.build === 'power_plant' && s.stage >= 4) plantMw += PLANT_MW;
      if ((s.build === 'data_center' || s.build === 'bitcoin_farm') && s.stage >= 4) {
        const def = GEAR_FOR[s.build]; demand += def.mw * s.gear;
      }
    }
    const supply = e.gridMw + (e.plantFuelUntil > this.clock() ? plantMw : 0);
    return { gridMw: e.gridMw, gridPrice: px(GRID_POWER_DAY), plantMw, demand, supply, throttle: throttle(supply, demand), fuelUntil: e.plantFuelUntil, fuelDay: px(PLANT_FUEL_DAY), cap: px(DIGITAL_DAILY_BASE), paidToday: e.digitalPaid };
  }
  knownPlayers(): string[] { return [...new Set([...this.sites.values()].map((s) => s.owner).concat([...this.rigs.values()].map((r) => r.owner), ...this.eco.keys()))]; }
  async view(name: string | null) {
    const builds = ESTATE_BUILD_ORDER.map((id) => { const p = ESTATE_BUILDS[id]; return { id, name: p.name, icon: p.icon, blurb: p.blurb, total: estateProjectValue(p), stages: estateStages(p).map((s) => ({ id: s.id, name: s.name, chips: s.chips, goods: s.goods })), w: p.w, d: p.d, h: p.h }; });
    if (!name) return { signedIn: false, builds, rules: DEMOLISH_RULES };
    return {
      signedIn: true, builds, rules: DEMOLISH_RULES,
      sites: this.sitesOf(name).map((s) => this.siteView(s)),
      power: this.powerView(name),
      rigs: [...this.rigs.values()].filter((r) => playerKey(r.owner) === playerKey(name)).map((r) => this.rigView(r)),
      hyper: Object.keys(this.ecoOf(name).hyper).map((id) => this.hyperView(name, id)),
      chips: getBank().ready ? getBank().account(name).chips : null,
      canPlantHyper: (crop: unknown, plotId: string) => !isHyperCrop(crop) || this.hyperComplete(name, plotId),
    };
  }

  async craftPlastic(name: string, recipeId: unknown, qtyRaw: unknown) {
    const rec = plantRecipe(recipeId); if (!rec) throw new EstateError('Unknown recipe.');
    const q = Number(qtyRaw); if (!Number.isInteger(q) || q < 1 || q > 100) throw new EstateError('Pick an amount between 1 and 100.');
    let cost = 0;
    for (const [id, n] of rec.in) {
      const g = GOODS[id]; if (!g) throw new EstateError('That recipe is missing an input.');
      cost += g.price * n * q;
    }
    this.charge(name, px(cost), `plastics:${rec.id}:${this.clock()}:${q}`, `Plastics plant: ${q} × ${rec.name}`);
    // Outputs are credited as a chip-sink craft in v1 when warehouse hookup is offline; the recipe is recorded for the client.
    return { recipe: rec.id, qty: q, paid: px(cost), out: rec.out, outQty: rec.out[1] * q };
  }
  async importFort(name: string, feed: unknown, qtyRaw: unknown, take?: (owner: string, product: string, qty: number) => Promise<number>) {
    if (!(feed === 'naphtha' || feed === 'ethylene' || feed === 'plastic')) throw new EstateError('Pick naphtha, ethylene or plastics.');
    const q = Number(qtyRaw); if (!Number.isInteger(q) || q < 1) throw new EstateError('Pick an amount.');
    const got = take ? await take(name, feed, q) : 0;
    if (got < 1) throw new EstateError('No Fort McChud stock to import. Ship it from your tanks first.');
    const conv = FORT_IMPORT[feed as FortFeed];
    return { feed, took: got, good: conv.good, qty: got * conv.qty };
  }


  async pressWine(name: string, qtyRaw: unknown) {
    const mine = (await getRealEstate()?.owned() ?? []).filter((o) => playerKey(o.owner) === playerKey(name) && o.id.startsWith('winery:'));
    if (!mine.length) throw new EstateError('You need to own a winery to use the press.');
    const q = Number(qtyRaw);
    if (!Number.isInteger(q) || q < 1 || q > 500) throw new EstateError('Pick an amount between 1 and 500.');
    // v1: the press is 1 grape → 1 wine (cannery is 2:1). Inventory hookup is done when warehouse take/give is passed in.
    return { grapes: q, wine: q, rate: 1, at: mine[0]!.id };
  }

    /** Public map snapshot (construction models + launched rigs). */
  mapSummary() {
    return {
      sites: [...this.sites.values()].map((s) => ({ lotId: s.lotId, build: s.build, stage: s.stage, complete: !!s.build && s.stage >= ESTATE_BUILDS[s.build]!.stages.length, gear: s.gear, kind: s.kind })),
      rigs: [...this.rigs.values()].filter((r) => r.status === 'launched').map((r) => ({ id: r.id, berth: r.berth, at: r.berth != null ? RIG_BERTHS[r.berth] : null })),
      hyper: [...this.eco.values()].flatMap((e) => Object.entries(e.hyper).filter(([, h]) => h.stage > 0).map(([plotId, h]) => ({ plotId, stage: h.stage, complete: h.stage >= HYPER_STAGES.length }))),
    };
  }
}

let estate: Estate | null = null;
export const getEstate = () => estate;
export function setEstate(e: Estate | null) { estate = e; }
export async function initEstate(): Promise<void> {
  const url = databaseUrl();
  if (!url) { setEstate(new Estate(null)); setBootState('estate', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[estate] pool error:', e.message));
  await bootAttach('estate', async () => {
    try { const e = new Estate(pool as unknown as PoolLike); await e.init(); setEstate(e); console.log('[estate] ready'); return true; }
    catch (err) { console.error('[estate] init failed:', (err as Error).message); return false; }
  });
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerEstate(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new EstateError('Sign in first.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>, e: Estate) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try {
      if (!estate) throw new EstateError('Opening up. Try again in a moment.');
      const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      ack?.({ ok: true, ...((await fn(b, estate)) as object ?? {}) });
    } catch (err) {
      const msg = (err as Error).message;
      ack?.({ ok: false, error: err instanceof EstateError || /Not enough chips|Wallet temporarily unavailable/.test(msg) ? msg : 'Something went wrong.' });
    }
  });
  on('estate_view', async (_b, e) => {
    const n = nameOf();
    if (n) {
      try {
        const { getFortMc } = await import('./fortmc.js');
        const f = getFortMc();
        await e.tick(n, f ? (owner, qty) => f.creditStock(owner, 'crude', qty) : undefined);
      } catch { /* tick is best-effort */ }
    }
    return e.view(n);
  });
  on('estate_wine_press', async (b, e) => e.pressWine(need(), b.qty));
  on('estate_choose', async (b, e) => e.choose(need(), String(b.lotId ?? ''), b.build));
  on('estate_contribute', async (b, e) => e.contribute(need(), String(b.lotId ?? ''), b.part, b.qty));
  on('estate_gear', async (b, e) => e.buyGear(need(), String(b.lotId ?? ''), b.qty));
  on('estate_grid', async (b, e) => e.setGrid(need(), b.mw));
  on('estate_demolish', async (b, e) => e.demolish(need(), String(b.id ?? ''), b.confirm));
  on('estate_hyper_start', async (b, e) => e.startHyper(need(), String(b.plotId ?? '')));
  on('estate_hyper_contribute', async (b, e) => e.contributeHyper(need(), String(b.plotId ?? ''), b.part, b.qty));
  on('estate_rig_start', async (_b, e) => e.startRig(need()));
  on('estate_rig_contribute', async (b, e) => e.contributeRig(need(), String(b.id ?? ''), b.part, b.qty));
  on('estate_rig_launch', async (b, e) => e.launchRig(need(), String(b.id ?? '')));
  on('plastics_craft', async (b, e) => e.craftPlastic(need(), b.recipe, b.qty));
  on('plastics_recipes', async () => ({ recipes: PLASTICS_RECIPES }));
}

