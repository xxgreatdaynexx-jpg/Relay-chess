/**
 * Chud Conquest maps. All art is generated from territory capitals: each territory's cell is its Voronoi region,
 * optionally bounded by its continent outline (the Chudlands) or by a rounded "land" disc (every other map).
 */
export type Pt = [number, number];
export interface Continent { id: string; name: string; bonus: number; color: string; poly?: Pt[] }
export interface Territory { id: number; name: string; continent: string; at: Pt }
export interface CqMap {
  id: string; name: string; blurb: string; w: number; h: number;
  continents: Continent[]; territories: Territory[];
  /** [a, b, sea] */
  edges: Array<[number, number, boolean]>;
  adj: number[][];
  cells: Pt[][];
}
interface Raw {
  id: string; name: string; blurb: string; w: number; h: number;
  continents: Continent[];
  t: Array<[string, string, number, number]>;
  /** Explicit land borders (classic layouts). When absent, land borders are derived from the capitals. */
  land?: Array<[string, string]>;
  sea: Array<[string, string]>;
  /** Extra land borders on top of the automatic ones. */
  link?: Array<[string, string]>;
  /** Land disc radius, and the longest automatic land border. */
  r?: number; landMax?: number;
  /** Automatic land borders may cross continents (one landmass) or not (islands). */
  crossLand?: boolean;
}

/** Clip polygon by the half-plane closer to a than to b (Sutherland–Hodgman). */
export function clipHalf(poly: Pt[], a: Pt, b: Pt): Pt[] {
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const d: Pt = [b[0] - a[0], b[1] - a[1]];
  const side = (p: Pt) => (p[0] - m[0]) * d[0] + (p[1] - m[1]) * d[1];
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const sp = side(p), sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp <= 0) !== (sq <= 0)) { const k = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]); }
  }
  return out;
}
/** A wobbly disc around a capital, so coastlines look hand-drawn rather than circular. */
function disc(c: Pt, r: number, seed: number): Pt[] {
  const n = 20;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = r * (0.9 + 0.12 * Math.sin(seed * 1.7 + i * 2.3) + 0.06 * Math.cos(seed * 0.9 + i * 4.1));
    return [c[0] + Math.cos(a) * k, c[1] + Math.sin(a) * k] as Pt;
  });
}
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function build(raw: Raw): CqMap {
  const territories: Territory[] = raw.t.map(([name, continent, x, y], id) => ({ id, name, continent, at: [x, y] }));
  const idx = (n: string) => { const i = territories.findIndex((t) => t.name === n); if (i < 0) throw new Error(`${raw.id}: ${n}`); return i; };
  const edges: Array<[number, number, boolean]> = [];
  const key = new Set<string>();
  const add = (a: number, b: number, sea: boolean) => { const k = a < b ? `${a}-${b}` : `${b}-${a}`; if (a === b || key.has(k)) return; key.add(k); edges.push([a, b, sea]); };
  if (raw.land) for (const [a, b] of raw.land) add(idx(a), idx(b), false);
  else {
    const max = raw.landMax ?? 140;
    // Gabriel graph: a and b border when no other capital sits inside the circle on a–b as diameter.
    for (const a of territories) for (const b of territories) {
      if (b.id <= a.id || dist(a.at, b.at) > max) continue;
      if (!raw.crossLand && a.continent !== b.continent) continue;
      const m: Pt = [(a.at[0] + b.at[0]) / 2, (a.at[1] + b.at[1]) / 2], rr = dist(a.at, b.at) / 2;
      if (territories.some((c) => c.id !== a.id && c.id !== b.id && dist(c.at, m) < rr - 0.01)) continue;
      add(a.id, b.id, false);
    }
  }
  for (const [a, b] of raw.link ?? []) add(idx(a), idx(b), false);
  for (const [a, b] of raw.sea) add(idx(a), idx(b), true);
  const adj: number[][] = territories.map(() => []);
  for (const [a, b] of edges) { adj[a]!.push(b); adj[b]!.push(a); }
  const cells = territories.map((t) => {
    const c = raw.continents.find((x) => x.id === t.continent)!;
    if (c.poly) return territories.filter((o) => o.continent === t.continent && o.id !== t.id).reduce((poly, o) => clipHalf(poly, t.at, o.at), c.poly);
    return territories.filter((o) => o.id !== t.id && dist(o.at, t.at) < (raw.r ?? 70) * 2.2).reduce((poly, o) => clipHalf(poly, t.at, o.at), disc(t.at, raw.r ?? 70, t.id));
  });
  return { id: raw.id, name: raw.name, blurb: raw.blurb, w: raw.w, h: raw.h, continents: raw.continents, territories, edges, adj, cells };
}

