const LEASE_MS = 8000;

type Lease = { viewer: string; expires: number };

const globalLease = globalThis as typeof globalThis & { __worldstateCaptureLease?: Lease };

export function claimLease(viewer: string) {
  const now = Date.now();
  const lease = globalLease.__worldstateCaptureLease;
  if (!lease || lease.expires < now || lease.viewer === viewer) {
    globalLease.__worldstateCaptureLease = { viewer, expires: now + LEASE_MS };
    return true;
  }
  return false;
}

export function holdsLease(viewer: string) {
  const lease = globalLease.__worldstateCaptureLease;
  return Boolean(lease && lease.viewer === viewer && lease.expires >= Date.now());
}
