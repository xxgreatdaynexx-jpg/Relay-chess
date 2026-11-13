import { useState } from 'react';
import { type MissionDef, MISSION_MAX_ACTIVE as MAX_ACTIVE } from '../../../shared/spaceMissions';
import { designCost, courierI, scoutI } from '../../../shared/spaceParts';
import { fmtDv } from '../../../shared/spaceFlight';

export interface ContractRowView {
  id?: string;
  missionId: string;
  acceptedAt: number;
  completedAt: number | null;
  payout: number;
  launchId?: string | null;
}

export interface MissionViewData {
  day: string;
  board: MissionDef[];
  accepted: ContractRowView[];
  completedIds: string[];
  paidToday: number;
  dailyCap: number;
  remainingCap: number;
  maxActive: number;
}

export interface MissionCompleteNote {
  mission: MissionDef;
  payout: number;
  want?: number;
  capped?: boolean;
}

export function SpaceContracts({
  missions, signedIn, chips, busy, designCostOf,
  onAccept, onFly, complete, onDismissComplete, previewSelect,
}: {
  missions: MissionViewData;
  signedIn: boolean;
  chips: number | null;
  busy?: boolean;
  designCostOf?: { courier: number; scout: number };
  onAccept: (id: string) => void;
  onFly: (m: MissionDef) => void;
  complete?: MissionCompleteNote | null;
  onDismissComplete?: () => void;
  previewSelect?: string;
}) {
  const costs = designCostOf ?? { courier: designCost(courierI()), scout: designCost(scoutI()) };
  const initial = previewSelect
    ?? complete?.mission.id
    ?? missions.board[0]?.id
    ?? null;
  const [sel, setSel] = useState<string | null>(initial);
  const m = missions.board.find((x) => x.id === sel) ?? missions.board[0] ?? null;
  const acceptedOf = (id: string) => missions.accepted.find((c) => c.missionId === id);
  const activeCount = missions.accepted.filter((c) => !c.completedAt).length;
  const capPct = missions.dailyCap > 0 ? Math.min(100, (missions.paidToday / missions.dailyCap) * 100) : 0;

  return (
    <div className="spc-body spc-contracts" data-testid="spc-contracts">
      <aside className="spc-col spc-con-list">
        <section className="spc-panel">
          <h2>Today’s board · {missions.day} UTC</h2>
          <p className="spc-con-cap">
            Daily contract purse
            <b>🪙 {missions.paidToday.toLocaleString('en-US')} / {missions.dailyCap.toLocaleString('en-US')}</b>
          </p>
          <div className="spc-con-meter" aria-hidden>
            <i style={{ width: `${capPct}%` }} />
          </div>
          <p className="spc-con-cap sub">
            Open slots {activeCount} / {missions.maxActive || MAX_ACTIVE}
            {chips != null ? ` · Your chips 🪙 ${chips.toLocaleString('en-US')}` : ''}
          </p>
          <div className="spc-list">
            {missions.board.map((c) => {
              const acc = acceptedOf(c.id);
              const done = !!acc?.completedAt || missions.completedIds.includes(c.id);
              const open = acc && !acc.completedAt;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={'spc-card spc-con-card' + (c.id === m?.id ? ' on' : '') + (done ? ' done' : '') + (open ? ' open' : '')}
                  onClick={() => setSel(c.id)}
                  data-testid={`spc-contract-${c.templateId}`}
                >
                  <span className="spc-con-kind">{labelKind(c.kind)}</span>
                  <b>{c.title}</b>
                  <small>{c.agency} · {c.code}</small>
                  <span className="spc-con-pay">🪙 {c.payout.toLocaleString('en-US')}</span>
                  {done && <em className="tag">Fulfilled</em>}
                  {open && <em className="tag open">Accepted</em>}
                </button>
              );
            })}
          </div>
          <p className="spc-help-block">
            The lifetime satellite bounty (🪙 {/* shown by hangar */}400, five times) is separate and still pays on a qualifying deploy. Contract payouts come from this daily purse and do not count against that cap.
          </p>
        </section>
      </aside>
      <div className="spc-col spc-con-brief-col">
        {m && (
          <Briefing
            m={m}
            acc={acceptedOf(m.id)}
            done={!!acceptedOf(m.id)?.completedAt || missions.completedIds.includes(m.id)}
            signedIn={signedIn}
            busy={!!busy}
            activeCount={activeCount}
            maxActive={missions.maxActive || MAX_ACTIVE}
            remainingCap={missions.remainingCap}
            costs={costs}
            onAccept={() => onAccept(m.id)}
            onFly={() => onFly(m)}
          />
        )}
      </div>
      {complete && (
        <CompleteStamp note={complete} onDismiss={onDismissComplete} />
      )}
    </div>
  );
}

