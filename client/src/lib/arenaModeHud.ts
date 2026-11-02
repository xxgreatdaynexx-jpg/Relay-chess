/** Canvas HUD for the arena team modes (S&D, CTF): team scores, clocks, bomb/flag status and objective markers. */
import { MODE_INFO, TEAM_COLORS, TEAM_NAMES, type ModeView, type TeamId } from '../../../shared/arenaModes';

type Proj = (x: number, y: number, z: number) => { sx: number; sy: number; dist: number } | null;
export const clockOf = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** The status line under the scores, from the viewer's side (pure: unit tested). */
export function modeStatus(mv: ModeView, myId: string, names: (id: string) => string): { line: string; hint: string } {
  const mine = mv.tm?.[myId];
  if (mv.snd) {
    const s = mv.snd; const b = s.bomb;
    const att = mine === s.attackers;
    const role = mine === undefined ? '' : att ? 'ATTACK' : 'DEFEND';
    const bomb = b.state === 'planted' ? `BOMB PLANTED ${b.site ?? ''} · ${clockOf(b.left ?? 0)}`
      : b.state === 'carried' ? (b.carrier === myId ? 'YOU HAVE THE BOMB' : b.carrier ? `BOMB: ${names(b.carrier)}` : 'BOMB: CARRIED')
      : b.state === 'dropped' ? 'BOMB DROPPED' : b.state === 'defused' ? 'BOMB DEFUSED' : b.state === 'exploded' ? 'BOMB DETONATED' : '';
    const post = s.phase === 'post' && s.lastWinner !== undefined ? `${TEAM_NAMES[s.lastWinner].toUpperCase()} WINS THE ROUND (${s.lastReason})` : '';
    let hint = '';
    if (s.hold?.id === myId) hint = s.hold.kind === 'plant' ? 'PLANTING… stay still' : 'DEFUSING… stay still';
    else if (b.carrier === myId) hint = 'Stand still on site A or B to plant (3 s)';
    else if (b.state === 'planted' && !att && mine !== undefined) hint = 'Stand still on the bomb to defuse (5 s)';
    else if (b.state === 'dropped' && att) hint = 'Pick up the dropped bomb';
    return { line: [`ROUND ${s.round}`, role, post || bomb].filter(Boolean).join(' · '), hint };
  }
  if (mv.ctf) {
    const c = mv.ctf;
    if (mine === undefined) return { line: 'CAPTURE THE FLAG', hint: '' };
    const own = c.flags[mine]; const foe = c.flags[mine === 0 ? 1 : 0];
    const st = (f: typeof own) => f.state === 'home' ? 'home' : f.state === 'carried' ? (f.carrier === myId ? 'YOU' : f.carrier ? names(f.carrier) : 'taken') : `dropped ${clockOf(f.returnIn ?? 0)}`;
    let hint = '';
    if (foe.carrier === myId) hint = own.state === 'home' ? 'Bring the flag to your base!' : 'Your flag must be home to capture';
    else if (own.state === 'dropped') hint = 'Touch your dropped flag to return it';
    return { line: `YOUR FLAG: ${st(own)} · ENEMY FLAG: ${st(foe)}`, hint };
  }
  return { line: '', hint: '' };
}

/** Clock + mode-label layout (pure: unit tested). Digits (cap height ≈ 0.75 em) end at clockBase; the label's top (≈ labelBase − 0.75·labelPx) stays ≥ 2u below them. */
export function clockLayout(u: number) {
  const clockPx = Math.max(8, (8 * u) | 0), labelPx = Math.max(6, (4 * u) | 0);
  const clockBase = Math.round(clockPx * 0.95) + 1;
  const labelBase = clockBase + Math.max(2 * u, 2) + Math.ceil(labelPx * 0.8);
  const boxH = Math.max(14 * u, labelBase + Math.max(2, 1.5 * u));
  return { clockPx, labelPx, clockBase, labelBase, boxH };
}