const CHUD = build({
  id: 'chud', name: 'The Chudlands', blurb: '28 territories · 6 continents · the original', w: 1000, h: 630,
  continents: [
    { id: 'north', name: 'Northmarch', bonus: 3, color: '#4e6b3f', poly: [[60, 60], [330, 40], [385, 140], [305, 235], [120, 245], [45, 160]] },
    { id: 'bog', name: 'Bogwater', bonus: 2, color: '#3f5f55', poly: [[40, 290], [215, 268], [255, 380], [195, 525], [60, 505], [28, 400]] },
    { id: 'salt', name: 'Saltreach', bonus: 5, color: '#6b6a3c', poly: [[420, 175], [625, 165], [665, 300], [605, 425], [440, 435], [378, 300]] },
    { id: 'ember', name: 'Emberlands', bonus: 2, color: '#6e4a33', poly: [[298, 468], [472, 466], [505, 585], [320, 605], [268, 540]] },
    { id: 'frost', name: 'Frostspire', bonus: 3, color: '#4f6670', poly: [[690, 38], [962, 48], [972, 205], [862, 265], [718, 235], [668, 130]] },
    { id: 'isles', name: 'Isles of Chud', bonus: 2, color: '#5a4f66', poly: [[722, 355], [962, 348], [972, 585], [742, 595], [688, 470]] },
  ],
  t: [
    ['Hollowmere', 'north', 110, 105], ['Gristle Peak', 'north', 220, 85], ['Thornwick', 'north', 320, 115], ['Ashfen', 'north', 140, 195], ['Crowgate', 'north', 250, 185],
    ['Mirelock', 'bog', 100, 335], ['Sludgemoor', 'bog', 190, 340], ['Fenward', 'bog', 90, 445], ['Rotroot', 'bog', 180, 460],
    ['Brinegate', 'salt', 465, 225], ['Kelpholm', 'salt', 575, 215], ['Dunmarrow', 'salt', 430, 325], ['Saltspire', 'salt', 530, 300], ['Cragmoor', 'salt', 620, 320], ['Gullhaven', 'salt', 515, 395],
    ['Cinderpit', 'ember', 335, 510], ['Scorchfield', 'ember', 435, 510], ['Blackglass', 'ember', 335, 570], ['Pyrewell', 'ember', 445, 570],
    ['Rimehold', 'frost', 745, 95], ['Icefang', 'frost', 860, 95], ['Glacierbay', 'frost', 930, 175], ['Snowmantle', 'frost', 765, 190], ['Whitewolf', 'frost', 860, 205],
    ['Chudmouth', 'isles', 775, 415], ['Gobport', 'isles', 895, 415], ['Lardholm', 'isles', 770, 535], ['Mudpeak', 'isles', 895, 530],
  ],
  land: [
    ['Hollowmere', 'Gristle Peak'], ['Hollowmere', 'Ashfen'], ['Gristle Peak', 'Thornwick'], ['Gristle Peak', 'Crowgate'], ['Gristle Peak', 'Ashfen'], ['Thornwick', 'Crowgate'], ['Ashfen', 'Crowgate'],
    ['Mirelock', 'Sludgemoor'], ['Mirelock', 'Fenward'], ['Sludgemoor', 'Fenward'], ['Sludgemoor', 'Rotroot'], ['Fenward', 'Rotroot'],
    ['Brinegate', 'Kelpholm'], ['Brinegate', 'Dunmarrow'], ['Brinegate', 'Saltspire'], ['Kelpholm', 'Saltspire'], ['Kelpholm', 'Cragmoor'], ['Dunmarrow', 'Saltspire'], ['Dunmarrow', 'Gullhaven'], ['Saltspire', 'Cragmoor'], ['Saltspire', 'Gullhaven'], ['Cragmoor', 'Gullhaven'],
    ['Cinderpit', 'Scorchfield'], ['Cinderpit', 'Blackglass'], ['Scorchfield', 'Pyrewell'], ['Blackglass', 'Pyrewell'],
    ['Rimehold', 'Icefang'], ['Rimehold', 'Snowmantle'], ['Icefang', 'Glacierbay'], ['Icefang', 'Whitewolf'], ['Icefang', 'Snowmantle'], ['Glacierbay', 'Whitewolf'], ['Snowmantle', 'Whitewolf'],
    ['Chudmouth', 'Gobport'], ['Chudmouth', 'Lardholm'], ['Gobport', 'Mudpeak'], ['Lardholm', 'Mudpeak'], ['Chudmouth', 'Mudpeak'],
  ],
  sea: [
    ['Ashfen', 'Mirelock'], ['Crowgate', 'Brinegate'], ['Thornwick', 'Rimehold'], ['Sludgemoor', 'Dunmarrow'], ['Rotroot', 'Cinderpit'],
    ['Gullhaven', 'Scorchfield'], ['Cragmoor', 'Chudmouth'], ['Kelpholm', 'Snowmantle'], ['Whitewolf', 'Gobport'], ['Pyrewell', 'Lardholm'],
  ],
});

