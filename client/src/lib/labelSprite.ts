/** Crisp, non-glowing building labels for the 3D city and resort.
 * - Canvas drawn at 2-3x (by devicePixelRatio), mipmapped + trilinear + anisotropic, premultiplied alpha: no jaggies when shrunk.
 * - Moderate colours, thin dim border, no canvas shadow glow; materials are toneMapped:false so they render at the drawn colour.
 * - Floating label sprites live on LABEL_LAYER and are drawn after bloom (renderScene), so they are never bloomed. */
import * as THREE from 'three';

export const LABEL_LAYER = 2;
/** Text / border colours stay below this linear luminance, so even boards inside the bloom pass never cross its threshold (0.82+). */
export const LABEL_MAX_LUMA = 0.75;
export const LABEL_TEXT = '#dcd8e6';

export function labelScaleFor(dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1): number {
  return Math.min(3, Math.max(2, Math.ceil(dpr)));
}

/** Mixes a #rrggbb toward grey and caps brightness so the border reads as dimmed neon. */
export function dimColor(hex: string, k = 0.7): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16); if (!Number.isFinite(n)) return '#9a96a8';
  const ch = (s: number) => Math.round(((n >> s) & 255) * k + 0x60 * (1 - k) * 0.6);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

export function finishLabelTexture(c: HTMLCanvasElement, renderer?: THREE.WebGLRenderer | null): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  t.premultiplyAlpha = true; t.needsUpdate = true;
  return t;
}

export interface LabelStyle { bg: string | CanvasGradient | ((g: CanvasRenderingContext2D, h: number) => string | CanvasGradient); border: string; text: string; sub?: string; font?: string; radius?: number }
const LABEL_FONT = 'Outfit Variable, system-ui, sans-serif';
let measureCtx: CanvasRenderingContext2D | null = null;
/** Logical label width (512-unit canvas space) that fits the full title and subtitle: never ellipsised or squeezed. */
export function labelWidthFor(text: string, sub?: string, font = LABEL_FONT, measure?: (t: string, f: string) => number): number {
  const m = measure ?? ((t: string, f: string) => { measureCtx ??= document.createElement('canvas').getContext('2d'); if (!measureCtx) return t.length * 34; measureCtx.font = f; return measureCtx.measureText(t).width; });
  const w = Math.max(m(text, `800 60px ${font}`), sub ? m(sub, `600 32px ${LABEL_FONT}`) : 0);
  return Math.max(512, Math.ceil(w + 84));
}
/** Draws a label at labelScaleFor() resolution: 128 (or 192 with a subtitle) logical units tall. With fit=false it is a fixed
 *  512 wide (for signs painted on fixed-size panels; long text is scaled down to fit, never cut); fit=true sizes the pill to
 *  its text, so floating sprites always show the whole name (use fitLabel() to scale the sprite to the texture's aspect). */
export function drawLabel(text: string, style: LabelStyle, sub?: string, renderer?: THREE.WebGLRenderer | null, s = labelScaleFor(), fit = false): THREE.CanvasTexture {
  const h = sub ? 192 : 128; const W = fit ? labelWidthFor(text, sub, style.font) : 512; const c = document.createElement('canvas'); c.width = W * s; c.height = h * s;
  const g = c.getContext('2d')!; g.scale(s, s); g.imageSmoothingEnabled = true;
  g.fillStyle = typeof style.bg === 'function' ? style.bg(g, h) : style.bg;
  g.beginPath(); g.roundRect(8, 8, W - 16, h - 16, style.radius ?? 26); g.fill();
  g.strokeStyle = style.border; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke();
  g.font = `800 60px ${style.font ?? LABEL_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = style.text; g.fillText(text, W / 2, sub ? 74 : 66, W - 42);
  if (sub) { g.font = `600 32px ${LABEL_FONT}`; g.fillStyle = style.sub ?? style.border; g.fillText(sub, W / 2, 142, W - 42); }
  const t = finishLabelTexture(c, renderer); t.userData = { w: W / 512, h: h / 128 }; return t;
}
/** The one map-label look (Chud City): dark pill, dimmed-neon border, light text. Resort, Fort McChud, ports and mines all use it. */
export function cityLabel(text: string, color: string, sub?: string, renderer?: THREE.WebGLRenderer | null, fit = true): THREE.CanvasTexture {
  return drawLabel(text, { bg: 'rgba(10,8,22,0.82)', border: dimColor(color, 0.6), text: LABEL_TEXT, sub: dimColor(color, 0.8) }, sub, renderer, undefined, fit);
}
/** Scales a label sprite so its height is k/4 per 128 units and its width follows the texture (no stretching). */
export function fitLabel(s: THREE.Sprite, k: number): void {
  const d = (s.material.map?.userData ?? {}) as { w?: number; h?: number }; s.scale.set(k * (d.w ?? 1), (k / 4) * (d.h ?? 1), 1);
}

export function labelMaterial(map: THREE.Texture, extra: THREE.SpriteMaterialParameters = {}): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({ map, transparent: true, premultipliedAlpha: true, toneMapped: false, depthWrite: false, ...extra });
}

/** Puts a sprite on the label layer only (rendered after bloom); raycasters must enable LABEL_LAYER. */
export function asLabel<T extends THREE.Object3D>(o: T): T { o.layers.set(LABEL_LAYER); return o; }

/** Bloomed scene without labels, then labels on top (depth cleared: labels float above everything they name). */
export function renderScene(renderer: THREE.WebGLRenderer, composer: { render: () => void } | null, scene: THREE.Scene, camera: THREE.Camera): void {
  camera.layers.disable(LABEL_LAYER);
  if (composer) composer.render(); else renderer.render(scene, camera);
  const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth();
  const bg = scene.background; scene.background = null;
  camera.layers.set(LABEL_LAYER); renderer.render(scene, camera);
  scene.background = bg; renderer.autoClear = ac; camera.layers.set(0); camera.layers.disable(LABEL_LAYER);
}
