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

let pushTimer = 0;
function pushToServer(s: Settings) {
  if (!loadAuth() || !socket.connected) return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => socket.emit('settings_save', { settings: s }, () => {}), 400);
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
