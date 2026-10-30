/** Original Napoleonic line-infantry silhouette (shako with plume, tailed coat, crossbelts, shouldered musket with bayonet), 100×100 units. */
export const SOLDIER_FILL = [
  'M39 5.5 L57 5.5 L55 18.5 L41 18.5 Z', // shako (flared top)
  'M40.5 18 L55.5 18 L59 21.5 L41 21.5 Z', // peak
  'M46.5 6 C45 2.5 46.5 -0.5 48 -0.5 C49.5 -0.5 51 2.5 49.5 6 Z', // plume
  'M42.5 21 L53.5 21 C53.5 27.5 51.5 31 48 31 C44.5 31 42.5 27.5 42.5 21 Z', // face
  'M43 30 L53 30 L54 36 L42 36 Z', // collar
  'M32 37 Q48 31 64 37 L61 59 L35 59 Z', // coat body
  'M28.5 37 C29 34 34 33.5 37 35 L35.5 39 C33 39 30 39 28.5 37 Z', // epaulette L
  'M67.5 37 C67 34 62 33.5 59 35 L60.5 39 C63 39 66 39 67.5 37 Z', // epaulette R
  'M37 57 L31 77 L40 74.5 L44 59 Z', // tail L
  'M59 57 L65 77 L56 74.5 L52 59 Z', // tail R
  'M37.5 58 L36.5 92 L45.5 92 L47.2 67 L48.8 67 L50.5 92 L59.5 92 L58.5 58 Z', // trousers
  'M33.5 91 L46 91 L46.5 97 L32 97 Z', // shoe L
  'M50 91 L62.5 91 L64 97 L49.5 97 Z', // shoe R
  'M32.5 37 L37 39 L33.5 58 L29 57 Z', // arm L
  'M28.5 56 C28.5 53.5 33.5 53.5 33.5 56.5 C33.5 59 28.5 59 28.5 56 Z', // hand L
  'M61 37 L65.5 38 L68.5 56 L63.5 57.5 Z', // arm R (to the musket butt)
  'M66.2 14 L69.2 14 L69.2 58 L66.2 58 Z', // barrel
  'M65.5 56 L70.5 56 L72 69 L64.5 67 Z', // stock
  'M67 14.5 L68.6 14.5 L68.2 0 Z', // bayonet
];
/** Cut-outs drawn in the background colour: crossbelts and the coat opening. [x1,y1,x2,y2,width] */
export const SOLDIER_CUT: Array<[number, number, number, number, number]> = [
  [35, 37.5, 58.5, 57.5, 2.4],
  [61, 37.5, 37.5, 57.5, 2.4],
  [38, 59.5, 58, 59.5, 1.6],
  [41.5, 18.6, 55, 18.6, 1.1], // shako band
];
export function drawSoldier(g: CanvasRenderingContext2D, s: number): void {
  g.save();
  g.scale(s / 100, s / 100);
  for (const d of SOLDIER_FILL) g.fill(new Path2D(d));
  g.globalCompositeOperation = 'destination-out';
  g.lineCap = 'round';
  for (const [a, b, c, d, w] of SOLDIER_CUT) { g.lineWidth = w; g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); }
  g.restore();
}
