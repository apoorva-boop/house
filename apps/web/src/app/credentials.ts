/**
 * What this device needs to reach its household, and nothing more.
 *
 * There is no `personId` here. Who you are is not a device setting — it is a fact about
 * the token, decided by the server, and it comes back on every snapshot as `me`. Storing
 * a copy alongside the token would give the app two answers to one question and no way
 * to tell which was stale.
 */
export interface Credentials {
  readonly execUrl: string;
  readonly token: string;
}

const KEY = "house.credentials";

function isCredentials(value: unknown): value is Credentials {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // A record written before `personId` was dropped still validates: the extra key is
  // ignored rather than rejected, so an existing install is not thrown back to setup.
  return typeof v["execUrl"] === "string" && typeof v["token"] === "string";
}

/** Malformed JSON reads as `null`, never throws. */
export function loadCredentials(store: Storage): Credentials | null {
  const raw = store.getItem(KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCredentials(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCredentials(store: Storage, c: Credentials): void {
  store.setItem(KEY, JSON.stringify(c));
}

export function clearCredentials(store: Storage): void {
  store.removeItem(KEY);
}
