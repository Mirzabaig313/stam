/** Asks the browser not to evict our data. False when unsupported, refused or failing. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = globalThis.navigator?.storage;
    if (!storage || typeof storage.persist !== "function") return false;
    return await storage.persist();
  } catch {
    return false;
  }
}

/** Fraction of the storage quota in use (0 to 1); 0 when the browser does not say. */
export async function storagePressure(): Promise<number> {
  try {
    const storage = globalThis.navigator?.storage;
    if (!storage || typeof storage.estimate !== "function") return 0;
    const { usage, quota } = await storage.estimate();
    if (!usage || !quota) return 0;
    return usage / quota;
  } catch {
    return 0;
  }
}
