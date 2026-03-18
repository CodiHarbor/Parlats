const MAX_ATTEMPTS = 5;
const BASE_LOCKOUT_SEC = 30;
const MAX_LOCKOUT_SEC = 3600; // cap at 1 hour

interface LockoutEntry {
  failures: number;
  lastFailure: number;
}

export class LoginLockout {
  private store = new Map<string, LockoutEntry>();

  check(email: string): { locked: boolean; retryAfterSec: number } {
    const entry = this.store.get(email);
    if (!entry || entry.failures < MAX_ATTEMPTS) {
      return { locked: false, retryAfterSec: 0 };
    }

    const lockoutSec = Math.min(
      BASE_LOCKOUT_SEC * Math.pow(2, entry.failures - MAX_ATTEMPTS),
      MAX_LOCKOUT_SEC,
    );
    const elapsed = (Date.now() - entry.lastFailure) / 1000;
    const remaining = Math.ceil(lockoutSec - elapsed);

    if (remaining <= 0) {
      return { locked: false, retryAfterSec: 0 };
    }
    return { locked: true, retryAfterSec: remaining };
  }

  recordFailure(email: string): void {
    const entry = this.store.get(email) || { failures: 0, lastFailure: 0 };
    entry.failures++;
    entry.lastFailure = Date.now();
    this.store.set(email, entry);
  }

  recordSuccess(email: string): void {
    this.store.delete(email);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.lastFailure > MAX_LOCKOUT_SEC * 1000) {
        this.store.delete(key);
      }
    }
  }
}

// Singleton
export const loginLockout = new LoginLockout();
setInterval(() => loginLockout.cleanup(), 10 * 60_000);
