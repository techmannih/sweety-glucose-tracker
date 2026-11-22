export const SESSION_CHANGE_KEY = 'sweety:session-changed';

export function announceSessionChange() {
  try {
    window.localStorage.setItem(SESSION_CHANGE_KEY, crypto.randomUUID());
  } catch {
    // Focus checks and the account header also work when storage is unavailable.
  }
}