const WORLD = build({
  id: 'world', name: 'Classic World', blurb: '42 territories · 6 continents · the familiar layout', w: 1400, h: 760, r: 78,
  continents: [
    { id: 'na', name: 'North America', bonus: 5, color: '#6b6a3c' },
    { id: 'sa', name: 'South America', bonus: 2, color: '#6e4a33' },
    { id: 'eu', name: 'Europe', bonus: 5, color: '#4f6670' },
    { id: 'af', name: 'Africa', bonus: 3, color: '#7a5a34' },
    { id: 'as', name: 'Asia', bonus: 7, color: '#4e6b3f' },
    { id: 'au', name: 'Australia', bonus: 2, color: '#5a4f66' },
  ],
  t: [
    ['Alaska', 'na', 80, 110], ['Northwest Territory', 'na', 200, 100], ['Greenland', 'na', 430, 60], ['Alberta', 'na', 175, 180], ['Ontario', 'na', 265, 185], ['Quebec', 'na', 355, 175],
    ['Western United States', 'na', 190, 265], ['Eastern United States', 'na', 290, 270], ['Central America', 'na', 225, 350],
    ['Venezuela', 'sa', 300, 425], ['Peru', 'sa', 300, 525], ['Brazil', 'sa', 395, 490], ['Argentina', 'sa', 330, 625],
    ['Iceland', 'eu', 540, 110], ['Great Britain', 'eu', 545, 205], ['Scandinavia', 'eu', 650, 100], ['Northern Europe', 'eu', 645, 205], ['Western Europe', 'eu', 560, 300], ['Southern Europe', 'eu', 660, 290], ['Ukraine', 'eu', 760, 175],
    ['North Africa', 'af', 585, 420], ['Egypt', 'af', 685, 385], ['East Africa', 'af', 755, 480], ['Congo', 'af', 670, 520], ['South Africa', 'af', 690, 630], ['Madagascar', 'af', 820, 625],
    ['Ural', 'as', 875, 150], ['Siberia', 'as', 965, 105], ['Yakutsk', 'as', 1085, 75], ['Kamchatka', 'as', 1205, 95], ['Irkutsk', 'as', 1065, 175], ['Mongolia', 'as', 1085, 255], ['Japan', 'as', 1235, 245],
    ['Afghanistan', 'as', 865, 255], ['China', 'as', 1000, 315], ['Middle East', 'as', 790, 335], ['India', 'as', 915, 385], ['Siam', 'as', 1040, 410],
    ['Indonesia', 'au', 1085, 525], ['New Guinea', 'au', 1215, 505], ['Western Australia', 'au', 1125, 650], ['Eastern Australia', 'au', 1245, 635],
  ],
  land: [
    ['Alaska', 'Northwest Territory'], ['Alaska', 'Alberta'], ['Northwest Territory', 'Alberta'], ['Northwest Territory', 'Ontario'], ['Northwest Territory', 'Greenland'],
    ['Alberta', 'Ontario'], ['Alberta', 'Western United States'], ['Ontario', 'Western United States'], ['Ontario', 'Eastern United States'], ['Ontario', 'Quebec'],
    ['Quebec', 'Eastern United States'], ['Western United States', 'Eastern United States'], ['Western United States', 'Central America'], ['Eastern United States', 'Central America'],
    ['Central America', 'Venezuela'], ['Venezuela', 'Peru'], ['Venezuela', 'Brazil'], ['Peru', 'Brazil'], ['Peru', 'Argentina'], ['Brazil', 'Argentina'],
    ['Scandinavia', 'Northern Europe'], ['Scandinavia', 'Ukraine'], ['Northern Europe', 'Western Europe'], ['Northern Europe', 'Southern Europe'], ['Northern Europe', 'Ukraine'],
    ['Western Europe', 'Southern Europe'], ['Southern Europe', 'Ukraine'], ['Southern Europe', 'Middle East'], ['Ukraine', 'Ural'], ['Ukraine', 'Afghanistan'], ['Ukraine', 'Middle East'],
    ['North Africa', 'Egypt'], ['North Africa', 'East Africa'], ['North Africa', 'Congo'], ['Egypt', 'East Africa'], ['Egypt', 'Middle East'], ['East Africa', 'Congo'], ['East Africa', 'South Africa'], ['East Africa', 'Middle East'], ['Congo', 'South Africa'],
    ['Ural', 'Siberia'], ['Ural', 'China'], ['Ural', 'Afghanistan'], ['Siberia', 'Yakutsk'], ['Siberia', 'Irkutsk'], ['Siberia', 'Mongolia'], ['Siberia', 'China'], ['Yakutsk', 'Kamchatka'], ['Yakutsk', 'Irkutsk'],
    ['Kamchatka', 'Irkutsk'], ['Kamchatka', 'Mongolia'], ['Irkutsk', 'Mongolia'], ['Mongolia', 'China'], ['Afghanistan', 'China'], ['Afghanistan', 'India'], ['Afghanistan', 'Middle East'],
    ['China', 'India'], ['China', 'Siam'], ['Middle East', 'India'], ['India', 'Siam'], ['Western Australia', 'Eastern Australia'],
  ],
  sea: [
    ['Alaska', 'Kamchatka'], ['Greenland', 'Ontario'], ['Greenland', 'Quebec'], ['Greenland', 'Iceland'], ['Brazil', 'North Africa'],
    ['Iceland', 'Great Britain'], ['Iceland', 'Scandinavia'], ['Great Britain', 'Scandinavia'], ['Great Britain', 'Northern Europe'], ['Great Britain', 'Western Europe'],
    ['Western Europe', 'North Africa'], ['Southern Europe', 'North Africa'], ['Southern Europe', 'Egypt'], ['East Africa', 'Madagascar'], ['South Africa', 'Madagascar'],
    ['Kamchatka', 'Japan'], ['Mongolia', 'Japan'], ['Siam', 'Indonesia'], ['Indonesia', 'New Guinea'], ['Indonesia', 'Western Australia'], ['New Guinea', 'Western Australia'], ['New Guinea', 'Eastern Australia'],
  ],
});

