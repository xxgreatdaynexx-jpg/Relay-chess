/**
 * Item icon registry: one crafted 24x24 SVG per resource item (ores, gems, bars, factory goods, crops, fish, food).
 * Pure presentation — never touches prices, odds or recipes. Unknown ids get a tinted crate fallback.
 * Use itemIconUri(type, id) for <img src>, or ItemIcon (client/src/components/ItemIcon.tsx) in React.
 */
import { GOODS, ORES, isOre } from './mines.js';

const OL = '#1b1510';
type RGB = [number, number, number];
const rgb = (h: string): RGB => { const s = h.replace('#', ''); const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0) as RGB; };
const hex = (c: RGB) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** amt > 0 lightens toward white, < 0 darkens toward black. */
export const shade = (h: string, amt: number) => { const c = rgb(h); return hex(c.map((v) => (amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))) as RGB); };
const L = (h: string) => shade(h, 0.38), D = (h: string) => shade(h, -0.35);
// `extra` may carry its own stroke-width; never emit it twice (a duplicate attribute is invalid XML and the <img> shows broken).
const P = (pts: string, fill: string, extra = '') => `<polygon points="${pts}" fill="${fill}" stroke="${OL}"${/stroke-width=/.test(extra) ? '' : ' stroke-width="1.1"'} stroke-linejoin="round"${extra}/>`;
const Pn = (pts: string, fill: string, op = 1) => `<polygon points="${pts}" fill="${fill}" opacity="${op}"/>`;
const C = (cx: number, cy: number, r: number, fill: string, sw = 1.1) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${OL}" stroke-width="${sw}"/>`;
const E = (cx: number, cy: number, rx: number, ry: number, fill: string, sw = 1.1) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${OL}" stroke-width="${sw}"/>`;
const R = (x: number, y: number, w: number, h: number, fill: string, rx = 1, sw = 1.1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${OL}" stroke-width="${sw}"/>`;
const Pa = (d: string, fill: string, sw = 1.1) => `<path d="${d}" fill="${fill}" stroke="${OL}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
const Ln = (d: string, col: string, w = 1.2) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const glint = (x: number, y: number, s = 1) => `<path d="M${x} ${y - 2 * s}L${x + 0.6 * s} ${y - 0.6 * s}L${x + 2 * s} ${y}L${x + 0.6 * s} ${y + 0.6 * s}L${x} ${y + 2 * s}L${x - 0.6 * s} ${y + 0.6 * s}L${x - 2 * s} ${y}L${x - 0.6 * s} ${y - 0.6 * s}Z" fill="#fff" opacity=".9"/>`;

// ---------------------------------------------------------------- shape templates
const rock = (body: string, nug?: string) => {
  let s = P('3,15 5,8 11,4 18,6 21,12 19,18 10,20', body) + Pn('5,8 11,4 18,6 13,9', L(body), 0.85) + Pn('18,6 21,12 19,18 14,12', D(body), 0.8);
  if (nug) s += P('7,11 10,9.5 11,12 8.5,13.5', nug, ' stroke-width="0.8"') + P('13,13 16.5,12 17,15.5 13.5,16.5', nug, ' stroke-width="0.8"') + P('9,16 11,15 11.8,17.5 9.5,18', nug, ' stroke-width="0.8"') + Pn('7,11 10,9.5 9.5,11', L(nug)) + Pn('13,13 16.5,12 15,13.5', L(nug));
  return s;
};
const coal = (c: string) => P('3,15 6,7 12,4 19,7 21,14 16,20 8,19', c) + Pn('6,7 12,4 13,10 7,12', '#55565c', 0.9) + Pn('13,10 19,7 21,14', '#3a3b40', 0.9) + Pn('8,19 7,12 13,10 16,20', '#18181b') + glint(10, 8, 0.9) + glint(17, 11, 0.6);
const crystals = (c: string) => P('8,21 5,11 8,5 11,11 11,21', c) + Pn('8,5 11,11 11,21 8,21', D(c), 0.6) + P('13,21 12,9 16,3 20,9 19,21', L(c)) + Pn('16,3 20,9 19,21 16,21', c, 0.7) + P('3,21 3,15 5,13 7,15 7,21', D(c)) + glint(14.5, 8, 0.9);
const diamond = (c: string) => P('4,9 8,4 16,4 20,9 12,21', c) + Pn('4,9 20,9 12,21', D(c), 0.45) + Ln('M8 4L10 9L12 4L14 9L16 4M10 9L12 21L14 9', OL, 0.7) + Pn('8,4 10,9 4,9', L(c)) + glint(17, 6, 1.1);
const ingot = (c: string) => P('8,7 19,7 17,11 6,11', L(c)) + P('6,11 17,11 18,17 3,17', c) + P('17,11 19,7 21,13 18,17', D(c)) + Ln('M9 8.5L13 8.5', '#fff', 1) + Ln('M5 15L9 15', '#fff', 0.7);
const brick = (c: string) => P('3,9 13,6 21,9 11,12', L(c)) + P('3,9 11,12 11,19 3,16', c) + P('11,12 21,9 21,16 11,19', D(c)) + Ln('M3 12.5L11 15.5L21 12.5M7 10.7L7 17.5M16 10.5L16 17.5', shade(c, -0.55), 0.7);
const pane = (c: string) => P('5,4 18,4 18,20 5,20', c, ' fill-opacity=".75"') + Ln('M8 7L11 7M8 9L9.5 9', '#fff', 1.1) + Ln('M15 17L12 14', '#fff', 0.9) + P('18,4 20,6 20,22 18,20', D(c));
const plate = (c: string, rivets = true) => P('2,12 12,7 22,12 12,17', L(c)) + P('2,12 12,17 12,19 2,14', c) + P('12,17 22,12 22,14 12,19', D(c)) + (rivets ? C(7, 12, 0.8, D(c), 0.5) + C(17, 12, 0.8, D(c), 0.5) + C(12, 9.5, 0.8, D(c), 0.5) + C(12, 14.5, 0.8, D(c), 0.5) : Ln('M6 11L12 8.2', '#fff', 0.8));
const coins = (c: string) => E(12, 17, 8, 3.5, D(c)) + E(12, 15, 8, 3.5, c) + E(12, 12, 8, 3.5, D(c)) + E(12, 10, 8, 3.5, c) + E(12, 10, 5, 2, L(c), 0.6) + glint(16, 8, 0.7);
const ring = (c: string, gem: string) => `<ellipse cx="12" cy="14" rx="7.5" ry="6" fill="none" stroke="${OL}" stroke-width="4.2"/><ellipse cx="12" cy="14" rx="7.5" ry="6" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M6.5 11.5A7.5 6 0 0 1 9 8.6" fill="none" stroke="#fff" stroke-width="1" opacity=".8"/>` + P('9,7 12,3 15,7 12,9', gem) + glint(13, 5, 0.6);
const coil = (c: string) => E(12, 18, 8, 3, D(c)) + E(12, 15, 8, 3, c) + E(12, 12, 8, 3, D(c)) + E(12, 9, 8, 3, c) + E(12, 9, 3, 1, '#2a2018', 0.6) + Ln('M20 9L22 4', c, 2) + Ln('M6 8.4L10 6.6', L(c), 0.9);
function gearPath(cx: number, cy: number, ro: number, ri: number, n: number) { let d = ''; for (let i = 0; i < n * 4; i++) { const a = (i / (n * 4)) * Math.PI * 2 - Math.PI / 2; const r = i % 4 < 2 ? ro : ri; d += (i ? 'L' : 'M') + (cx + Math.cos(a) * r).toFixed(2) + ' ' + (cy + Math.sin(a) * r).toFixed(2); } return d + 'Z'; }
const gear = (c: string) => Pa(gearPath(12, 12, 10, 7.6, 8), c) + C(12, 12, 4.8, L(c), 0.8) + C(12, 12, 2.2, '#2a2420') + Ln('M7 8A6 6 0 0 1 11 6', '#fff', 0.8);
const rods = (c: string) => [0, 4, 8].map((o) => Pa(`M${3 + o} ${17 - o * 0.3}L${15 + o} ${7 - o * 0.3}L${16.6 + o} ${8.8 - o * 0.3}L${4.6 + o} ${18.8 - o * 0.3}Z`, o === 4 ? L(c) : c, 0.9)).join('');
const screw = (c: string) => Pa('M10 9L14 9L14 19L12 22L10 19Z', c) + Ln('M10 11L14 12M10 13.5L14 14.5M10 16L14 17M10 18.5L13.5 19.5', D(c), 0.8) + E(12, 7, 6, 2.6, L(c)) + Pa('M6 7L6 8.6A6 2.6 0 0 0 18 8.6L18 7', c, 0.9) + Ln('M9.5 7L14.5 7', '#2a2420', 1.2);
const pipe = (c: string) => Pa('M5 7L17 7A3.5 6 0 0 1 17 19L5 19Z', c) + E(5, 13, 3.5, 6, D(c)) + E(5, 13, 2, 3.8, '#1a1612', 0.6) + Ln('M7 9L16 9', L(c), 1.2) + R(10, 6.2, 2, 13.6, D(c), 0.4, 0.7);
const frame = (c: string) => Pa('M4 7L20 7L20 19L4 19Z', 'none') + Ln('M4 7L20 7L20 19L4 19Z', OL, 4) + Ln('M4 7L20 7L20 19L4 19Z', c, 2.4) + Ln('M4 7L20 19M20 7L4 19', OL, 3.2) + Ln('M4 7L20 19M20 7L4 19', D(c), 1.8) + [[4, 7], [20, 7], [20, 19], [4, 19]].map(([x, y]) => C(x, y, 1.3, L(c), 0.6)).join('');
const circuit = (c: string) => R(2.5, 5, 19, 14, c, 1.5) + Ln('M5 8L9 8L9 11M5 16L8 16L8 13M19 8L15 8M19 16L16 13M12 5.5L12 8', '#e8d38a', 0.9) + R(9, 9, 6, 6, '#22262b', 0.6, 0.8) + C(5, 8, 0.8, '#e8d38a', 0.4) + C(19, 16, 0.8, '#e8d38a', 0.4) + Ln('M10.5 10.5L13.5 10.5', '#667', 0.6);
const lens = (c: string) => C(12, 12, 8.5, '#4a5560', 1.2) + C(12, 12, 6.8, c, 0.8) + `<circle cx="12" cy="12" r="6.8" fill="#fff" opacity=".15"/>` + Ln('M8.5 10A4.5 4.5 0 0 1 11 7.6', '#fff', 1.3) + glint(15, 14, 0.6);
const leaf = (c: string) => Pa('M4 6L18 4L20 18L6 20Z', c) + Pa('M4 6L18 4L20 18L6 20Z', 'none', 0) + Ln('M7 8L14 7M8 12L16 11M9 16L13 15.5', L(c), 0.9) + Pa('M16 4.3L18 4L20 18L18.4 18.3Z', D(c), 0.6);
const chain = (c: string) => [[6, 15], [10.5, 11], [15, 7]].map(([x, y], i) => `<ellipse cx="${x}" cy="${y}" rx="4.4" ry="2.6" transform="rotate(-42 ${x} ${y})" fill="none" stroke="${OL}" stroke-width="${i === 1 ? 3.6 : 4}"/><ellipse cx="${x}" cy="${y}" rx="4.4" ry="2.6" transform="rotate(-42 ${x} ${y})" fill="none" stroke="${i === 1 ? D(c) : c}" stroke-width="${i === 1 ? 1.6 : 2}"/>`).join('') + glint(17, 5, 0.6);
const crown = (c: string, gem: string) => Pa('M3 18L4 7L8.5 12L12 4L15.5 12L20 7L21 18Z', c) + R(3, 17, 18, 3.5, D(c), 0.8) + C(12, 13, 1.7, gem, 0.7) + C(7, 15, 1.2, gem, 0.6) + C(17, 15, 1.2, gem, 0.6) + C(4, 7, 1, gem, 0.5) + C(12, 4, 1, gem, 0.5) + C(20, 7, 1, gem, 0.5) + glint(10, 9, 0.6);
const pickaxe = (c: string) => Ln('M6 20L16 7', OL, 3.6) + Ln('M6 20L16 7', '#9a6a3a', 2) + Pa('M5 9Q12 1 21 7Q14 5 12 8L11 7Q9 6 5 9Z', c) + Ln('M8 6.5Q12 3.5 17 4.6', L(c), 0.8);
const engine = (c: string) => R(4, 10, 16, 10, c, 1.5) + R(5, 5, 4, 6, D(c), 0.8) + R(10, 5, 4, 6, D(c), 0.8) + R(15, 5, 4, 6, D(c), 0.8) + R(4.5, 4, 5, 2, '#444', 0.6, 0.7) + R(9.5, 4, 5, 2, '#444', 0.6, 0.7) + R(14.5, 4, 5, 2, '#444', 0.6, 0.7) + C(12, 15, 3, '#333', 0.8) + C(12, 15, 1.2, '#999', 0.5) + Ln('M6 12L9 12', L(c), 0.9);
const computer = (c: string) => R(2.5, 3.5, 19, 13, '#2e3238', 1.4) + R(4, 5, 16, 10, c, 0.6, 0.6) + Ln('M6 7L12 7M6 9.5L15 9.5M6 12L10 12', '#cfe6ff', 0.9) + Pa('M10 16.5L14 16.5L15 20L9 20Z', '#555b63') + R(6.5, 19.5, 11, 1.8, '#3a3f45', 0.6, 0.8);
const drill = (c: string) => R(3, 6, 11, 9, c, 2) + Pa('M7 15L11 15L10 21L8 21Z', '#3a3a3a') + Pa('M14 8L18 9L22 10.5L18 12L14 13Z', '#b8bec6') + Ln('M15.5 8.7L16.5 12.3M18 9.3L18.6 11.7', '#6a7078', 0.7) + Ln('M5 8L11 8', L(c), 1) + R(4.5, 10, 3, 3, '#333', 0.5, 0.6);
const part = (c: string) => Pa(gearPath(9, 14, 7, 5.2, 7), D(c)) + C(9, 14, 2, '#222') + Pa('M14 3L19.5 3L22 7.5L19.5 12L14 12L11.5 7.5Z', c) + C(16.75, 7.5, 1.9, '#222', 0.8) + Ln('M14.5 4.2L19 4.2', L(c), 0.8);
const bearing = (c: string) => C(12, 12, 9.5, c) + C(12, 12, 7.3, '#2a2a2e', 0.6) + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i / 8) * Math.PI * 2; return C(+(12 + Math.cos(a) * 5.6).toFixed(2), +(12 + Math.sin(a) * 5.6).toFixed(2), 1.5, L(c), 0.6); }).join('') + C(12, 12, 3.6, D(c)) + C(12, 12, 1.8, '#111', 0.5) + Ln('M5 8A8 8 0 0 1 9 4.3', '#fff', 0.9);
const motor = (c: string) => Pa('M5 6L16 6A3 6 0 0 1 16 18L5 18Z', c) + E(5, 12, 3, 6, D(c)) + Ln('M8 6.4L8 17.6M11 6.4L11 17.6M14 6.4L14 17.6', D(c), 0.9) + R(18, 11, 4.5, 2, '#bbb', 0.4, 0.7) + Pa('M7 18L6 21L15 21L14 18Z', '#3a3a3a') + Ln('M6 8L15 8', L(c), 0.9);
const generator = (c: string) => R(3, 6, 18, 13, c, 2) + R(5, 8, 14, 9, D(c), 1, 0.7) + Pa('M13 8.5L8.5 13L11.5 13L10 17L15.5 11.5L12.5 11.5Z', '#ffd84a', 0.8) + R(5, 19, 3, 2, '#333', 0.4, 0.6) + R(16, 19, 3, 2, '#333', 0.4, 0.6);
const robot = (c: string) => Ln('M12 5L12 2.5', OL, 1.4) + C(12, 2.3, 1.3, '#ff4a4a', 0.6) + R(5, 5, 14, 10, c, 2.5) + C(9, 10, 2, '#9ff') + C(15, 10, 2, '#9ff') + C(9, 10, 0.8, '#033', 0.3) + C(15, 10, 0.8, '#033', 0.3) + R(8.5, 12.6, 7, 1.5, '#333', 0.5, 0.5) + R(7, 16, 10, 6, D(c), 1.5) + R(3, 8, 2, 4, D(c), 0.6, 0.8) + R(19, 8, 2, 4, D(c), 0.6, 0.8) + Ln('M7 7L11 7', L(c), 0.9);
const bracelet = (c: string, gem: string) => `<ellipse cx="12" cy="13" rx="9" ry="5.5" fill="none" stroke="${OL}" stroke-width="4.6"/><ellipse cx="12" cy="13" rx="9" ry="5.5" fill="none" stroke="${c}" stroke-width="2.8"/>` + C(12, 18.5, 1.8, gem, 0.7) + C(6, 17, 1.4, gem, 0.6) + C(18, 17, 1.4, gem, 0.6) + Ln('M4.5 11A9 5.5 0 0 1 9 7.8', '#fff', 0.9);
// food & farm
const sack = (c: string, label: string) => Pa('M6 7Q5 14 5 19Q5 21 8 21L16 21Q19 21 19 19Q19 14 18 7Z', '#e6d7b3') + Pa('M7 7L9 3.5L12 5L15 3.5L17 7Z', '#efe3c4') + Ln('M7.5 7L16.5 7', '#8a6a3a', 1.6) + R(8.5, 11, 7, 6, label, 1, 0.7) + Ln('M7 9Q6.5 14 7 19', '#fff', 0.8);
const bottle = (liq: string, glass = '#8fd0b0', cap = '#7a4a2a') => Pa('M10 2.5L14 2.5L14 7Q18 9 18 13L18 20Q18 21.5 16.5 21.5L7.5 21.5Q6 21.5 6 20L6 13Q6 9 10 7Z', glass) + Pa('M6.6 12L17.4 12L17.4 20Q17.4 20.9 16.4 20.9L7.6 20.9Q6.6 20.9 6.6 20Z', liq, 0) + R(9.6, 1.5, 4.8, 2.5, cap, 0.6, 0.8) + R(8, 14, 8, 4.5, '#f4eee0', 0.6, 0.6) + Ln('M8 9.5Q7.6 12 7.8 17', '#fff', 0.9);
const can = (label: string, mark: string) => Pa('M5 6L19 6L19 19A7 2.5 0 0 1 5 19Z', '#c8ccd2') + E(12, 6, 7, 2.5, '#e0e4e8') + E(12, 6, 5, 1.6, '#b8bcc2', 0.5) + R(5, 9, 14, 8, label, 0, 0.8) + mark + Ln('M6.5 10L6.5 16', '#fff', 0.8);
const fishMark = (c: string) => Pa('M8 13Q11 10.5 15 13Q11 15.5 8 13Z', c, 0.6) + Pa('M15 13L17 11.5L17 14.5Z', c, 0.6);
const jar = (c: string) => R(6, 4, 12, 3, '#d33', 0.8) + Pa('M6 7L18 7Q19 9 19 12L19 19Q19 21 17 21L7 21Q5 21 5 19L5 12Q5 9 6 7Z', '#cfe8f0') + Pa('M5.6 11L18.4 11L18.4 19Q18.4 20.4 17 20.4L7 20.4Q5.6 20.4 5.6 19Z', c, 0) + C(9, 15, 1, '#3a8a2a', 0.3) + C(14, 17, 0.9, '#3a8a2a', 0.3) + C(12, 13.5, 0.8, '#f5e070', 0.3) + R(8, 13, 8, 3.5, '#f4eee0', 0.5, 0.5) + Ln('M7 9L7 18', '#fff', 0.8);
const carton = (c: string) => Pa('M6 8L12 3L18 8L18 21L6 21Z', '#f2f2ee') + Pa('M12 3L18 8L18 21L12 21L12 8Z', '#d8d8d2', 0.8) + Pa('M6 8L12 8L12 21L6 21Z', 'none', 0.8) + R(7, 12, 4, 5, c, 0.4, 0.6) + Pa('M14 13A1.8 2 0 1 0 14 17A1.8 2 0 1 0 14 13Z', '#8a5a30', 0.6);
const loaf = (c: string) => Pa('M3 16Q3 8 12 8Q21 8 21 16L21 18Q21 19 20 19L4 19Q3 19 3 18Z', c) + Ln('M7 10.5L9 13M11 9.5L13 12.5M15 10L17 12.8', shade(c, 0.45), 1.2) + Pa('M3 16Q3 8 12 8', 'none', 0) + Ln('M4.5 14Q6 10 10 9.2', '#fff', 0.7);
const chocolate = () => Pa('M3 8L17 4L21 16L7 20Z', '#5a3420') + Ln('M7.7 6.7L11.7 18.7M12.3 5.3L16.3 17.3M5 13.5L19 9.5', '#3a2012', 1) + Pa('M3 8L10 6L14 18.3L7 20Z', '#c03a3a', 0.9) + R(7.5, 10.5, 3, 4, '#f0d070', 0.3, 0.4);
const pie = (c: string) => E(12, 15, 10, 5, '#d9a35a') + E(12, 13.5, 8.2, 3.8, c) + Ln('M7 12L17 15M8 15L16 11.5M12 10L12 17', '#e9be78', 1.1) + Pa('M2 15A10 5 0 0 0 22 15L21 17.5A10 4 0 0 1 3 17.5Z', '#b8823e', 0.8);
const cloche = () => E(12, 18.5, 10, 2.8, '#e8e8ea') + Pa('M3.5 17.5A8.5 9 0 0 1 20.5 17.5Z', '#d4b048') + C(12, 7.3, 1.6, '#e8c860', 0.7) + Ln('M7 15A6 6.5 0 0 1 10 10', '#fff6c8', 1.2);
const fillet = (c: string) => Pa('M3 14Q6 7 14 8Q20 9 21 13Q19 17 12 18Q5 18 3 14Z', c) + Ln('M8 11Q10 13 8 16M12 10Q14 13 12 17M16 10Q18 13 16 16.5', shade(c, 0.5), 0.9) + Ln('M6 11Q9 8.6 13 9', '#fff', 0.8);
const portion = (c: string) => E(12, 15.5, 10, 5, '#f4f4f0') + E(12, 15.5, 7.5, 3.5, '#e2e2dc', 0.5) + Pa('M5.5 15Q8 11 13 11.5Q18 12 18.5 14.5Q17 17.5 12 17.5Q7 17.5 5.5 15Z', c) + Ln('M9 13Q10 14.5 9 16.5M13 12.3Q14 14.5 13 17', '#7a4a20', 0.8) + C(17, 13, 1.3, '#f3e070', 0.5) + Pa('M15.5 11L17.5 9.5L18 11.5Z', '#3a9a3a', 0.5);
const drop = (c: string) => Pa('M12 3Q19 11 19 15A7 7 0 0 1 5 15Q5 11 12 3Z', c) + Ln('M8.5 14Q8.5 11 11 8', '#fff', 1.1);
// crops
const strawberry = () => Pa('M12 21Q4 15 5 10Q6 7 12 8Q18 7 19 10Q20 15 12 21Z', '#e0334a') + Pa('M7 8L9 5L11 7.5L12 4L13 7.5L15 5L17 8Q12 10 7 8Z', '#3fa03a', 0.8) + [[9, 11], [12, 12], [15, 11], [10.5, 15], [13.5, 15], [12, 18]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx=".5" ry=".8" fill="#ffe680"/>`).join('') + Ln('M7 11Q7.5 9.5 9 9.2', '#fff', 0.9);
const wheat = () => Ln('M8 22L12 6M12 22L12 4M16 22L12 6', '#a57a2a', 1.4) + [[12, 4], [9.6, 8], [14.4, 8]].map(([x, y]) => [0, 3, 6].map((o) => `<ellipse cx="${x - 1.4}" cy="${y + o}" rx="1.4" ry="2" fill="#e8c860" stroke="${OL}" stroke-width=".6"/><ellipse cx="${x + 1.4}" cy="${y + o}" rx="1.4" ry="2" fill="#d8b04a" stroke="${OL}" stroke-width=".6"/>`).join('')).join('');
const carrot = () => Pa('M9 7Q14 5 16 9L6 21Q4 20 5 18Z', '#ee8a2a') + Ln('M8 11L10 12M7 14L9 15M6.5 17L8 17.8', '#b0581a', 0.8) + Pa('M14 7Q15 2 18 2Q17 5 15.5 7.6Z', '#3faa3a', 0.8) + Pa('M15.5 8Q20 6 22 8Q19 10 16 9Z', '#3faa3a', 0.8) + Pa('M15 7.4Q17 3 20.5 4Q18.5 6.5 15.8 8.3Z', '#52c04a', 0.8);
const corn = () => Pa('M12 2Q17 6 16 14Q15 19 12 21Q9 19 8 14Q7 6 12 2Z', '#f2d34a') + Ln('M10 7L14 7M9.2 10L14.8 10M9 13L15 13M9.6 16L14.4 16M12 3L12 20', '#c8a028', 0.7) + Pa('M12 21Q4 18 4 9Q7 14 11 15Z', '#5ab04a') + Pa('M12 21Q20 18 20 9Q17 14 13 15Z', '#4a9a3a');
const tomato = () => C(12, 13.5, 8, '#e0402e') + Pa('M8 7.5L10.5 7.5L12 5L13.5 7.5L16 7.5L13.5 9L12 11L10.5 9Z', '#3fa03a', 0.7) + Ln('M7 11Q8 8.6 10 8.4', '#fff', 1) + Ln('M12 5L12 3', '#3a7a2a', 1.3);
const potato = () => Pa('M4 13Q4 7 11 6.5Q20 6 20.5 12Q21 18 13 18.5Q4 19 4 13Z', '#c8995a') + [[8, 11], [14, 9.5], [16, 14], [10, 15]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".8" fill="#8a6430"/>`).join('') + Ln('M6.5 10Q8 8 11 7.8', '#ecc88a', 1);
const pumpkin = () => E(12, 14, 9.5, 7, '#ee8a22') + E(12, 14, 5, 7, '#f59a32', 0.8) + E(12, 14, 1.8, 7, '#e07a18', 0.7) + Pa('M11 7.5L11.5 3L14 3.6L13 7.5Z', '#5a7a2a', 0.8) + Ln('M5 11Q6 9 8 8.5', '#ffd08a', 0.9);
const grapes = () => [[9, 9], [13, 9], [17, 9], [11, 12.5], [15, 12.5], [9, 12.6], [13, 16], [11, 19], [15, 16]].map(([x, y]) => C(x, y, 2.4, '#7a3aa8', 0.8) + `<circle cx="${x - 0.8}" cy="${y - 0.8}" r=".6" fill="#d8b0f0"/>`).join('') + Ln('M13 6.5L14 2.5', '#6a4a20', 1.3) + Pa('M14 4Q19 2 21 5Q17 7 14 4Z', '#4aa03a', 0.7);
const sunflower = () => Ln('M12 14L12 23', '#3a8a2a', 1.6) + Array.from({ length: 12 }, (_, i) => `<ellipse cx="12" cy="4.2" rx="1.9" ry="3.6" fill="#f6c91c" stroke="${OL}" stroke-width=".6" transform="rotate(${i * 30} 12 11)"/>`).join('') + C(12, 11, 4, '#6a3a1a', 0.8) + Ln('M10.5 10L11.5 11M12.5 10L13.5 11M11 12L12 13M13 12.5L13.5 13', '#3a1e0a', 0.7);
const pineapple = () => Pa('M12 8L9 2L11.5 4.5L12 1L12.5 4.5L15 2Z', '#3aa040', 0.7) + Pa('M8 8L10 5L12 7.5L14 5L16 8Z', '#2f8a34', 0.7) + E(12, 15, 6, 7.5, '#e8b030') + Ln('M7.4 11L14 21M9 8.5L17.5 18.6M6.5 15L11 21.8M16.6 11L10 21M15 8.5L6.5 18.6M17.5 15L13 21.8', '#9a6a18', 0.6) + Ln('M8 12Q8.5 9.4 10 8.8', '#fff', 0.8);
const banana = () => Pa('M4 7Q4 18 15 19Q19 19 21 17Q14 17 10.5 13.5Q7 10 6 5Z', '#f5d83a') + Pa('M4 7Q4 18 15 19Q19 19 21 17Q19 21 14 21Q3 20 3 8Z', '#e0b820', 0.8) + Pa('M4.5 3.5L6.5 5L6 6L4 5Z', '#5a4a1a', 0.7) + Ln('M7.5 10Q9 14 13 16', '#fff4a0', 0.9);
const mango = () => Pa('M6 18Q2 12 6 7Q11 2 17 6Q22 10 18 16Q14 21 6 18Z', '#f5a028') + Pa('M17 6Q22 10 18 16Q14 21 6 18Q14 17 17 6Z', '#e05a2a', 0) + Pa('M13 4Q15 0 20 1Q18 4.6 14.5 4.8Z', '#3fa03a', 0.7) + Ln('M7 9Q9 6 12 5.6', '#fff', 1);
const coconut = () => C(12, 13, 8.5, '#6a4022') + Ln('M6 9L9 12M9 7L11 10M14 16L17 18M5 14L7 16', '#4a2a12', 0.8) + Pa('M10 21A8.5 8.5 0 0 1 3.5 13Q8 18 15 15Q12 20 10 21Z', '#53311a', 0) + [[10, 9], [14, 9], [12, 12]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="#2a160a"/>`).join('') + Ln('M6.5 8Q8 5.6 10.5 5', '#a87a50', 0.9);
const cacao = () => Pa('M4 16Q3 10 9 6Q15 3 19 6Q22 10 18 16Q13 21 8 20Q5 19 4 16Z', '#b8642a') + Ln('M6 15Q8 9 15 5.5M8.5 18.5Q12 12 18.5 8M5 12Q9 8 13 5', '#7a3a14', 0.8) + Ln('M7 9Q9 6.4 12 5.4', '#e8a060', 0.9) + Pa('M19 6L21.5 3.5', 'none', 1.2);
const crate = (c: string) => R(4, 6, 16, 14, c, 1) + Ln('M4 10.5L20 10.5M4 15.5L20 15.5', D(c), 0.9) + Ln('M5 7L19 19', shade(c, -0.25), 1.2) + `<text x="12" y="16" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-size="9" fill="#fff" stroke="${OL}" stroke-width=".8" paint-order="stroke">?</text>`;

// ---------------------------------------------------------------- registry
const GEM = '#c070ff', DIA = '#9ff6ff';
const ORE_ICONS: Record<string, () => string> = {
  stone: () => rock('#8e8882'),
  coal: () => coal('#2b2b2e'),
  copper: () => rock('#7a706a', '#e07a38'),
  iron: () => rock('#6e6460', '#c9a48a'),
  silver: () => rock('#6a6e74', '#eef3f8'),
  gold: () => rock('#6e6258', '#ffcf2e'),
  gem: () => crystals('#b04df0'),
  diamond: () => diamond('#7ff3ff'),
};

// ---------------------------------------------------------------- kitchen groceries + dishes
const shaker = (c: string, cap = '#c8ccd2') => Pa('M8 8L16 8L17 20Q17 21 16 21L8 21Q7 21 7 20Z', c) + Pa('M8 8Q8 4 12 4Q16 4 16 8Z', cap) + C(10.5, 6, 0.5, OL, 0.3) + C(12, 5.3, 0.5, OL, 0.3) + C(13.5, 6, 0.5, OL, 0.3) + Ln('M9 10L9 18', '#fff', 0.8);
const egg3 = () => E(7.5, 15, 3.6, 4.6, '#f6ead6') + E(16.5, 15, 3.6, 4.6, '#efd8b8') + E(12, 12, 3.8, 5, '#fbf3e6') + Ln('M10.3 9.5Q11 8 12.3 7.8', '#fff', 0.9);
const block = (top: string, side: string, holes = false) => P('3,10 13,6 21,9 11,13', top) + P('3,10 11,13 11,19 3,16', side) + P('11,13 21,9 21,15 11,19', D(side)) + (holes ? C(6, 13.5, 0.9, D(side), 0.4) + C(15, 14, 1.1, D(side), 0.4) + C(18.5, 12.5, 0.7, D(side), 0.4) + C(12, 9.5, 0.8, D(top), 0.4) : '');
const meat = (c: string, fat = '#f6e6dc') => Pa('M4 12Q4 5 12 5Q20 5 20 11Q20 18 13 19Q4 20 4 12Z', fat) + Pa('M6 12Q6 7 12 7Q18 7 18 11Q18 16 13 17Q6 17.5 6 12Z', c, 0.7) + Ln('M9 10Q12 9 14 11', L(c), 0.9);
const drum = () => Pa('M4 15Q3 7 11 6Q17 6 16 12Q15 17 9 18Z', '#d88a3a') + Ln('M15 13L20 18', OL, 3.4) + Ln('M15 13L20 18', '#f4ead8', 2) + C(20.5, 18.5, 1.6, '#f4ead8', 0.8) + Ln('M6 11Q7 8 10 7.5', L('#d88a3a'), 0.9);
const strips = () => [0, 5].map((o) => Pa(`M3 ${8 + o}Q8 ${5 + o} 12 ${8 + o}Q16 ${11 + o} 21 ${8 + o}L21 ${11 + o}Q16 ${14 + o} 12 ${11 + o}Q8 ${8 + o} 3 ${11 + o}Z`, '#c8503a', 0.9) + Ln(`M4 ${9.5 + o}Q8 ${7 + o} 12 ${9.5 + o}Q16 ${12 + o} 20 ${9.5 + o}`, '#f4d2c0', 0.8)).join('');
const shrimp = () => Pa('M18 7Q21 13 16 18Q10 21 6 17L9 15Q12 17 14 15Q16 12 14 9Z', '#f0805a') + Ln('M15.5 9.5L18.5 8.5M16 12.5L19.5 12.5M15 15.5L18 17', D('#f0805a'), 0.8) + Pa('M6 17L3 19L4 15Z', '#e0603a', 0.8) + C(15.5, 8.4, 0.6, OL, 0.3);
const bulb = (c: string, stem: string) => Pa('M12 4Q13 7 17 10Q20 14 17 18Q14 21 12 21Q10 21 7 18Q4 14 7 10Q11 7 12 4Z', c) + Ln('M12 4L12 1.8', stem, 1.6) + Ln('M9 12Q8.5 16 10 19M15 12Q15.5 16 14 19', D(c), 0.7);
const lettuce = () => C(12, 13, 8, '#6ac04a') + Pa('M6 12Q9 6 12 12Q15 6 18 12Q15 16 12 13Q9 16 6 12Z', '#9ae070', 0.8) + Ln('M12 13L12 20', '#e8f8c8', 1);
const bell = (c: string) => Pa('M6 9Q4 15 7 19Q12 22 17 19Q20 15 18 9Q15 7 12 9Q9 7 6 9Z', c) + Pa('M11 8L12 4L14 5L13 8.4Z', '#3a8a2a', 0.8) + Ln('M8 11Q7.5 15 9 17.5', L(c), 1);
const mushroom = () => R(10, 12, 4, 8, '#f2e8d8', 1.4) + Pa('M3 13Q3 5 12 5Q21 5 21 13Z', '#b07a4a') + C(8, 9, 1, '#f2e2c8', 0.4) + C(14, 8, 1.2, '#f2e2c8', 0.4) + C(17, 11, 0.8, '#f2e2c8', 0.4);
const lemon = () => E(12, 13, 8.5, 6, '#f6dc3a') + C(3.8, 13, 1.2, '#e8c020', 0.6) + C(20.2, 13, 1.2, '#e8c020', 0.6) + Ln('M8 10Q11 8.5 14 9', '#fff8c0', 1);
const sprig = () => Ln('M12 21L12 6', '#3a7a2a', 1.4) + [8, 11, 14, 17].map((y, i) => E(i % 2 ? 15.5 : 8.5, y, 3.2, 1.7, '#5ab84a', 0.7)).join('') + E(12, 4.5, 1.7, 2.6, '#5ab84a', 0.7);
const sticks = () => [0, 4, 8].map((o) => R(4 + o, 6 - o * 0.2, 3.4, 15, '#a0582a', 1.6, 0.9) + Ln(`M${5 + o} ${8 - o * 0.2}L${5 + o} ${19 - o * 0.2}`, '#c8804a', 0.6)).join('');
const tofu = () => block('#f4f0e2', '#e8e0c8');
const box = (c: string, mark: string) => R(5, 4, 14, 17, c, 1.2) + R(7, 8, 10, 7, '#f6efe0', 0.6, 0.7) + mark + Ln('M7 6L17 6', L(c), 1);
const honey = () => Pa('M7 6L17 6Q19 9 19 13L19 19Q19 21 17 21L7 21Q5 21 5 19L5 13Q5 9 7 6Z', '#f0a820') + R(6, 3, 12, 3.5, '#8a5a2a', 0.8) + Ln('M8 10Q7 14 8 18', '#ffe080', 1) + R(8.5, 12, 7, 4, '#fff4d8', 0.6, 0.6);
/** A dish on a plate: food colours piled in the middle. */
const dish = (a: string, b: string, c2 = '#f4eee0', garnish = '#4aa03a') => E(12, 16, 10, 4.5, '#f6f6f2') + E(12, 15.5, 7, 3, '#e4e4de', 0.5) + Pa('M6 15Q6 8 12 8Q18 8 18 15Z', a) + E(10, 12, 2.8, 2, b, 0.6) + E(14.5, 13, 2.2, 1.6, c2, 0.6) + C(12, 9.6, 1, garnish, 0.5);
const bowl = (soup: string, bits: string[]) => Pa('M3 11L21 11Q21 20 12 20Q3 20 3 11Z', '#e8e2d6') + E(12, 11, 9, 2.6, soup) + bits.map((b, i) => C(8 + i * 3, 10.8 + (i % 2) * 0.6, 0.9, b, 0.4)).join('') + Ln('M5 13Q6 17 10 18.5', '#fff', 0.9);
const taco = () => Pa('M3 17Q3 6 12 6Q21 6 21 17Z', '#f0c050') + Pa('M5 15Q6 10 12 9Q18 10 19 15Z', '#6ac04a', 0.8) + E(12, 12, 4, 1.6, '#f29a7a', 0.6) + C(9, 11, 0.9, '#d8402a', 0.4) + C(15, 11, 0.9, '#d8402a', 0.4);
const sandwich = () => Pa('M3 9L21 9L19 12L5 12Z', '#e8b060') + Pa('M4 12L20 12L20 14L4 14Z', '#6ac04a', 0.7) + Pa('M4 14L20 14L20 15.5L4 15.5Z', '#d8402a', 0.7) + Pa('M4 15.5L20 15.5L20 17L4 17Z', '#c8503a', 0.7) + Pa('M4 17L20 17L19 20L5 20Z', '#e8b060');
const burger = () => Pa('M4 11Q4 4 12 4Q20 4 20 11Z', '#d8903a') + R(3.5, 11, 17, 1.6, '#6ac04a', 0.6, 0.6) + R(4, 12.6, 16, 1.4, '#f6c838', 0.4, 0.6) + R(4, 14, 16, 3, '#6a3a20', 1.2) + Pa('M4 17L20 17Q20 20 17 20L7 20Q4 20 4 17Z', '#d8903a') + C(9, 7, 0.5, '#fff3c8', 0.3) + C(14, 6.5, 0.5, '#fff3c8', 0.3);
const fries = () => [6, 9, 12, 15].map((x, i) => R(x, 4 + (i % 2) * 2, 2.4, 10, '#f6d040', 0.4, 0.7)).join('') + Pa('M5 11L19 11L17 21L7 21Z', '#d8302a') + E(12, 11, 7, 1.4, '#b02020', 0.6) + Pa('M12 14L15 15L12 16Z', '#f6d040', 0.5);
const tart = (fill: string, dots: string) => Pa('M3 13L21 13L19 18L5 18Z', '#d8a058') + E(12, 13, 9, 3.4, '#e8b870') + E(12, 12.6, 7, 2.4, fill, 0.6) + [8, 11, 14, 16].map((x, i) => C(x, 12.4 + (i % 2) * 0.6, 1, dots, 0.4)).join('');
const souffle = () => Pa('M5 12L19 12L18 20L6 20Z', '#f6f6f2') + Ln('M8 12L8 20M11 12L11 20M14 12L14 20M17 12L16.5 20', '#d8d8d0', 0.6) + Pa('M5 12Q4 5 12 5Q20 5 19 12Z', '#7a4a2a') + Ln('M8 8Q11 6 14 7', '#a87050', 1) + C(12, 5, 0.8, '#f6f6f2', 0.4);
const FOOD_ICONS: Record<string, () => string> = {
  salt: () => shaker('#ffffff'), black_pepper: () => shaker('#4a4a4a'), chili: () => shaker('#d8402a'), curry_powder: () => shaker('#e8b020'),
  oil: () => bottle('#e8c840', '#f6f0c8', '#3a8a2a'), soy_sauce: () => bottle('#3a1a0a', '#2a2a2a', '#d8302a'),
  rice: () => sack('#f8f8f0', '#d0d0c0'), pasta: () => box('#3a6ac0', Ln('M9 10L15 13M9 12L15 11.5M9 13.5L15 10', '#f0d070', 1.1)),
  eggs: egg3, milk: () => carton('#f4f8fc'), butter: () => block('#f8e890', '#f2d860'), cheese: () => block('#f6c838', '#e8b020', true),
  chicken: drum, beef: () => meat('#c83a3a'), bacon: strips, tofu, shrimp,
  onion: () => bulb('#c8905a', '#6a8a3a'), garlic: () => bulb('#f4efe2', '#a8b88a'), lettuce, pepper_bell: () => bell('#3aa84a'),
  mushroom, lemon, herbs: sprig, cinnamon: sticks, tomato_sauce: () => can('#d8302a', C(12, 13, 2.6, '#f04a3a', 0.6) + Pa('M11 10.6L12 9.4L13 10.6Z', '#3a8a2a', 0.4)), honey,
  fried_fish: () => dish('#d89a4a', '#f6dc3a', '#f4eee0'), scrambled_eggs: () => dish('#f6dc58', '#f6c838', '#fff3b0'), jam_toast: () => dish('#d8a058', '#d8304a', '#e84a5a'),
  farm_bread: () => loaf('#b8742a'), fish_tacos: taco, carrot_soup: () => bowl('#ee8a2a', ['#4aa03a', '#f6c060', '#4aa03a']), blt: sandwich,
  tomato_pasta: () => dish('#f0d070', '#d8402a', '#f6e8a0'), chicken_stirfry: () => dish('#f4f0e0', '#d88a3a', '#3aa84a', '#d8402a'), fish_chips: fries,
  mushroom_risotto: () => dish('#f0e8c8', '#b07a4a', '#e8d8b0'), pineapple_rice: () => dish('#f6e8a0', '#f6c838', '#d8402a'), beef_burger: burger,
  banana_bread: () => loaf('#8a5a2a'), garlic_shrimp: () => dish('#f6e8a0', '#f0805a', '#f0805a'), mango_salmon: () => dish('#f6f0e0', '#f29a5a', '#f6b030'),
  coconut_curry: () => bowl('#f0b030', ['#f29a7a', '#f4f0e0', '#4aa03a']), beef_stew: () => bowl('#8a4a2a', ['#ee8a2a', '#d8b878', '#c83a3a']),
  grape_tart: () => tart('#8a3ab0', '#6a2a90'), cacao_souffle: souffle,
};
const GOOD_ICONS: Record<string, () => string> = {
  ...FOOD_ICONS,
  brick: () => brick('#a8978a'),
  copper_bar: () => ingot('#dd7a3a'), iron_bar: () => ingot('#9aa2ac'), silver_bar: () => ingot('#dfe6ee'), gold_bar: () => ingot('#ffc828'), steel: () => ingot('#6f8090'),
  glass: () => pane('#a8e0e8'),
  wire: () => coil('#e08a4a'), silver_wire: () => coil('#dfe6ee'),
  gear: () => gear('#9aa0a8'), tool: () => pickaxe('#8a9aaa'),
  cut_crystal: () => diamond(GEM), cut_diamond: () => diamond(DIA),
  silver_ring: () => ring('#e8edf2', '#7fd0ff'), gold_ring: () => ring('#ffd24a', GEM), bracelet: () => bracelet('#d8b45a', '#3fd0c0'),
  machine_part: () => part('#7a98b0'), crown: () => crown('#ffcf3a', DIA),
  iron_plate: () => plate('#9fa6ae'), copper_plate: () => plate('#d08850'), iron_sheet: () => plate('#c4ccd4', false),
  silver_coin: () => coins('#e4e9ee'), gold_coin: () => coins('#f6c840'),
  iron_rod: () => rods('#8c939b'), gold_leaf: () => leaf('#ffd84a'), screw: () => screw('#8d959d'), pipe: () => pipe('#7f8a94'), frame: () => frame('#6a737c'),
  circuit: () => circuit('#2f9a4a'), lens: () => lens('#bff2ff'), gold_chain: () => chain('#ffd24a'),
  engine: () => engine('#c0563a'), computer: () => computer('#3a6fc0'), drill: () => drill('#e0a030'),
  bearing: () => bearing('#b8c0c8'), motor: () => motor('#3f7fc0'), generator: () => generator('#d06a2a'), robot: () => robot('#9aa8b8'),
  crop_strawberry: strawberry, crop_wheat: wheat, crop_carrot: carrot, crop_corn: corn, crop_tomato: tomato, crop_potato: potato, crop_pumpkin: pumpkin,
  crop_grapes: grapes, crop_sunflower: sunflower, crop_pineapple: pineapple, crop_banana: banana, crop_mango: mango, crop_coconut: coconut, crop_cacao: cacao,
  fish_fillet: () => fillet('#f29a7a'), fish_portion: () => portion('#d8904a'),
  flour: () => sack('#f6f2e8', '#d8b860'), cornmeal: () => sack('#f0d050', '#e0a020'), sugar: () => sack('#ffffff', '#6aa0e0'), cocoa: () => sack('#6a3a20', '#a05a30'),
  berry_juice: () => bottle('#c8304a', '#e8c0d0', '#e04a5a'), tropical_juice: () => bottle('#f6a830', '#fae8c0', '#3faa3a'), sunflower_oil: () => bottle('#f2d040', '#f8f0c0', '#e0b020'),
  fish_oil: () => drop('#d8b84a'), wine: () => bottle('#6a1030', '#2a5a3a', '#a01a3a'), coconut_milk: () => carton('#e8e4dc'),
  bread: () => loaf('#c8873a'), chocolate: chocolate, canned_fish: () => can('#3a7ac0', fishMark('#e8eef4')), veggie_soup: () => can('#d0402e', C(12, 13, 2.6, '#f2d34a', 0.6) + C(9, 14, 1, '#3aa03a', 0.4) + C(15, 12, 1, '#ee8a2a', 0.4)),
  pumpkin_pie: () => pie('#e08a2a'), salsa: () => jar('#d8402a'), banquet: cloche,
  // Millionaire Update factory goods
  bronze: () => ingot('#b5803a'), electrum: () => ingot('#e6d58a'), tempered_glass: () => pane('#7fc8d8'), concrete: () => brick('#c0bcb2'), stainless: () => ingot('#c4d0dc'), crystal_glass: () => pane('#d8b0ff'), steel_plate: () => plate('#7a8c9c'), bronze_medal: () => coins('#c08a40'), electrum_coin: () => coins('#ecdc90'), floor_tile: () => plate('#b86a4a', false), steel_beam: () => rods('#5f6f7f'), copper_foil: () => leaf('#e89a60'), silver_leaf: () => leaf('#eef2f6'), bronze_sheet: () => plate('#a87430', false), mirror: () => lens('#d0eef8'), steel_cable: () => coil('#6a7a8a'), gold_wire: () => coil('#ffcc40'), spring: () => screw('#a4aeb8'), fiber_optic: () => coil('#c890ff'), valve: () => pipe('#8a6a5a'), hinge: () => part('#8a929a'), battery: () => part('#3aa060'), sensor: () => circuit('#4ac0c0'), microchip: () => circuit('#1f5a2f'), solar_panel: () => plate('#2a4aa0'), padlock: () => part('#b08a3a'), pump: () => motor('#3a70a0'), girder: () => frame('#5a6470'), lantern: () => jar('#f0c050'), electrum_ring: () => ring('#e6d58a', '#c070ff'), diamond_necklace: () => chain('#c8fbff'), pocket_watch: () => gear('#e0b850'), tiara: () => crown('#e8eef6', '#c070ff'), trophy: () => crown('#d8a830', '#ffe27a'), scepter: () => rods('#ffd040'), earrings: () => bracelet('#ffd860', '#c070ff'), tractor: () => engine('#3a9a3a'), turbine: () => generator('#c8d4e0'), server_rack: () => computer('#2a3a5a'), satellite: () => robot('#c0c8e0'), drone: () => robot('#505a64'), telescope: () => drill('#4a5aa0'), excavator: () => drill('#f0c820'), mech_suit: () => robot('#a03a3a'), starch: () => sack('#f4f0e0', '#b08a5a'), carrot_juice: () => bottle('#f08a30', '#f8e0c0', '#3aa03a'), mango_puree: () => jar('#f6a030'), grape_juice: () => bottle('#7a3ab0', '#d8c0f0', '#3a7a3a'), pumpkin_seeds: () => sack('#e8d8a0', '#e0782a'), tomato_paste: () => jar('#b82a20'), pasta_dinner: () => can('#e8c860', C(12, 13, 2.6, '#c83a2a', 0.6)), choc_cake: () => pie('#5a2a18'), jam_jar: () => jar('#d8304a'), cornbread: () => loaf('#e0b040'), smoothie: () => bottle('#f0a0b0', '#fae8f0', '#f6c838'), fish_pie: () => pie('#e8c890'),
};

// Explicit width/height so the svg has an intrinsic size (a viewBox alone falls back to 300x150).

// ---------------------------------------------------------------- reef fish (Reef Pier at Chud Resort, pt1304u): side view, head right
type FishOpt = { body: string; belly?: string; fin: string; hh?: number; x0?: number; nose?: number; tail?: 'fork' | 'round' | 'lunate'; dorsal?: string; extra?: string; over?: string };
const fishSide = (o: FishOpt) => {
  const hh = o.hh ?? 5, x0 = o.x0 ?? 6, nx = o.nose ?? 21, y = 12;
  const tail = o.tail === 'round' ? Pa(`M${x0 + 1} ${y}C${x0 - 2} ${y - 5} ${x0 - 5} ${y - 4} ${x0 - 4} ${y}C${x0 - 5} ${y + 4} ${x0 - 2} ${y + 5} ${x0 + 1} ${y}Z`, o.fin)
    : o.tail === 'lunate' ? Pa(`M${x0 + 1} ${y}L${x0 - 3} ${y - 7}Q${x0 - 2} ${y} ${x0 - 3} ${y + 7}Z`, o.fin)
    : P(`${x0 + 1},${y} ${x0 - 4},${y - 5} ${x0 - 2.5},${y} ${x0 - 4},${y + 5}`, o.fin);
  const dorsal = o.dorsal ?? Pa(`M${x0 + 4} ${y - hh * 0.8}Q${(x0 + nx) / 2} ${y - hh - 3} ${(x0 + nx) / 2 + 3} ${y - hh * 0.9}Z`, o.fin, 0.9);
  const body = `M${nx} ${y}C${nx - 2} ${y - hh} ${x0 + 4} ${y - hh} ${x0} ${y}C${x0 + 4} ${y + hh} ${nx - 2} ${y + hh} ${nx} ${y}Z`;
  const belly = o.belly ? `<path d="M${nx - 1} ${y + 0.5}C${nx - 3} ${y + hh * 0.85} ${x0 + 5} ${y + hh * 0.85} ${x0 + 1} ${y + 0.5}Z" fill="${o.belly}" opacity=".9"/>` : '';
  const ex = nx - 3.2, ey = y - hh * 0.25;
  return tail + dorsal + (o.extra ?? '') + Pa(body, o.body) + belly + (o.over ?? '') + `<path d="${body}" fill="none" stroke="${OL}" stroke-width="1.1"/>` + Pa(`M${x0 + 9} ${y + 1}l-2.5 2.2l3 .2z`, o.fin, 0.7) + C(ex, ey, 1.2, '#fff', 0.6) + C(ex + 0.25, ey, 0.6, OL, 0);
};
const band = (x: number, hh: number, w = 1.6, c = '#fff') => `<path d="M${x} ${12 - hh}Q${x - 1} 12 ${x} ${12 + hh}" fill="none" stroke="${OL}" stroke-width="${w + 1}"/><path d="M${x} ${12 - hh}Q${x - 1} 12 ${x} ${12 + hh}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
const bill = (c: string) => P('20,11.6 23.6,11.2 20.4,12.6', c, ' stroke-width="0.7"');
const FISH_ICONS: Record<string, () => string> = {
  clownfish: () => fishSide({ body: '#ff7a1a', fin: '#ff8a2a', hh: 5.2, tail: 'round', dorsal: Pa('M10 7.5Q13 4 16 7.5Z', '#ff8a2a', 0.9), over: band(17, 4.2) + band(12.5, 4.8) + band(8, 2.8, 1.2) }),
  bluetang: () => fishSide({ body: '#2a5ad8', fin: '#f6d020', hh: 6.2, x0: 5, tail: 'lunate', dorsal: Pa('M8 7Q14 3.5 19 8Z', '#1f44b0', 0.9), over: Pa('M9 10C12 7 16 8 18 10C15 9.5 13 11 11 13C14 14 15 15 16 16C12 16 9 14 9 10Z', '#0d1a40', 0.5) }),
  damsel: () => fishSide({ body: '#e8ecf0', belly: '#f8f8fa', fin: '#e6c84a', hh: 5.6, over: '<path d="M8 8.5C11 6 17 6 20 10L20 9Z" fill="#f2d84a" opacity=".85"/>' + [9, 11.5, 14, 16.5, 19].map((x) => Ln(`M${x} ${x > 18 ? 9.5 : 7.4}L${x} ${x > 18 ? 14.5 : 16.6}`, '#1b1510', 1.1)).join('') }),
  parrotfish: () => fishSide({ body: '#2ac0a0', belly: '#ff9ac0', fin: '#c05ac8', hh: 5.4, tail: 'lunate', over: [8, 11, 14].map((x) => Ln(`M${x} 9Q${x + 1.4} 12 ${x} 15`, '#ff7ab0', 0.8)).join('') + Ln('M20 11L21.4 12L20 13', '#f8f0e0', 1.3) }),
  snapper: () => fishSide({ body: '#e84a4a', belly: '#ffb0a0', fin: '#d83a3a', hh: 5.4, dorsal: P('9,8 11,4.5 13,7 15,4.8 17,8', '#d83a3a', ' stroke-width="0.9"'), over: Ln('M9 10.4L18 9.6', '#ff8a8a', 0.8) }),
  triggerfish: () => fishSide({ body: '#efe6cc', belly: '#f8f0d8', fin: '#3a8ad8', hh: 6, tail: 'round', over: Ln('M10 7L13 17', '#1a4ab0', 1.2) + Ln('M14.5 7.4L16 16.6', '#1a1a1a', 1.4) + Ln('M8 13H13', '#f2c820', 1) + Ln('M17 13.5H21', '#f2c820', 1) }),
  mahimahi: () => fishSide({ body: '#3ab84a', belly: '#f6d820', fin: '#2a7ad0', hh: 5.2, x0: 4, tail: 'fork', dorsal: Pa('M7 8.6Q12 3.4 20.6 7.4L20 9Z', '#2a7ad0', 0.9), over: [9, 12, 15].map((x) => C(x, 11.6, 0.55, '#1a5a8a', 0)).join('') }),
  barracuda: () => fishSide({ body: '#a8b4bc', belly: '#eef2f4', fin: '#5a6a74', hh: 3, x0: 4, nose: 22.5, tail: 'fork', dorsal: P('8,10 9,7.2 10.6,9.4', '#5a6a74', ' stroke-width="0.8"'), over: [8, 10.5, 13, 15.5].map((x) => Ln(`M${x} 9.6L${x - 0.8} 12`, '#3a4650', 1.1)).join('') + Ln('M19.4 12.6L22.4 12.2', '#1b1510', 0.7) }),
  grouper: () => fishSide({ body: '#8a5a3a', belly: '#c89a6a', fin: '#6a4028', hh: 6, tail: 'round', over: [[9, 9], [12, 8.4], [15, 9], [10.5, 12.5], [13.5, 12], [16.5, 11.4], [12, 15], [8, 13]].map(([x, y]) => C(x!, y!, 0.75, '#e8b05a', 0)).join('') + Ln('M18 14.2Q20 14.5 21 12.8', '#3a2010', 0.9) }),
  yellowfin: () => fishSide({ body: '#1f3a78', belly: '#d8e2ea', fin: '#f6c820', hh: 5, x0: 5, tail: 'lunate', dorsal: P('11,8 13,2.6 14.6,7.6', '#f6c820', ' stroke-width="0.9"'), extra: P('11,16 13,21.4 14.6,16.4', '#f6c820', ' stroke-width="0.9"'), over: Ln('M7.6 11.4L18 10.6', '#f6d040', 0.9) + [7, 8.4, 9.8].map((x) => Pn(`${x},8.6 ${x + 0.8},7.8 ${x + 0.8},9`, '#f6d820')).join('') }),
  sailfish: () => fishSide({ body: '#1e4aa8', belly: '#dce6f2', fin: '#2a3a88', hh: 3.8, x0: 4, nose: 20, tail: 'lunate', dorsal: Pa('M6.5 9.4C7 2 13 1.4 17.6 8.6Z', '#3a5ad0', 0.9) + [8.5, 11, 13.5].map((x) => Ln(`M${x} ${x < 10 ? 4.5 : 3.6}L${x} 9`, '#7ab0ff', 0.6)).join(''), extra: bill('#2a3a88'), over: [8, 10, 12].map((x) => Ln(`M${x} 9.2L${x} 13`, '#8ab8ff', 0.6)).join('') }),
  marlin: () => fishSide({ body: '#163c94', belly: '#e2ecf6', fin: '#0e2668', hh: 4.6, x0: 4, nose: 20, tail: 'lunate', dorsal: P('8,8.2 9.6,3.2 12,7.4 17,8', '#0e2668', ' stroke-width="0.9"'), extra: bill('#0e2668'), over: [7.5, 9.5, 11.5, 13.5].map((x) => Ln(`M${x} 8.6L${x} 14`, '#7ad0ff', 0.7)).join('') + `<circle cx="18" cy="9" r="0.6" fill="#ffd27a"/>` }),
  manta: () => Pa('M12 5C14 7 17 9 22.5 9.4C19 12 16 15.6 13 16.4L12 21L11 16.4C8 15.6 5 12 1.5 9.4C7 9 10 7 12 5Z', '#2a2440') + `<path d="M12 7.6C13.6 9.4 16.4 10.8 19.4 10.4C16.6 12.4 14.6 14.4 12 14.8C9.4 14.4 7.4 12.4 4.6 10.4C7.6 10.8 10.4 9.4 12 7.6Z" fill="#ff8a5a" opacity=".55"/>` + Pa('M10.4 5.6L9.6 3.4L11.2 4.8ZM13.6 5.6L14.4 3.4L12.8 4.8Z', '#2a2440', 0.8) + C(8.6, 9.6, 0.7, '#fff', 0.4) + C(15.4, 9.6, 0.7, '#fff', 0.4) + Ln('M12 8V14', '#ffd0a0', 0.6) + glint(18, 7, 0.7),
  flipflop: () => E(12, 13, 5.2, 9, '#ff5a8a') + E(12, 13.6, 3.8, 7.4, '#ffd0e0', 0.6) + Ln('M8.8 9.6L12 7.6L15.2 9.6', '#2ac0d0', 1.6) + C(12, 7.6, 0.8, '#2ac0d0', 0.6),
  coconutshell: () => Pa('M3 12C3 18 7.5 21 12 21C16.5 21 21 18 21 12Z', '#7a4a24') + E(12, 12, 9, 2.4, '#f6f0e2') + E(12, 12, 6.6, 1.5, '#e8dcc0', 0.5) + Ln('M6 16L8 18.4M11 17L12 19.6M16 16L15 18.6', '#4a2a10', 0.8),
};
/** Reef species with a crafted fish icon (type 'fish'). */
export const ICON_FISH_IDS = Object.keys(FISH_ICONS);

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`;
const ALIAS: Record<string, string> = { crystal: 'gem', strawberry: 'crop_strawberry', wheat: 'crop_wheat', carrot: 'crop_carrot', corn: 'crop_corn', tomato: 'crop_tomato', potato: 'crop_potato', pumpkin: 'crop_pumpkin', grapes: 'crop_grapes', sunflower: 'crop_sunflower', pineapple: 'crop_pineapple', banana: 'crop_banana', mango: 'crop_mango', coconut: 'crop_coconut', cacao: 'crop_cacao' };
const cache = new Map<string, string>();

/** True when the item has a crafted icon (not the fallback crate). */
/** Buyable mining tools (request #16), type 'tool'. */
const jackhammerIcon = () => R(10, 2.5, 4, 3, '#222', 0.6, 0.8) + Ln('M4 4L20 4', OL, 3.2) + Ln('M4 4L20 4', '#2a2a2a', 1.8) + R(8, 5.5, 8, 10, '#e05a20', 1.6) + Ln('M8.5 8L15.5 8M8.5 10.5L15.5 10.5M8.5 13L15.5 13', '#7a2e10', 0.8) + R(10.5, 15.5, 3, 2, '#9aa2ac', 0.4, 0.8) + Pa('M11.2 17.5L12.8 17.5L12.8 20.5L12 22L11.2 20.5Z', '#c8ced6');
const plasmaIcon = () => R(3, 13, 4, 8, '#15171a', 1.2) + Pa('M5 13L15 5L18 8L8 16Z', '#2c3138') + Ln('M8 11.5L10.5 14M11 9L13.5 11.5', '#4ad8ff', 1.2) + Pa('M15 5L17 3L20 6L18 8Z', '#c8ced6') + Pa('M19 4L23 1L21.5 5.5Z', '#8ff0ff', 0.6) + glint(21, 3, 0.8);
const TOOL_ICONS: Record<string, () => string> = {
  pickaxe: () => pickaxe('#8a9aaa'), steel_pick: () => pickaxe('#dfe8f2'),
  hand_drill: () => drill('#c0563a'), power_drill: () => drill('#f0b020') + glint(19, 9, 0.8),
  jackhammer: jackhammerIcon, plasma_cutter: plasmaIcon,
};
export function hasItemIcon(type: string | undefined, id: string): boolean { const i = ALIAS[id] ?? id; if (type === 'tool') return i in TOOL_ICONS; return type === 'fish' ? i in FISH_ICONS : type === 'ore' ? i in ORE_ICONS : i in GOOD_ICONS || (type == null && i in ORE_ICONS); }
/** SVG markup for an item. `type` is 'ore' | 'bar' | 'good' (optional: ids are unique across ore and goods except none). */
export function itemIconSvg(type: string | undefined, id: string): string {
  const i = ALIAS[id] ?? id; const k = `${type ?? ''}:${i}`; const hit = cache.get(k); if (hit) return hit;
  const f = type === 'tool' ? TOOL_ICONS[i] : type === 'fish' ? FISH_ICONS[i] : type === 'ore' ? ORE_ICONS[i] : GOOD_ICONS[i] ?? (type == null ? ORE_ICONS[i] : undefined);
  const tint = (type === 'ore' && isOre(i) ? ORES[i].color : GOODS[i]?.color) ?? '#9a7a4a';
  const out = svg(f ? f() : crate(shade(tint, -0.1)));
  cache.set(k, out); return out;
}
export const itemIconUri = (type: string | undefined, id: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(itemIconSvg(type, id));
/** Same as itemIconUri but from a "type:id" stack key. */
export const itemIconUriKey = (key: string) => { const [t, ...rest] = key.split(':'); return itemIconUri(t, rest.join(':')); };
/** Every id with a crafted icon (for tests / the contact sheet). */
export const ICON_ORE_IDS = Object.keys(ORE_ICONS), ICON_GOOD_IDS = Object.keys(GOOD_ICONS);
