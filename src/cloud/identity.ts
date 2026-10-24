import { safeStorage, type StorageLike } from "./session";

const NAME_KEY = "stam.displayName";
const SKIPPED_KEY = "stam.namePromptSkipped";

/** Longest display name the room keeps (`MAX_NAME_CHARS` in server/stam-room). */
export const MAX_NAME_CHARS = 40;

/**
 * The name a link user typed for shared trees (spec §4.4), in localStorage; nothing is verified
 * (spec D2). There is no lasting id: the room names each connection itself, so nothing here can
 * tell one tree's owner that the same browser visited another tree.
 */
export type Identity = {
  name(): string;
  setName(name: string): void;
  /** "Not now" on the name prompt: it is not asked again on this device. */
  skipped(): boolean;
  skip(): void;
};

export function createIdentity(storage?: StorageLike): Identity {
  const store = safeStorage(
    storage ?? (typeof localStorage === "undefined" ? undefined : localStorage),
  );
  let memoryName: string | null = null;
  let memorySkipped = false;
  return {
    name: () => store.getItem(NAME_KEY) ?? memoryName ?? "",
    setName(name) {
      const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_CHARS);
      memoryName = clean;
      store.setItem(NAME_KEY, clean);
    },
    skipped: () => memorySkipped || store.getItem(SKIPPED_KEY) === "1",
    skip() {
      memorySkipped = true;
      store.setItem(SKIPPED_KEY, "1");
    },
  };
}

export const identity = createIdentity();
