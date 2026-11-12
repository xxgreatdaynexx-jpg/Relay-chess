import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { closeButton } from '@/lib/backdrop';

/** Confirmation for bulk 'Sell all' (request #39). Esc / backdrop / Cancel close it. */
export function SellAllConfirm({ text, onCancel, onConfirm, title = 'Sell all?', busy = false, testid = 'sellall' }: { text: string; onCancel: () => void; onConfirm: () => void; title?: string; busy?: boolean; testid?: string }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onCancel, busy]);
  return createPortal(
    <div className="sellall-backdrop" onClick={busy ? undefined : onCancel} data-testid={`${testid}-confirm`}>
      <div className="sellall-card" role="alertdialog" aria-modal="true" aria-labelledby="sellall-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sellall-x modal-shell-x" aria-label="Close" data-testid={`${testid}-close`} disabled={busy} {...(busy ? {} : closeButton(onCancel))}>✕</button>
        <h3 id="sellall-title">💰 {title}</h3>
        <p data-testid={`${testid}-text`}>{text}</p>
        <div className="sellall-btns">
          <button type="button" onClick={onCancel} disabled={busy} data-testid={`${testid}-cancel`}>Cancel</button>
          <button type="button" autoFocus className="ok" onClick={onConfirm} disabled={busy} data-testid={`${testid}-ok`}>Confirm</button>
        </div>
      </div>
    </div>, document.body);
}
