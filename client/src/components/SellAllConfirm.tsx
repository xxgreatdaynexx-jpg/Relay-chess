import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/** Confirmation for bulk 'Sell all' (request #39). Esc / backdrop / Cancel close it. */
export function SellAllConfirm({ text, onCancel, onConfirm, title = 'Sell all?' }: { text: string; onCancel: () => void; onConfirm: () => void; title?: string }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onCancel]);
  return createPortal(
    <div className="sellall-backdrop" onClick={onCancel} data-testid="sellall-confirm">
      <div className="sellall-card" role="alertdialog" aria-modal="true" aria-labelledby="sellall-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="sellall-title">💰 {title}</h3>
        <p data-testid="sellall-text">{text}</p>
        <div className="sellall-btns">
          <button type="button" onClick={onCancel} data-testid="sellall-cancel">Cancel</button>
          <button type="button" autoFocus className="ok" onClick={onConfirm} data-testid="sellall-ok">Confirm</button>
        </div>
      </div>
    </div>, document.body);
}