const EUROPE = build({
  id: 'europe1812', name: 'Europe 1812', blurb: '47 territories · 10 powers · the year of the eagle', w: 1220, h: 860, r: 72, landMax: 155, crossLand: true,
  continents: [
    { id: 'brit', name: 'British Isles', bonus: 3, color: '#5b6b8a' },
    { id: 'scan', name: 'Scandinavia', bonus: 2, color: '#4f6670' },
    { id: 'fra', name: 'French Empire', bonus: 5, color: '#4a5f8f' },
    { id: 'ibe', name: 'Iberia', bonus: 2, color: '#7a5a34' },
    { id: 'rhine', name: 'Rhine League', bonus: 3, color: '#6b6a3c' },
    { id: 'pru', name: 'Prussia', bonus: 3, color: '#55555f' },
    { id: 'aus', name: 'Austria', bonus: 4, color: '#8a7a3c' },
    { id: 'ita', name: 'Italy', bonus: 2, color: '#4e6b3f' },
    { id: 'rus', name: 'Russia', bonus: 5, color: '#6e4a33' },
    { id: 'ott', name: 'Ottoman Porte', bonus: 2, color: '#7a4a4a' },
  ],
  t: [
    ['Ireland', 'brit', 165, 265], ['Scotland', 'brit', 300, 150], ['Northumbria', 'brit', 330, 240], ['Albion', 'brit', 330, 325],
    ['Norway', 'scan', 560, 105], ['Sweden', 'scan', 650, 120], ['Finland', 'scan', 760, 100], ['Denmark', 'scan', 560, 225],
    ['Normandy', 'fra', 420, 440], ['Paris', 'fra', 500, 440], ['Brittany', 'fra', 335, 470], ['Aquitaine', 'fra', 385, 560], ['Lyonnais', 'fra', 480, 525], ['Provence', 'fra', 510, 605], ['Lorraine', 'fra', 575, 420],
    ['Catalonia', 'ibe', 440, 675], ['Castile', 'ibe', 330, 690], ['Portugal', 'ibe', 225, 690], ['Andalusia', 'ibe', 305, 785],
    ['Holland', 'rhine', 560, 320], ['Westphalia', 'rhine', 640, 360], ['Saxony', 'rhine', 735, 385], ['Bavaria', 'rhine', 655, 470],
    ['Pomerania', 'pru', 690, 215], ['Brandenburg', 'pru', 740, 295], ['East Prussia', 'pru', 835, 240], ['Warsaw', 'pru', 845, 345],
    ['Bohemia', 'aus', 765, 465], ['Vienna', 'aus', 855, 480], ['Hungary', 'aus', 945, 525], ['Tyrol', 'aus', 655, 565], ['Illyria', 'aus', 785, 580],
    ['Piedmont', 'ita', 575, 650], ['Venetia', 'ita', 670, 650], ['Rome', 'ita', 690, 740], ['Naples', 'ita', 780, 790],
    ['St Petersburg', 'rus', 965, 80], ['Livonia', 'rus', 905, 175], ['Lithuania', 'rus', 950, 285], ['Smolensk', 'rus', 1060, 225], ['Moscow', 'rus', 1135, 130], ['Ukraine', 'rus', 1060, 395], ['Crimea', 'rus', 1110, 520],
    ['Serbia', 'ott', 900, 640], ['Wallachia', 'ott', 1000, 600], ['Greece', 'ott', 945, 770], ['Constantinople', 'ott', 1085, 690],
  ],
  sea: [
    ['Ireland', 'Northumbria'], ['Ireland', 'Albion'], ['Ireland', 'Scotland'], ['Scotland', 'Norway'], ['Albion', 'Normandy'], ['Albion', 'Holland'], ['Albion', 'Brittany'],
    ['Northumbria', 'Denmark'], ['Finland', 'St Petersburg'], ['Sweden', 'Livonia'], ['Naples', 'Greece'], ['Crimea', 'Constantinople'], ['Portugal', 'Brittany'],
  ],
  link: [['Moscow', 'St Petersburg'], ['Moscow', 'Livonia'], ['Ukraine', 'Crimea'], ['Ukraine', 'Smolensk'], ['Ukraine', 'Wallachia']],
});

