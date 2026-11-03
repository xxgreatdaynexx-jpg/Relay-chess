/** House-sell room (pt1411u): each player's daily house-sell cap status. Read-only, never moves chips. */
import express from 'express';
import { getMines } from './mines.js';
import { sinkLostToday, sinkKeysToday } from './sink-room.js';
import { priceIndex } from './price-index.js';
import { playerKey } from './skins.js';
import { dayKey, houseCapChips, houseCapBase } from '../shared/mines.js';
import { houseCapIndex } from './house-cap-index.js';
import { effectiveAlready } from '../shared/sinkRoom.js';

export type HouseRoom = { cap: number; soldToday: number; refunded: number; left: number; index: number; day: string };

/** All figures in chips (today's price index). soldToday is the house gross sold today. */
export function houseRoom(name: string, now = Date.now()): HouseRoom {
  const idx = priceIndex(); const day = dayKey(now);
  const d = getMines().daily.get(playerKey(name)); const already = d && d.day === day ? d.gross : 0;
  const lost = sinkLostToday(name, now); const eff = effectiveAlready(already, lost, idx);
  const capIdx = houseCapIndex(); const capBase = houseCapBase(capIdx, idx);
  return { cap: houseCapChips(capIdx), soldToday: Math.floor(already * idx), refunded: Math.floor(lost), left: Math.max(0, Math.floor((capBase - eff) * idx)), index: idx, day };
}

/** Every player with house sales or refunded room today. */
export function allHouseRooms(now = Date.now()) {
  const day = dayKey(now); const keys = new Set<string>(sinkKeysToday(now));
  for (const [k, d] of getMines().daily) if (d.day === day && d.gross > 0) keys.add(k);
  return [...keys].map((k) => ({ player: k, ...houseRoom(k, now) })).filter((r) => r.soldToday > 0 || r.refunded > 0).sort((a, b) => b.soldToday - a.soldToday);
}

/** GET /api/house-room — public list (same figures every profile shows). */
export function houseRoomRouter() {
  const r = express.Router();
  r.get('/api/house-room', (_req, res) => { res.set('Cache-Control', 'no-store'); const now = Date.now(); res.json({ ok: true, at: now, players: allHouseRooms(now) }); });
  return r;
}
