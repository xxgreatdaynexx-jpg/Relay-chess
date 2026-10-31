import { useEffect, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { getVolume, isMuted, setMuted, setVolume, subscribeVolume } from '@/lib/sounds';

/** Fixed top-right speaker button plus 0–100% slider. Covers every game sound. */
export function VolumeControl() {
  const [volume, setLocalVolume] = useState(getVolume());
  const [muted, setLocalMuted] = useState(isMuted());

  useEffect(
    () =>
      subscribeVolume(() => {
        setLocalVolume(getVolume());
        setLocalMuted(isMuted());
      }),
    [],
  );

  const silent = muted || volume === 0;
  const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const percent = Math.round(volume * 100);

  return (
    <div
      data-testid="volume-control"
      className="group fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-full bg-black/55 px-2.5 py-1.5 text-[#fff6d8] shadow-lg backdrop-blur"
    >
      <button
        type="button"
        aria-label={silent ? 'Unmute sounds' : 'Mute sounds'}
        title={silent ? 'Unmute' : 'Mute'}
        onClick={() => {
          if (silent && volume === 0) setVolume(0.4);
          else setMuted(!muted);
        }}
        className="grid h-6 w-6 place-items-center"
      >
        <Icon className="h-5 w-5" />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={muted ? 0 : percent}
        aria-label="Sound volume"
        onChange={(event) => setVolume(Number(event.target.value) / 100)}
        className="hidden h-1 w-20 cursor-pointer accent-[#e8c26a] group-hover:block group-focus-within:block xl:block xl:w-28"
      />
      <span className="hidden w-8 text-right group-hover:inline group-focus-within:inline xl:inline text-xs tabular-nums">{muted ? 0 : percent}%</span>
    </div>
  );
}