function labelKind(k: MissionDef['kind']): string {
  switch (k) {
    case 'reach-space': return 'Sounding';
    case 'reach-orbit': return 'Orbit';
    case 'circular': return 'Circular';
    case 'deploy-orbit': return 'Deploy';
    case 'multi-sat': return 'Multi-sat';
    case 'budget-orbit': return 'Budget';
    default: return k;
  }
}

function Briefing({ m, acc, done, signedIn, busy, activeCount, maxActive, remainingCap, costs, onAccept, onFly }: {
  m: MissionDef; acc?: ContractRowView; done: boolean;
  signedIn: boolean; busy: boolean; activeCount: number; maxActive: number;
  remainingCap: number;
  costs: { courier: number; scout: number };
  onAccept: () => void; onFly: () => void;
}) {
  const open = acc && !acc.completedAt;
  const netCourier = m.maxCost != null ? m.payout - costs.scout : m.payout - costs.courier;
  const netScout = m.payout - costs.scout;
  return (
    <article className="spc-briefing" data-testid="spc-briefing">
      <header>
        <div className="spc-brief-agency">{m.agency}</div>
        <div className="spc-brief-code">{m.code}</div>
        <div className="spc-brief-class">Unclassified · Flight operations</div>
      </header>
      <h1>{m.title}</h1>
      <p className="lead">{m.briefing}</p>
      <h2>Success criteria</h2>
      <ul>
        {m.success.map((s) => <li key={s}>{s}</li>)}
      </ul>
      <dl className="spc-brief-meta">
        <div><dt>Recommended Δv</dt><dd>{fmtDv(m.minDv)}</dd></div>
        <div><dt>Advance (payout)</dt><dd>🪙 {m.payout.toLocaleString('en-US')}</dd></div>
        <div><dt>Net vs Courier I</dt><dd>{m.maxCost ? '— (budget class)' : `≈ 🪙 ${netCourier.toLocaleString('en-US')}`}</dd></div>
        <div><dt>Net vs Scout I</dt><dd>≈ 🪙 {netScout.toLocaleString('en-US')}</dd></div>
        {m.maxCost != null && <div><dt>Cost cap</dt><dd>under 🪙 {m.maxCost.toLocaleString('en-US')}</dd></div>}
        {m.satCount != null && m.satCount > 0 && <div><dt>Payloads</dt><dd>{m.satCount}</dd></div>}
      </dl>
      <p className="spc-brief-note">
        Payouts are settled against a paid launch ticket filed on this contract, and only if the flight
        and the design’s vacuum Δv could have reached the target (vis-viva / Hohmann). The daily purse
        remaining today is 🪙 {remainingCap.toLocaleString('en-US')}
        {remainingCap < m.payout ? ' — a claim now would be partial or withheld at the cap.' : '.'}
      </p>
      <footer className="spc-foot">
        {!signedIn && <span className="spc-help-block">Sign in to accept a contract.</span>}
        {signedIn && !open && !done && (
          <button type="button" className="spc-btn primary" disabled={busy || activeCount >= maxActive} onClick={onAccept} data-testid="spc-accept">
            Accept contract
          </button>
        )}
        {open && (
          <button type="button" className="spc-btn primary" onClick={onFly} data-testid="spc-fly-contract">
            Fly this contract
          </button>
        )}
        {done && <span className="spc-fulfilled-label">Contract fulfilled today.</span>}
      </footer>
    </article>
  );
}

function CompleteStamp({ note, onDismiss }: { note: MissionCompleteNote; onDismiss?: () => void }) {
  return (
    <div className="spc-complete" role="status" data-testid="spc-mission-complete">
      <div className="spc-complete-card">
        <div className="spc-stamp">Fulfilled</div>
        <div className="spc-brief-agency">{note.mission.agency}</div>
        <div className="spc-brief-code">{note.mission.code}</div>
        <h1>{note.mission.title}</h1>
        <p className="lead">Mission Control confirms the contracted objective. The advance has been transferred.</p>
        <p className="spc-complete-pay">
          🪙 {note.payout.toLocaleString('en-US')}
          {note.capped && note.want != null && note.want > note.payout ? (
            <small>Partial — daily cap applied (contract was 🪙 {note.want.toLocaleString('en-US')}).</small>
          ) : (
            <small>Contract payout, separate from the satellite bounty.</small>
          )}
        </p>
        {onDismiss && <button type="button" className="spc-btn primary" onClick={onDismiss}>Close briefing</button>}
      </div>
    </div>
  );
}

