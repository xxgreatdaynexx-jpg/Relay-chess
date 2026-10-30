/** Live preferences: saved to localStorage, applied as CSS vars, and synced to the account when signed in. */
import { useEffect, useState } from 'react';
import { cleanSettings, DEFAULT_SETTINGS, themeVars, type Settings } from '../../../shared/settings';
import { getVolume, isMuted, setMuted, setVolume, subscribeVolume } from './sounds';
import { loadAuth } from './auth';
import { socket } from './net';

export const SETTINGS_KEY = 'relay-settings-v1';
const EVT = 'relay-settings-changed';
let current: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const s = cleanSettings(raw ? JSON.parse(raw) : {});
    return raw ? s : { ...s, volume: getVolume(), muted: isMuted() };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const getSettings = () => current;

export function applySettings(s: Settings = current): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(s))) root.style.setProperty(k, v);
  root.dataset.theme = s.theme;
  root.style.colorScheme = s.theme === 'light' ? 'light' : 'dark';
  root.classList.toggle('reduce-motion', s.reducedMotion);
  root.classList.toggle('show-coords', s.coords);
  if (Math.abs(getVolume() - s.volume) > 0.005) setVolume(s.volume);
  if (isMuted() !== s.muted) setMuted(s.muted);
}

/** Set while a local change hasn't reached the account yet; survives reloads so the next load pushes instead of pulling. */
const DIRTY_KEY = 'relay-settings-dirty';
const isDirty = () => { try { return localStorage.getItem(DIRTY_KEY) === '1'; } catch { return false; } };
const setDirty = (on: boolean) => { try { if (on) localStorage.setItem(DIRTY_KEY, '1'); else localStorage.removeItem(DIRTY_KEY); } catch { /* blocked */ } };

let pushTimer = 0;
let pending: Settings | null = null;
function sendNow(s: Settings) {
  pending = null;
  window.clearTimeout(pushTimer);
  socket.emit('settings_save', { settings: s }, (res?: { ok?: boolean }) => { if (res?.ok && !pending) setDirty(false); });
}
function pushToServer(s: Settings) {
  if (!loadAuth()) return;
  setDirty(true);
  pending = s;
  if (!socket.connected) return; // flushed on reconnect/sync or on unload
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => pending && sendNow(pending), 400);
}

/** Page is going away: send any debounced change right now over HTTP (sockets don't survive unload). */
export function flushSettings(): void {
  const auth = loadAuth();
  if (!pending || !auth) return;
  const s = pending;
  pending = null;
  window.clearTimeout(pushTimer);
  const body = JSON.stringify({ session: auth.token, settings: s });
  let sent = false;
  try { sent = navigator.sendBeacon?.('/api/settings', new Blob([body], { type: 'text/plain' })) ?? false; } catch { sent = false; }
  if (!sent) {
    try { void fetch('/api/settings', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {}); } catch { /* ignore */ }
  }
}

function commit(next: Settings, push = true) {
  current = next;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // blocked
  }
  applySettings(next);
  window.dispatchEvent(new Event(EVT));
  if (push) pushToServer(next);
}

export function updateSettings(patch: Partial<Settings>): void {
  commit(cleanSettings({ ...current, ...patch }));
}

export function resetSettings(): void {
  commit({ ...DEFAULT_SETTINGS });
}

/** Pull the account's saved settings after sign-in (or push local ones when the account has none). */
export function syncFromAccount(): void {
  if (!loadAuth()) return;
  const go = () => socket.emit('settings_get', {}, (res?: { ok: boolean; settings?: unknown }) => {
    if (!res?.ok) return;
    // A local change that never reached the server (e.g. reload right after toggling) wins over the stored copy.
    if (isDirty()) return sendNow(current);
    if (res.settings) commit(cleanSettings(res.settings), false);
    else pushToServer(current);
  });
  if (socket.connected) setTimeout(go, 300);
  else socket.once('connect', () => setTimeout(go, 300));
}

export function initSettings(): void {
  applySettings(current);
  // The volume slider in the corner stays in sync with the Settings tab.
  subscribeVolume(() => {
    const v = getVolume(), m = isMuted();
    if (Math.abs(v - current.volume) > 0.005 || m !== current.muted) commit({ ...current, volume: Math.round(v * 100) / 100, muted: m });
  });
  window.addEventListener('relay-name-changed', syncFromAccount);
  window.addEventListener('pagehide', flushSettings);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSettings(); });
  syncFromAccount();
}

export function useSettings(): Settings {
  const [s, setS] = useState(current);
  useEffect(() => {
    const on = () => setS(current);
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  return s;
}

/** Open the Account panel from anywhere (lobby prompts, casino tables). */
export const ACCOUNT_EVT = 'relay-open-account';
export function openAccount(tab: 'account' | 'settings' = 'account'): void {
  window.dispatchEvent(new CustomEvent(ACCOUNT_EVT, { detail: tab }));
}

/** Clears every saved window position and size. */
export function resetWindowPositions(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('relay-win-')) localStorage.removeItem(k);
  } catch {
    // blocked
  }
  window.location.reload();
}
