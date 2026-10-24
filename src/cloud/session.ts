/**
 * The owner's session token. The API is on another site than the app, where browsers (Safari
 * first) refuse its cookies, so the app keeps the token and sends it (`Authorization: Bearer`, or
 * a WebSocket subprotocol). Until a browser has one, the app never calls the server (spec D14):
 * someone who only uses Stam locally sends no requests at all.
 */
export const SESSION_KEY = "stam.session";

/**
 * This tab's sign-in nonce (sessionStorage): sign-in starts with it and the server hands the
 * one-time code back only to a tab that holds it, so a code from someone else's sign-in, sent in a
 * link, signs nobody in (login CSRF).
 */
export const SIGN_IN_NONCE_KEY = "stam.signInNonce";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** `storage`, or nothing when the browser refuses it (private mode, blocked storage). */
export function safeStorage(storage: StorageLike | undefined): StorageLike {
  const backing = storage;
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
  /** Forgets the token; with `ifToken`, only while it is still that one (another tab may have
   * signed in again since). */
  clear(ifToken?: string): void;
  /** This tab's sign-in nonce, made on first use (stable, so every sign-in link has the same). */
  signInNonce(): string;
  /** The nonce, once: sign-in is over (or never started in this tab, then null). */
  takeSignInNonce(): string | null;
};

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

export function createSessionStore(storage?: StorageLike, tabStorage?: StorageLike): SessionStore {
  const shared = safeStorage(
    storage ?? (typeof localStorage === "undefined" ? undefined : localStorage),
  );
  const tab = safeStorage(
    tabStorage ?? (typeof sessionStorage === "undefined" ? undefined : sessionStorage),
  );
  /** Only for a browser that refuses storage: the session then lasts until the tab closes. */
  let memory: string | null = null;
  let memoryNonce: string | null = null;
  return {
    // Storage first: another tab may have signed in (or out) since this one stored its copy.
    get: () => shared.getItem(SESSION_KEY) ?? memory,
    set(token) {
      memory = token;
      shared.setItem(SESSION_KEY, token);
    },
    clear(ifToken) {
      if (ifToken !== undefined && shared.getItem(SESSION_KEY) !== ifToken) {
        if (memory === ifToken) memory = null;
        return;
      }
      memory = null;
      shared.removeItem(SESSION_KEY);
    },
    signInNonce() {
      const nonce = tab.getItem(SIGN_IN_NONCE_KEY) ?? memoryNonce ?? randomToken();
      memoryNonce = nonce;
      tab.setItem(SIGN_IN_NONCE_KEY, nonce);
      return nonce;
    },
    takeSignInNonce() {
      const nonce = tab.getItem(SIGN_IN_NONCE_KEY) ?? memoryNonce;
      memoryNonce = null;
      tab.removeItem(SIGN_IN_NONCE_KEY);
      return nonce;
    },
  };
}

export const sessionStore = createSessionStore();