const MARS = build({
  id: 'mars', name: 'Red Planet Colonies', blurb: '33 colonies · 8 regions · maglev and orbital lanes', w: 1300, h: 820, r: 74, landMax: 165, crossLand: true,
  continents: [
    { id: 'oly', name: 'Olympus Rise', bonus: 4, color: '#8a4a30' },
    { id: 'val', name: 'Valles Marineris', bonus: 5, color: '#7a3a2a' },
    { id: 'pol', name: 'Boreal Cap', bonus: 3, color: '#8a8a94' },
    { id: 'hel', name: 'Hellas Basin', bonus: 3, color: '#9a6a3a' },
    { id: 'ely', name: 'Elysium', bonus: 3, color: '#6e4a33' },
    { id: 'uto', name: 'Utopia Plain', bonus: 2, color: '#a0703c' },
    { id: 'sou', name: 'Southern Highlands', bonus: 4, color: '#6b5040' },
    { id: 'moon', name: 'The Moons', bonus: 2, color: '#5a5a66' },
  ],
  t: [
    ['Olympus Mons', 'oly', 190, 220], ['Pavonis Dome', 'oly', 300, 175], ['Tharsis Ridge', 'oly', 300, 290], ['Arsia Station', 'oly', 195, 340], ['Ascraeus Base', 'oly', 405, 245],
    ['Candor Deep', 'val', 600, 310], ['Noctis Labyrinth', 'val', 505, 370], ['Melas Chasma', 'val', 610, 410], ['Ius Canyon', 'val', 520, 470], ['Coprates', 'val', 710, 420], ['Eos Gorge', 'val', 805, 465],
    ['Frostgate', 'pol', 500, 110], ['Boreal Ice', 'pol', 605, 85], ['Ice Mine 7', 'pol', 700, 125], ['Planum Rig', 'pol', 800, 85],
    ['Hellas Floor', 'hel', 900, 640], ['Rim Colony', 'hel', 1000, 580], ['Dust Harbor', 'hel', 820, 715], ['Amphitrites', 'hel', 980, 720],
    ['Cerberus Fossae', 'ely', 985, 335], ['Elysium Prime', 'ely', 1060, 250], ['Hecates Tholus', 'ely', 1165, 205], ['Albor Works', 'ely', 1150, 330],
    ['Nilosyrtis', 'uto', 880, 220], ['Utopia Gate', 'uto', 960, 130], ['Viking Landing', 'uto', 1075, 115],
    ['Sirenum', 'sou', 220, 560], ['Argyre Port', 'sou', 310, 680], ['Noachis', 'sou', 410, 600], ['Terra Sabaea', 'sou', 550, 625], ['Cimmeria', 'sou', 560, 730],
    ['Phobos Station', 'moon', 1215, 590], ['Deimos Station', 'moon', 1215, 725],
  ],
  sea: [
    ['Rim Colony', 'Phobos Station'], ['Amphitrites', 'Deimos Station'], ['Phobos Station', 'Deimos Station'], ['Albor Works', 'Phobos Station'],
    ['Planum Rig', 'Utopia Gate'], ['Arsia Station', 'Sirenum'], ['Ius Canyon', 'Noachis'], ['Eos Gorge', 'Hellas Floor'], ['Terra Sabaea', 'Dust Harbor'],
    ['Frostgate', 'Ascraeus Base'], ['Coprates', 'Cerberus Fossae'],
  ],
  link: [['Cimmeria', 'Argyre Port'], ['Cimmeria', 'Noachis']],
});

