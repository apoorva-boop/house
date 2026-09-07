export interface Credentials {
  readonly execUrl: string;
  readonly token: string;
  readonly personId: string;
}

const KEY = "house.credentials";

function isCredentials(value: unknown): value is Credentials {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["execUrl"] === "string" &&
    typeof v["token"] === "string" &&
    typeof v["personId"] === "string"
  );
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