export function drawModeHud(ctx: CanvasRenderingContext2D, mv: ModeView | null | undefined, o: { myId: string; W: number; H: number; u: number; mono: string; project: Proj; names: (id: string) => string; left: number }): void {
  if (!mv || !mv.teams) return;
  const { W, H, u, mono } = o;
  const mine = mv.tm?.[o.myId];
  // Objective markers (drawn first, under the text).
  const marker = (x: number, y: number, z: number, label: string, color: string, sub = '') => {
    const p = o.project(x, y, z + 1.4);
    if (!p || p.sx < 0 || p.sx > W || p.sy < 0 || p.sy > H) return;
    const r = 7 * u;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, u * 0.8); ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.font = `800 ${(7 * u) | 0}px ${mono}`; ctx.fillText(label, p.sx, p.sy + 2.5 * u);
    ctx.font = `600 ${(5 * u) | 0}px ${mono}`; ctx.fillStyle = '#e6e9df';
    ctx.fillText(`${Math.round(p.dist)}m${sub ? ` ${sub}` : ''}`, p.sx, p.sy + r + 6 * u);
    ctx.globalAlpha = 1;
  };
  if (mv.snd) {
    const s = mv.snd;
    const siteCol = mine === s.attackers ? '#ffd36a' : '#9fd0ff';
    for (const site of s.sites) marker(site.x, site.y, site.z, site.id, s.bomb.site === site.id && s.bomb.state === 'planted' ? '#ff4b3a' : siteCol);
    const b = s.bomb;
    if ((b.state === 'dropped' || b.state === 'planted') && (b.x || b.y)) marker(b.x, b.y, b.z, b.state === 'planted' ? '💣' : '💣', b.state === 'planted' ? '#ff4b3a' : '#ffd36a', b.state === 'planted' ? clockOf(b.left ?? 0) : '');
  }
  if (mv.ctf) {
    const c = mv.ctf;
    c.bases.forEach((b, t) => { if (c.flags[t].state !== 'home') marker(b.x, b.y, b.z, '⌂', TEAM_COLORS[t]); });
    for (const f of c.flags) if (f.carrier !== o.myId) marker(f.x, f.y, f.z, '⚑', TEAM_COLORS[f.team], f.state === 'dropped' ? clockOf(f.returnIn ?? 0) : '');
  }
  // Top centre: team scores and the clock.
  const [s0, s1] = mv.teams.score;
  const cx = W / 2, top = 4 * u, bw = 30 * u, bh = 14 * u;
  ctx.textAlign = 'center';
  const team = (t: TeamId, x: number, score: number) => {
    ctx.fillStyle = TEAM_COLORS[t]; ctx.globalAlpha = mine === t ? 0.95 : 0.7; ctx.fillRect(x, top, bw, bh); ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff'; ctx.font = `800 ${(10 * u) | 0}px ${mono}`; ctx.fillText(String(score), x + bw / 2, top + 10.5 * u);
    ctx.font = `700 ${(4.5 * u) | 0}px ${mono}`; ctx.fillText(`${TEAM_NAMES[t].toUpperCase()}${mine === t ? ' · YOU' : ''} ${mv.teams!.alive[t]}/${mv.teams!.size[t]}`, x + bw / 2, top + bh + 5 * u);
  };
  // Clock box is taller than the team boxes so the mode label sits clearly below the digits (no overlap).
  const L = clockLayout(u);
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(cx - 18 * u, top, 36 * u, L.boxH);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = mv.snd?.bomb.state === 'planted' ? '#ff6b5a' : '#e6e9df'; ctx.font = `800 ${L.clockPx}px ${mono}`;
  ctx.fillText(clockOf(o.left), cx, top + L.clockBase);
  ctx.font = `600 ${L.labelPx}px ${mono}`; ctx.fillStyle = '#a9ae9e'; ctx.fillText(MODE_INFO[mv.mode].short, cx, top + L.labelBase);
  team(0, cx - 18 * u - bw, s0);
  team(1, cx + 18 * u, s1);
  const st = modeStatus(mv, o.myId, o.names);
  const fit = (t: string, px: number) => { ctx.font = `700 ${px | 0}px ${mono}`; const w = ctx.measureText(t).width; if (w > W * 0.6) ctx.font = `700 ${Math.max(7, (px * W * 0.6) / w) | 0}px ${mono}`; };
  if (st.line) { fit(st.line, 6 * u); ctx.fillStyle = 'rgba(0,0,0,.5)'; const w = ctx.measureText(st.line).width + 8 * u; ctx.fillRect(cx - w / 2, top + bh + 7 * u, w, 9 * u); ctx.fillStyle = mv.snd?.bomb.state === 'planted' ? '#ff8a7a' : '#e6e9df'; ctx.fillText(st.line, cx, top + bh + 13.5 * u); }
  if (st.hint) { fit(st.hint, 7 * u); ctx.fillStyle = '#ffd36a'; ctx.fillText(st.hint, cx, H * 0.64); }
  const hold = mv.snd?.hold;
  if (hold && hold.id === o.myId) {
    const w = 80 * u, y = H * 0.67;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(cx - w / 2, y, w, 5 * u);
    ctx.fillStyle = hold.kind === 'plant' ? '#ffd36a' : '#9fd0ff'; ctx.fillRect(cx - w / 2, y, w * hold.pct, 5 * u);
  }
  ctx.textAlign = 'left';
}