const ISLES = build({
  id: 'isles', name: 'Shattered Isles', blurb: '32 territories · 8 islands · sea lanes only between isles', w: 1300, h: 880, r: 60, landMax: 118, crossLand: false,
  continents: [
    { id: 'drag', name: 'Dragonspine', bonus: 4, color: '#6e4a33' },
    { id: 'mist', name: 'Mistmere', bonus: 3, color: '#4f6670' },
    { id: 'crown', name: 'Saltcrown', bonus: 5, color: '#6b6a3c' },
    { id: 'thorn', name: 'Thornholm', bonus: 2, color: '#4e6b3f' },
    { id: 'ember', name: 'Emberreach', bonus: 3, color: '#7a3a2a' },
    { id: 'frost', name: 'Frosthaven', bonus: 2, color: '#6a7a8a' },
    { id: 'kraken', name: 'Kraken Reach', bonus: 2, color: '#3f5f55' },
    { id: 'moon', name: 'Moonfall Atoll', bonus: 2, color: '#5a4f66' },
  ],
  t: [
    ['Wyrmcrag', 'drag', 160, 150], ['Ashpeak', 'drag', 260, 125], ['Scale Bay', 'drag', 335, 205], ['Hoard Hollow', 'drag', 235, 235], ['Cinder Coast', 'drag', 140, 260], ['Dragonmaw', 'drag', 300, 305],
    ['Fogwatch', 'mist', 560, 105], ['Lantern Isle', 'mist', 665, 95], ['Wraithwood', 'mist', 600, 200], ['Grey Harbor', 'mist', 705, 190],
    ['Wreck Point', 'crown', 650, 360], ['Tidewall', 'crown', 555, 425], ['Crown Keep', 'crown', 650, 445], ['Sunreach', 'crown', 745, 420], ['Gull Market', 'crown', 600, 530], ['Coral Steps', 'crown', 705, 530],
    ['Bramble', 'thorn', 950, 140], ['Hedgerow', 'thorn', 1055, 150], ['Rosegate', 'thorn', 1000, 240],
    ['Lava Fields', 'ember', 1000, 470], ['Obsidian Shore', 'ember', 1100, 450], ['Smoke Vent', 'ember', 1045, 560], ['Pyre Isle', 'ember', 1150, 550],
    ['Iceberg Row', 'frost', 170, 600], ['Frost Keep', 'frost', 275, 590], ['Whale Road', 'frost', 225, 690],
    ['Inkwell', 'kraken', 455, 715], ['Tentacle Rocks', 'kraken', 560, 700], ['Sunken Temple', 'kraken', 505, 805],
    ['Moonfall', 'moon', 880, 745], ['Silver Lagoon', 'moon', 985, 770], ['Star Reef', 'moon', 920, 840],
  ],
  sea: [
    ['Scale Bay', 'Fogwatch'], ['Dragonmaw', 'Tidewall'], ['Cinder Coast', 'Iceberg Row'], ['Grey Harbor', 'Bramble'], ['Wreck Point', 'Wraithwood'],
    ['Sunreach', 'Lava Fields'], ['Rosegate', 'Obsidian Shore'], ['Gull Market', 'Tentacle Rocks'], ['Frost Keep', 'Inkwell'], ['Sunken Temple', 'Moonfall'],
    ['Smoke Vent', 'Silver Lagoon'], ['Coral Steps', 'Moonfall'], ['Rosegate', 'Sunreach'], ['Dragonmaw', 'Frost Keep'],
  ],
});

export const CQ_MAPS: CqMap[] = [CHUD, WORLD, EUROPE, MARS, ISLES];
export const DEFAULT_MAP = 'chud';
export const mapById = (id: string | undefined): CqMap => CQ_MAPS.find((m) => m.id === id) ?? CHUD;
