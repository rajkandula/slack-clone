/**
 * Client-side registry of accounts signed into on this device, for quick
 * switching (like Instagram / X). The active session is always the httpOnly
 * cookie; this list only remembers who else is available and holds each
 * account's session token so /api/auth/switch can re-issue the cookie.
 */
export interface SavedAccount {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string;
  token: string;
  lastUsedAt: number;
}

const KEY = "wasp-accounts";

export function getSavedAccounts(): SavedAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedAccount[]) : [];
    return Array.isArray(list) ? list.sort((a, b) => b.lastUsedAt - a.lastUsedAt) : [];
  } catch {
    return [];
  }
}

function write(list: SavedAccount[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* storage unavailable */ }
}

/** Add or refresh an account. `token` is required the first time. */
export function saveAccount(acc: Omit<SavedAccount, "lastUsedAt" | "token"> & { token?: string }) {
  const list = getSavedAccounts();
  const existing = list.find((a) => a.id === acc.id);
  const token = acc.token ?? existing?.token;
  if (!token) return; // nothing to switch with later
  const next: SavedAccount = { ...existing, ...acc, token, lastUsedAt: Date.now() };
  write([next, ...list.filter((a) => a.id !== acc.id)]);
}

export function removeAccount(id: string) {
  write(getSavedAccounts().filter((a) => a.id !== id));
}
