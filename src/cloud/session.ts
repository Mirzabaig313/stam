/**
 * The owner's session token. The API is on another site than the app, where browsers (Safari
 * first) refuse its cookies, so the app keeps the token and sends it (`Authorization: Bearer`, or
 * a WebSocket subprotocol). Until a browser has one, the app never calls the server (spec D14):
 * someone who only uses Stam locally sends no requests at all.
 */
export const SESSION_KEY = "stam.session";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage, or nothing when the browser refuses it (private mode, blocked storage). */
export function safeStorage(storage?: StorageLike): StorageLike {
  const backing = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  return {
    getItem: (k) => {
      try {
        return backing?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        backing?.setItem(k, v);
      } catch {
        // not remembered: this tab still has it until it closes
      }
    },
    removeItem: (k) => {
      try {
        backing?.removeItem(k);
      } catch {
        // nothing to forget
      }
    },
  };
}

export type SessionStore = {
  get(): string | null;
  set(token: string): void;
  clear(): void;
};

export function createSessionStore(storage?: StorageLike): SessionStore {
  const backing = safeStorage(storage);
  /** Kept here too, so a browser that refuses storage still works until the tab closes. */
  let memory: string | null = null;
  return {
    get: () => memory ?? backing.getItem(SESSION_KEY),
    set(token) {
      memory = token;
      backing.setItem(SESSION_KEY, token);
    },
    clear() {
      memory = null;
      backing.removeItem(SESSION_KEY);
    },
  };
}

export const sessionStore = createSessionStore();
