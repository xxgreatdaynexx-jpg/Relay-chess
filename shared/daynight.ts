/**
 * Real-time day/night for the city + outskirts (pt1246u): everyone sees the same sky, driven by the clock in
 * Alberta time (fixed UTC−6, no DST) and the real sun position at Edmonton's latitude/longitude (pt1271u).
 * At 53.5°N the sun never drops below ~−13° in late June (twilight all night) and only reaches ~13° in late December,
 * so every phase/light curve below must work at those extremes. QA can pin the time with ?tod=HH:MM (Alberta wall clock).
 */
export const EDMONTON = { lat: 53.55, lng: -113.49 }; // sun position only; the clock is ALBERTA_OFFSET
/** Alberta time: constant UTC−6 offset in minutes, summer and winter. */
export const ALBERTA_OFFSET = -360;
export type Phase = 'night' | 'dawn' | 'golden-am' | 'day' | 'golden-pm' | 'dusk';
export interface Sky {
  phase: Phase; label: string; icon: string;
  minutes: number; // Alberta wall-clock minutes since midnight
  sunrise: number; sunset: number; // Alberta wall-clock minutes
  elev: number; az: number; // sun elevation / azimuth in degrees (az: 0 = north, 90 = east)
  day: number; // 0 night → 1 full day (light level)
  warm: number; // 0..1 how golden/orange the light is (dawn, golden hour, dusk)
  lights: number; // 0..1 neon / street lamps / windows (on at dusk, off after dawn)
  stars: number; // 0..1
  sky: number; horizon: number; fog: number; // hex colours
  hemiSky: number; hemiGround: number; hemiI: number;
  sunColor: number; sunI: number; moonI: number; exposure: number;
}

const rad = Math.PI / 180;
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mix = (c1: number, c2: number, t: number) => {
  const r = Math.round(lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t)), g = Math.round(lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t)), b = Math.round(lerp(c1 & 255, c2 & 255, t));
  return (r << 16) | (g << 8) | b;
};
export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Alberta wall clock for a UTC instant: minutes since midnight, day of year, and UTC offset in minutes (always −360). */
export function albertaClock(d: Date) {
  // Alberta time = fixed UTC−6 all year, no DST (Dayne pt1271u). Deliberately not Intl/IANA: tz data may still apply DST.
  const w = new Date(d.getTime() + ALBERTA_OFFSET * 60000);
  const doy = Math.floor((Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()) - Date.UTC(w.getUTCFullYear(), 0, 0)) / 86400000);
  return { minutes: w.getUTCHours() * 60 + w.getUTCMinutes() + w.getUTCSeconds() / 60 + w.getUTCMilliseconds() / 60000, doy, offset: ALBERTA_OFFSET };
}

/** Parse a QA override like "06:30" / "6:30" / "19" → minutes, else null. */
export function parseTod(s: string | null | undefined): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec((s || '').trim()); if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] || 0); if (h > 23 || mi > 59) return null; return h * 60 + mi;
}

function solar(doy: number) {
  const g = (2 * Math.PI / 365) * (doy - 1);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  return { eot, decl };
}

/** Sun elevation/azimuth (degrees) at Edmonton for an Alberta wall-clock time. */
export function sunAt(minutes: number, doy: number, offset: number) {
  const { eot, decl } = solar(doy); const lat = EDMONTON.lat * rad;
  const tst = minutes - offset + 4 * EDMONTON.lng + eot; // true solar time (UTC minutes + longitude + equation of time)
  const ha = (tst / 4 - 180) * rad;
  const sinE = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const elev = Math.asin(clamp(sinE, -1, 1));
  const cosAz = (Math.sin(decl) - Math.sin(elev) * Math.sin(lat)) / (Math.cos(elev) * Math.cos(lat));
  let az = Math.acos(clamp(cosAz, -1, 1)) / rad; if (Math.sin(ha) > 0) az = 360 - az;
  // sunrise/sunset (−0.833° for refraction + disc)
  const cosH0 = (Math.sin(-0.833 * rad) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl));
  const h0 = Math.acos(clamp(cosH0, -1, 1)) / rad;
  const noon = 720 - 4 * EDMONTON.lng - eot + offset;
  return { elev: elev / rad, az, sunrise: noon - 4 * h0, sunset: noon + 4 * h0 };
}

const NIGHT_SKY = 0x070a1c, TWI_SKY = 0x2a2a5a, DAY_SKY = 0x6fb2ee, HZ_NIGHT = 0x1a1f4a, HZ_WARM = 0xff9a5c, HZ_DAY = 0xcfe6ff;

export function skyAt(minutes: number, doy: number, offset: number): Sky {
  const { elev, az, sunrise, sunset } = sunAt(minutes, doy, offset);
  const am = minutes < (sunrise + sunset) / 2;
  const day = smooth(-6, 10, elev);
  const warm = clamp(1 - Math.abs(elev - 2) / 12) * (1 - smooth(-10, -4, -elev) * 0) * smooth(-10, -2, elev);
  const lights = 1 - smooth(-3, 6, elev); // on before sunset, off a little after sunrise
  const stars = 1 - smooth(-12, -3, elev);
  const phase: Phase = elev < -10 ? 'night' : elev < 0 ? (am ? 'dawn' : 'dusk') : elev < 10 ? (am ? 'golden-am' : 'golden-pm') : 'day';
  const LABEL: Record<Phase, [string, string]> = { night: ['Night', '🌙'], dawn: ['Dawn', '🌅'], 'golden-am': ['Morning', '🌄'], day: ['Day', '☀️'], 'golden-pm': ['Golden hour', '🌇'], dusk: ['Dusk', '🌆'] };
  const base = mix(mix(NIGHT_SKY, TWI_SKY, smooth(-14, -4, elev)), DAY_SKY, day);
  const horizon = mix(mix(HZ_NIGHT, HZ_DAY, day), HZ_WARM, warm * 0.85);
  const sky = mix(base, horizon, 0.35 + 0.35 * warm);
  const fog = mix(mix(NIGHT_SKY, 0xa9cdee, day), HZ_WARM, warm * 0.45);
  return {
    phase, label: LABEL[phase][0], icon: LABEL[phase][1], minutes, sunrise, sunset, elev, az, day, warm, lights, stars, sky, horizon, fog,
    hemiSky: mix(mix(0x7a8cff, 0xd6e8ff, day), 0xffc49a, warm * 0.5), hemiGround: mix(0x2a4a30, 0x5f6b45, day),
    hemiI: lerp(1.3, 1.0, day) + 0.45 * warm, sunColor: mix(0xfff4e0, 0xffa060, warm), sunI: lerp(0, 2.1, smooth(-4, 8, elev)), moonI: lerp(1.1, 0, smooth(-8, 2, elev)),
    exposure: lerp(1.15, 0.82, day),
  };
}

/** Sky for "now" (or a QA wall-clock override in minutes). */
export function skyNow(now = new Date(), override: number | null = null): Sky {
  const c = albertaClock(now); return skyAt(override ?? c.minutes, c.doy, c.offset);
}

export const fmtClock = (min: number) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return `${(h % 12) || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
