import { useEffect, useState } from 'react';

/** Mounted once in App: the Millionaire Update sign on the city map fires `open-launch-trailer`. Esc / backdrop / ✕ close. */
export default function TrailerPopup() {
  const [open, setOpen] = useState(false);
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const on = () => { setPortrait(window.matchMedia('(orientation: portrait) and (max-width: 820px)').matches); setOpen(true); };
    window.addEventListener('open-launch-trailer', on);
    return () => window.removeEventListener('open-launch-trailer', on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [open]);
  if (!open) return null;
  const src = portrait ? '/trailer/launch-trailer-vertical.mp4' : '/trailer/launch-trailer.mp4';
  const poster = portrait ? '/trailer/launch-trailer-vertical-poster.jpg' : '/trailer/launch-trailer-poster.jpg';
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-3" onClick={() => setOpen(false)} data-testid="trailer-popup">
      <div className="relative w-full" style={{ maxWidth: portrait ? 'min(420px, 100%)' : 'min(1100px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between text-amber-200">
          <b className="text-lg">💰 Millionaire Update · Launch Trailer</b>
          <button type="button" aria-label="Close Launch Trailer" className="rounded-full bg-white/10 px-3 py-1 text-white hover:bg-white/25" onClick={() => setOpen(false)} data-testid="trailer-close">✕</button>
        </div>
        <video key={src} src={src} poster={poster} controls autoPlay playsInline preload="metadata" title="Millionaire Update Launch Trailer" aria-label="Millionaire Update Launch Trailer" className="w-full rounded-lg border border-amber-400/60 bg-black shadow-2xl" style={{ maxHeight: '82vh' }} data-testid="trailer-video" />
      </div>
    </div>
  );
}
