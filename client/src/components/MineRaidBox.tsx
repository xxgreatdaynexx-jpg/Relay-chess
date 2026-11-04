import { useEffect, useState } from 'react';
import { socket } from '@/lib/net';
import { ORES, isOre } from '../../../shared/mines';
import { RAID_MAX, type RaidView, type RaidLootMsg } from '../../../shared/mineRaids';

type R = { ok: boolean; error?: string; party?: RaidView | null };
/** 🤝 Raid Party box in the Mines side panel: create a party, share the code, friends join, everyone mines the same instance. */
export function MineRaidBox() {
  const [party, setParty] = useState<RaidView | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const emit = (ev: string, body: object = {}) => socket.timeout(6000).emit(ev, body, (err: Error | null, r?: R) => {
    if (err || !r) { setMsg('The raid board did not answer. Try again.'); return; }
    if (!r.ok) { setMsg(r.error ?? 'Could not do that.'); return; }
    setParty(r.party ?? null); setMsg('');
  });
  useEffect(() => { emit('raid_view'); const on = () => emit('raid_view'); socket.on('raid_changed', on); const t = window.setInterval(on, 5000); return () => { socket.off('raid_changed', on); window.clearInterval(t); }; }, []);
  return (
    <details className="mines-prices mines-tools mines-raid" open data-testid="mines-raid">
      <summary>🤝 Raid Party {party ? `· ${party.size}/${RAID_MAX}` : ''}</summary>
      {!party && <>
        <p className="mines-note" style={{ marginTop: 2 }}>Team up with up to {RAID_MAX} miners in any mine. Creatures scale with your party, every member mines their own veins and gets their own loot, and party bosses roll a bonus pot.</p>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button type="button" data-testid="raid-create" onClick={() => emit('raid_create')}>Start a party</button>
          <input aria-label="Party code" data-testid="raid-code-input" value={code} maxLength={5} placeholder="CODE" onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ width: 70, textTransform: 'uppercase', letterSpacing: 2, background: '#1b1612', color: '#fff', border: '1px solid #6a5a40', borderRadius: 6, padding: '2px 6px' }} />
          <button type="button" data-testid="raid-join" disabled={code.length !== 5} onClick={() => emit('raid_join', { code })}>Join</button>
        </div>
      </>}
      {party && <>
        <div className="mines-tools-now">Code <b data-testid="raid-code" style={{ letterSpacing: 3, color: '#7fe8ff', fontSize: 15 }}>{party.code}</b> · share it with friends</div>
        <ul style={{ margin: '4px 0', padding: 0, listStyle: 'none' }}>
          {party.members.map((m) => <li key={m.name} data-testid="raid-member" style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: m.online ? '#40e070' : '#666' }} />
            <span>{m.name === party.leader ? '👑 ' : ''}{m.name}</span>
            <small style={{ marginLeft: 'auto', opacity: 0.75 }}>{m.online ? `${m.cave === 'fortmc' ? 'Fort McChud' : m.cave ?? ''} · F${m.floor}` : 'not in a mine'}</small>
          </li>)}
        </ul>
        {party.size < 2 && <p className="mines-note">Waiting for a friend to join with the code. You stay in the public mine until they do.</p>}
        {party.size > 1 && <p className="mines-note">Raid instance: creatures ×{(1 + 0.75 * (party.size - 1)).toFixed(2)} HP · your own veins · loot for everyone on the floor · elevator goes as deep as anyone in the party has been.</p>}
        <button type="button" data-testid="raid-leave" onClick={() => emit('raid_leave')}>Leave party</button>
      </>}
      {msg && <p className="mines-note" data-testid="raid-msg">{msg}</p>}
    </details>
  );
}

/** Party-boss group loot roll: everyone's d100, the winner and the bonus pot. */
export function RaidRollBanner({ roll }: { roll: RaidLootMsg }) {
  const top = [...roll.rolls].sort((a, b) => b.roll - a.roll);
  return (
    <div data-testid="mines-raid-roll" style={{ position: 'absolute', left: '50%', top: 110, transform: 'translateX(-50%)', background: 'rgba(6,24,40,0.92)', border: '2px solid #38d8ff', color: '#e4f8ff', padding: '8px 16px', borderRadius: 12, minWidth: 260, pointerEvents: 'none', boxShadow: '0 6px 24px rgba(0,0,0,0.5)' }}>
      <div style={{ fontWeight: 800, fontSize: 16, textAlign: 'center' }}>🎲 Party loot roll · {roll.boss}</div>
      {top.map((r) => <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', fontWeight: r.name === roll.winner ? 800 : 500, color: r.name === roll.winner ? '#ffd860' : undefined }}><span>{r.name === roll.winner ? '🏆 ' : ''}{r.name}</span><b>{r.roll}</b></div>)}
      <div style={{ marginTop: 4, fontSize: 13, textAlign: 'center', opacity: 0.9 }}>{roll.winner ? `${roll.winner} wins ` : ''}{roll.pot.map((s) => `${s.qty} ${isOre(s.id) ? ORES[s.id].name : s.id}`).join(', ') || 'a full backpack (no room)'}</div>
    </div>
  );
}
