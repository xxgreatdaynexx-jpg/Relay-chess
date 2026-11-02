import { useDoing } from '@/lib/doing';
import { backdropDismiss } from '@/lib/backdrop';
import { CLOSE_WORLD_PANELS, WALLET_CLOSE } from '@/lib/worldPanels';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { TopTab } from './TopTabs';
import { SKILLS, MAX_LEVEL, progress, skillDef, badgeFor, titleFor } from '../../../shared/skills';
import { perkText } from '../../../shared/skillPerks';
import { usePanelDrag } from '@/lib/panelDrag';

export interface SkillRow { id: string; xp: number; level: number; rank: number | null }
export interface SkillProfile { name: string; total: number; title: string; totalXp: number; skills: SkillRow[] }
interface XpEvent { skill: string; gained: number; xp: number; level: number; leveledUp: boolean; total: number }
interface HiRow { rank: number; name: string; level: number; xp: number; title?: string }

const fmt = (n: number) => n.toLocaleString();

/** RuneScape-style grid: icon, level, XP bar; hover/focus shows XP to next level. */
export function SkillGrid({ profile, compact = false }: { profile: SkillProfile; compact?: boolean }) {
  return (
    <div className={`grid gap-1.5 ${compact ? 'grid-cols-3' : 'grid-cols-3'}`} data-testid="skills-grid">
      {profile.skills.map((s) => {
        const d = skillDef(s.id); if (!d) return null;
        const p = progress(s.xp); const perk = perkText(s.id, p.level);
        const tip = `${p.level >= MAX_LEVEL ? `${d.label}: ${fmt(s.xp)} XP (max level)` : `${d.label}: ${fmt(s.xp)} XP · ${fmt(p.toNext)} XP to level ${p.level + 1}${s.rank ? ` · rank #${s.rank}` : ''}`}\n${d.how}${perk ? `\nPerk: ${perk}` : ''}`;
        return (
          <div key={s.id} title={tip} tabIndex={0} data-testid={`skill-${s.id}`}
            className="relative rounded-md border border-[#e8c26a]/30 bg-[#2a2418] px-2 py-1.5 shadow-inner outline-none focus:ring-1 focus:ring-[#e8c26a]">
            <div className="flex items-center gap-1.5">
              <span className={compact ? 'text-base' : 'text-xl'} aria-hidden>{d.icon}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] opacity-80">{d.label}</span>
              <b className="tabular-nums text-[#f5d27a]" style={{ textShadow: "1px 1px 0 #000" }}>{p.level}</b>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-black/50" aria-label={`${Math.round(p.pct * 100)}% to next level`}>
              <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-300" style={{ width: `${Math.round(p.pct * 100)}%` }} />
            </div>
            {!compact && <div className="mt-0.5 text-[10px] opacity-60 tabular-nums">{p.level >= MAX_LEVEL ? 'MAX' : `${fmt(p.toNext)} to ${p.level + 1}`} {badgeFor(p.level)}</div>}
            {!compact && perk && <div className="mt-0.5 text-[10px] leading-tight text-emerald-300/80" data-testid={`skill-perk-${s.id}`}>{perk}</div>}
          </div>
        );
      })}
      <div className="col-span-3 flex items-center justify-between rounded-md border border-[#e8c26a]/40 bg-[#1f1a10] px-2 py-1.5 text-sm" data-testid="skills-total">
        <span>Total level <b className="text-[#f5d27a]">{profile.total}</b> · <span className="opacity-80">{profile.title}</span></span>
        <span className="text-xs opacity-60 tabular-nums">{fmt(profile.totalXp)} XP</span>
      </div>
    </div>
  );
}

