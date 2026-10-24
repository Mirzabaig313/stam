import { createStore } from "zustand/vanilla";

import { type Api, api as defaultApi, type Me } from "./api";
import { type SessionStore, sessionStore } from "./session";

/** Where sign-in hands back its one-time code: the URL fragment of the page it returns to. */
const SIGN_IN_PARAM = "stamSignIn";

export type AuthState = {
  status: "unknown" | "signedOut" | "signedIn";
  me: Me | null;
  /** Asks who is signed in; a browser with no session token asks nothing (spec D14). */
  refresh(): Promise<void>;
  /**
   * Call with the page's URL on load. After Google sign-in it carries a one-time code in its
   * fragment: returns the code and the URL without it (to replace in history at once), or null.
   */
  takeSignInCode(path: string): { code: string; path: string } | null;
  /** Trades the code for the session token, then asks who is signed in. */
  finishSignIn(code: string): Promise<void>;
  /** A request found the session gone (401). */
  sessionLost(): void;
  signOut(): Promise<void>;
};

export function createAuthStore(deps: { api?: Api; session?: SessionStore } = {}) {
  const api = deps.api ?? defaultApi;
  const session = deps.session ?? sessionStore;
  return createStore<AuthState>()((set, get) => ({
    status: "unknown",
    me: null,

    async refresh() {
      if (!session.get()) {
        set({ status: "signedOut", me: null });
        return;
      }
      try {
        const me = await api.getMe();
        if (!me) session.clear();
        set(me ? { status: "signedIn", me } : { status: "signedOut", me: null });
      } catch {
        // Offline or the server is down: what we knew stands.
        set((s) => (s.status === "unknown" ? { status: "signedOut" } : s));
      }
    },

    takeSignInCode(path) {
      const url = new URL(path, "http://x");
      const fragment = new URLSearchParams(url.hash.slice(1));
      const code = fragment.get(SIGN_IN_PARAM);
      if (!code) return null;
      fragment.delete(SIGN_IN_PARAM);
      const rest = fragment.toString();
      return { code, path: url.pathname + url.search + (rest ? `#${rest}` : "") };
    },

    async finishSignIn(code) {
      try {
        session.set(await api.exchangeSignIn(code));
      } catch {
        // A used or expired code (a reload of the returned page): whatever session there was stands.
      }
      await get().refresh();
    },

    sessionLost() {
      session.clear();
      set({ status: "signedOut", me: null });
    },

    async signOut() {
      set({ status: "signedOut", me: null });
      // The server forgets the session first (the request carries the token), then this browser.
      await api.signOut().catch(() => {});
      session.clear();
    },
  }));
}

export const authStore = createAuthStore();
