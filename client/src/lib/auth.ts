/** Signed-in name + session token (the password is never stored). */
import { useEffect, useState } from 'react';
import { saveName } from './playerName';

export const AUTH_KEY = 'relay-auth-v1';
export interface SavedAuth { name: string; token: string }

export function loadAuth(): SavedAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedAuth;
    return typeof v?.name === 'string' && typeof v?.token === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function saveAuth(a: SavedAuth): void {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(a));
  } catch {
    // blocked
  }
  saveName(a.name);
  window.dispatchEvent(new Event('relay-name-changed'));
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    // blocked
  }
  window.dispatchEvent(new Event('relay-name-changed'));
}

/** Signed-in display name, or '' when signed out. */
export function useAccount(): string {
  const [name, setName] = useState(() => loadAuth()?.name ?? '');
  useEffect(() => {
    const on = () => setName(loadAuth()?.name ?? '');
    window.addEventListener('storage', on);
    window.addEventListener('relay-name-changed', on);
    return () => {
      window.removeEventListener('storage', on);
      window.removeEventListener('relay-name-changed', on);
    };
  }, []);
  return name;
}