function Hiscores() {
  const [skill, setSkill] = useState('overall');
  const [rows, setRows] = useState<HiRow[] | null>(null);
  useEffect(() => { setRows(null); void request('skills_hiscores', { skill }).then((r) => setRows(((r as unknown as { rows?: HiRow[] }).rows) ?? [])); }, [skill]);
  return (
    <div data-testid="skills-hiscores">
      <div className="mb-2 flex flex-wrap gap-1">
        {[{ id: 'overall', label: 'Overall', icon: '🏆' }, ...SKILLS].map((s) => (
          <button key={s.id} type="button" onClick={() => setSkill(s.id)} data-testid={`hiscores-${s.id}`}
            className={`rounded-full px-2 py-0.5 text-xs ${skill === s.id ? 'bg-[#e8c26a] text-[#1b1d2e] font-bold' : 'bg-white/10'}`}>{s.icon} {s.label}</button>
        ))}
      </div>
      {!rows ? <p className="text-sm opacity-60">Loading…</p> : rows.length === 0 ? <p className="text-sm opacity-60">No one has XP here yet. Be the first!</p> : (
        <table className="w-full text-sm tabular-nums">
          <thead><tr className="text-left text-xs opacity-60"><th>#</th><th>Player</th><th className="text-right">{skill === 'overall' ? 'Total' : 'Level'}</th><th className="text-right">XP</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.name} className="border-t border-white/5"><td>{r.rank}</td><td><span className="player-link" data-player={r.name}>{r.name}</span>{r.title && <span className="ml-1 text-xs opacity-50">{r.title}</span>}</td><td className="text-right font-bold text-[#f5d27a]">{r.level}</td><td className="text-right opacity-80">{fmt(r.xp)}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

/** Top-bar Skills tab + window, plus XP drops and level-up fanfare from 'xp' pushes. */
export function SkillsPanel() {
  const dragSkills = usePanelDrag('skills');
  const account = useAccount();
  const [open, setOpen] = useState(false);
  useDoing('skills', null, open);
  const [view, setView] = useState<'me' | 'hi'>('me');
  const [me, setMe] = useState<SkillProfile | null>(null);
  const [drops, setDrops] = useState<Array<{ id: number; text: string }>>([]);
  const [levelUp, setLevelUp] = useState<{ skill: string; level: number } | null>(null);
  const load = () => { void request('skills_get', {}).then((r) => { if (r.ok) setMe(r as unknown as SkillProfile); }); };
  useEffect(() => {
    if (!account) { setMe(null); return; }
    const t = window.setTimeout(load, 900);
    let seq = 0; let luTimer = 0;
    const onXp = (e: XpEvent) => {
      const d = skillDef(e.skill); if (!d) return;
      const id = ++seq;
      setDrops((x) => [...x.slice(-4), { id, text: `${d.icon} +${fmt(e.gained)} ${d.label} XP` }]);
      window.setTimeout(() => setDrops((x) => x.filter((y) => y.id !== id)), 2200);
      setMe((p) => p ? { ...p, total: e.total, title: titleFor(e.total), totalXp: p.totalXp + e.gained, skills: p.skills.map((s) => s.id === e.skill ? { ...s, xp: e.xp, level: e.level } : s) } : p);
      if (e.leveledUp) { setLevelUp({ skill: e.skill, level: e.level }); window.clearTimeout(luTimer); luTimer = window.setTimeout(() => setLevelUp(null), 5000); }
    };
    socket.on('xp', onXp);
    return () => { window.clearTimeout(t); window.clearTimeout(luTimer); socket.off('xp', onXp); };
  }, [account]);
  useEffect(() => { if (open && account) load(); }, [open, account]);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open]); // QA r9: Esc closes Skills
  useEffect(() => { if (open) { window.dispatchEvent(new Event(CLOSE_WORLD_PANELS)); window.dispatchEvent(new Event(WALLET_CLOSE)); } }, [open]); // QA r8: no stale deed/Airport panel behind Skills

  const lu = levelUp && skillDef(levelUp.skill);
  return (
    <>
      <TopTab id="skills"><button type="button" className="sol-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="skills-tab">🧭 Skills{me ? <b className="ml-1 text-[#f5d27a]">{me.total}</b> : null}</button></TopTab>
      {createPortal(
        <div className="pointer-events-none fixed right-4 top-24 z-[60] flex flex-col items-end gap-1" aria-live="polite" data-testid="xp-drops">
          {drops.map((d) => <div key={d.id} className="xp-drop rounded bg-black/70 px-2 py-0.5 text-sm font-bold text-[#f5d27a]" style={{ textShadow: '1px 1px 0 #000', animation: 'xpdrop 2.2s ease-out forwards' }}>{d.text}</div>)}
          <style>{'@keyframes xpdrop{0%{opacity:0;transform:translateY(12px)}15%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0;transform:translateY(-24px)}}@keyframes lvlup{0%{transform:translateX(-50%) scale(.6);opacity:0}20%{transform:translateX(-50%) scale(1.08);opacity:1}30%{transform:translateX(-50%) scale(1)}}'}</style>
        </div>, document.body)}
      {lu && levelUp && createPortal(
        <div role="status" data-testid="level-up-toast" className="fixed left-1/2 top-20 z-[61] rounded-xl border-2 border-[#f5d27a] bg-[#1b1d2e]/95 px-5 py-3 text-center shadow-2xl" style={{ animation: 'lvlup .8s ease-out', transform: 'translateX(-50%)' }}>
          <div className="text-2xl">🎉 {lu.icon}</div>
          <div className="font-bold text-[#f5d27a]">Congratulations, you just advanced a {lu.label} level!</div>
          <div className="text-sm">Your {lu.label} level is now {levelUp.level}. {badgeFor(levelUp.level)}</div>
        </div>, document.body)}
      {open && (
        <div className="inv-backdrop" {...backdropDismiss(() => setOpen(false))}>
          <div className="inv-win" role="dialog" aria-label="Skills" data-testid="skills-panel" style={dragSkills.style({ maxWidth: 520 })} data-drag-panel="skills" onPointerDown={dragSkills.onPointerDown} ref={dragSkills.ref}>{dragSkills.handle}
            <header className="inv-head">
              <h2>🧭 Skills</h2>
              <nav className="inv-tabs" role="tablist">
                {([['me', '📜 My skills'], ['hi', '🏆 Hiscores']] as const).map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)} data-testid={`skills-tab-${k}`}>{t}</button>)}
              </nav>
              <button type="button" className="ml-auto" aria-label="Close skills" onClick={() => setOpen(false)}>✕</button>
            </header>
            <div className="flex-1 overflow-auto p-3 text-sm">
              {view === 'hi' ? <Hiscores /> : !account ? <p>Sign in to start earning XP. Every activity trains a skill: mine ore, run your factory, farm, race, fight in the Arena, trade, play the casino, play chess or buy property.</p>
                : !me ? <p className="opacity-60">Loading…</p> : (
                  <>
                    <SkillGrid profile={me} />
                    <p className="mt-2 text-[11px] opacity-60">Levels 1–99 on the classic RuneScape XP curve. Hover a skill for XP to the next level and how to train it. Titles and badges are cosmetic: skills never change casino odds or payouts.</p>
                  </>
                )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
