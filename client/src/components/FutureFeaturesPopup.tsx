import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { backdropDismiss, closeButton } from '@/lib/backdrop';
import {
  FUTURE_FEATURES_BURST, FUTURE_FEATURES_OK, FUTURE_FEATURES_SHOTS,
  FUTURE_FEATURES_SUBTITLE, FUTURE_FEATURES_TITLE,
} from '../../../shared/futureFeatures';

/** Same look and feel as the Millionaire Update launch popup, but no date and no countdown. */
export function FutureFeaturesPopup({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="launch-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="ff-title" data-testid="future-features" {...backdropDismiss(onClose)}>
      <div className="launch-card ff-card">
        <button type="button" className="launch-x" aria-label="Close" data-testid="ff-close" {...closeButton(onClose)}>✕</button>
        <div className="launch-burst">{FUTURE_FEATURES_BURST}</div>
        <h2 id="ff-title" className="launch-title">{FUTURE_FEATURES_TITLE}</h2>
        <p className="launch-sub">{FUTURE_FEATURES_SUBTITLE}</p>
        <ul className="launch-list ff-shots">
          {FUTURE_FEATURES_SHOTS.map((s) => (
            <li key={s.id} data-testid={`ff-shot-${s.id}`}>
              <img src={`/future-features/${s.id}.png`} alt={s.title} />
              <div className="ff-shot-copy">
                <span className="launch-ico">{s.icon}</span>
                <div><b>{s.title}</b><span>{s.caption}</span></div>
              </div>
            </li>
          ))}
        </ul>
        <div className="launch-nav">
          <span />
          <button type="button" autoFocus className="launch-ok" onClick={onClose} data-testid="ff-ok">{FUTURE_FEATURES_OK}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
