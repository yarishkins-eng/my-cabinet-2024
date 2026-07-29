export interface IntentStorage {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
}

export const intentStorageKey = (intent: string) => `device-first:intent:${intent}`;

export function getOrCreateIntentKey(
  storage: IntentStorage,
  intent: string,
  create: () => string,
): string {
  const name = intentStorageKey(intent);
  const existing = storage.getItem(name);
  if (existing) return existing;
  const created = create();
  storage.setItem(name, created);
  return created;
}
