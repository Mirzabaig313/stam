import { createStore } from "zustand/vanilla";

import { type Api, api as defaultApi, type Me } from "./api";

/**
 * Set once this browser has signed in (spec D14). Until then the app never calls the server:
 * someone who only uses Stam locally sends no requests at all.
 */
export const HAS_SIGNED_IN = "stam.hasSignedIn";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type AuthState = {
  status: "unknown" | "signedOut" | "signedIn";
  me: Me | null;
  /** Asks who is signed in; without `force`, only on a browser that has signed in before. */
  refresh(opts?: { force?: boolean }): Promise<void>;
  /**
   * Call with the page's path on load: after Google sign-in the server adds `signedIn=1`. Notes
   * it and returns the path without it (to replace in history), or null when it was not there.
   */
  noteReturn(path: string): string | null;
  /** A request found the session gone (401). */
  sessionLost(): void;
  signOut(): Promise<void>;
};

/** localStorage, or nothing when the browser refuses it (private mode, blocked storage). */
function safeStorage(storage?: StorageLike): StorageLike {
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
        // not remembered; the next page load asks again only when forced
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

export function createAuthStore(deps: { api?: Api; storage?: StorageLike } = {}) {
  const api = deps.api ?? defaultApi;
  const storage = safeStorage(deps.storage);
  return createStore<AuthState>()((set) => ({
    status: "unknown",
    me: null,

    async refresh({ force = false } = {}) {
      if (!force && storage.getItem(HAS_SIGNED_IN) !== "1") {
        set({ status: "signedOut", me: null });
        return;
      }
      try {
        const me = await api.getMe();
        if (me) storage.setItem(HAS_SIGNED_IN, "1");
        set(me ? { status: "signedIn", me } : { status: "signedOut", me: null });
      } catch {
        // Offline or the server is down: what we knew stands.
        set((s) => (s.status === "unknown" ? { status: "signedOut" } : s));
      }
    },

    noteReturn(path) {
      const url = new URL(path, "http://x");
      if (url.searchParams.get("signedIn") !== "1") return null;
      storage.setItem(HAS_SIGNED_IN, "1");
      url.searchParams.delete("signedIn");
      return url.pathname + url.search + url.hash;
    },

    sessionLost() {
      set({ status: "signedOut", me: null });
    },

    async signOut() {
      storage.removeItem(HAS_SIGNED_IN);
      set({ status: "signedOut", me: null });
      await api.signOut().catch(() => {});
    },
  }));
}

export const authStore = createAuthStore();
