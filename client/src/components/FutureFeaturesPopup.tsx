import { usePanelDrag } from '@/lib/panelDrag';
import { FUTURE_FEATURES_BODY, FUTURE_FEATURES_KICKER, FUTURE_FEATURES_SHOTS, FUTURE_FEATURES_TITLE } from '../../../shared/futureFeatures';

export function FutureFeaturesPopup({ onClose }: { onClose: () => void }) {
  const drag = usePanelDrag('future');
  return (
    <div className="ff-overlay" data-testid="future-features">
      <div className="ff-card" role="dialog" aria-labelledby="ff-title" data-drag-panel="future" ref={drag.ref} style={drag.style()} onPointerDown={drag.onPointerDown}>
        <button type="button" className="ff-x" onClick={onClose} aria-label="Close">✕</button>
        <p className="ff-kicker">{FUTURE_FEATURES_KICKER}</p>
        <h2 id="ff-title">{FUTURE_FEATURES_TITLE}</h2>
        {FUTURE_FEATURES_BODY.map((p) => <p key={p}>{p}</p>)}
        <div className="ff-shots">
          {FUTURE_FEATURES_SHOTS.map((s) => (
            <figure key={s.id} data-testid={`ff-shot-${s.id}`}>
              <img src={`/future-features/${s.id}.png`} alt={s.title} />
              <figcaption><b>{s.title}</b><span>{s.caption}</span></figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
