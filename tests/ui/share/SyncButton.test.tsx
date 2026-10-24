import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createApi, type Me } from "@/cloud/api";
import { createAuthStore } from "@/cloud/auth";
import { createSessionStore } from "@/cloud/session";
import { Menu } from "@/ui/design/Menu";
import { AccountMenuSection } from "@/ui/share/AccountMenuSection";
import { SyncButton } from "@/ui/share/SyncButton";
import { createEditorStore, type EditorState } from "@/ui/store/editorStore";
import { EditorContext } from "@/ui/store/useEditor";

import { fakeFetch, json } from "../../cloud/fakeFetch";
import { makeEditorEnv } from "../../fixtures/editorEnv";
import { renderApp } from "../../fixtures/renderApp";

afterEach(cleanup);

async function renderSync(cloud: EditorState["cloud"], onSave?: () => void) {
  const env = await makeEditorEnv();
  const store = createEditorStore({ repo: env.repo, autosaver: env.autosaver, now: env.now });
  const synced: number[] = [];
  store.setState({ cloud, syncNow: () => void synced.push(1) });
  renderApp(
    <EditorContext.Provider value={store}>
      <SyncButton {...(onSave ? { onSaveToAccount: onSave } : {})} />
    </EditorContext.Provider>,
    { repo: env.repo },
  );
  return { synced };
}

const cloud = (patch: Partial<NonNullable<EditorState["cloud"]>>): EditorState["cloud"] => ({
  role: "owner",
  status: "live",
  pendingCount: 0,
  closed: null,
  dropped: [],
  presence: [],
  ...patch,
});

describe("the Sync button", () => {
  test("a local tree: Save to my account", async () => {
    const user = userEvent.setup();
    let saved = 0;
    await renderSync(null, () => void saved++);
    await user.click(screen.getByRole("button", { name: "Save to my account" }));
    expect(saved).toBe(1);
  });

  test("a local tree that cannot be saved (someone else's link): no button", async () => {
    await renderSync(null);
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("says how the tree syncs, and syncs now when pressed", async () => {
    const user = userEvent.setup();
    const { synced } = await renderSync(cloud({}));
    await user.click(screen.getByRole("button", { name: "Synced" }));
    expect(synced).toHaveLength(1);
    cleanup();
    await renderSync(cloud({ status: "offline", pendingCount: 3 }));
    expect(screen.getByRole("button", { name: "Offline · 3 changes waiting" })).toBeDefined();
    cleanup();
    await renderSync(cloud({ pendingCount: 1 }));
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDefined();
  });
});

describe("My account in the menu", () => {
  const ME: Me = { user: { id: "u1", name: "Ana Khan", email: "ana@x.test" }, trees: [] };

  async function renderAccount(signedIn: boolean) {
    const api = createApi(
      fakeFetch({
        "GET /api/me": () => (signedIn ? json(ME) : json({ error: "SIGNED_OUT" }, 401)),
        "POST /api/auth/signout": () => new Response(null, { status: 204 }),
      }).fetch,
    );
    const auth = createAuthStore({
      api,
      session: createSessionStore({
        getItem: () => (signedIn ? "tok" : null),
        setItem() {},
        removeItem() {},
      }),
    });
    await auth.getState().refresh();
    const env = await makeEditorEnv();
    renderApp(
      <Menu at={[0, 0]} label="More" onClose={() => {}}>
        <AccountMenuSection onDone={() => {}} api={api} auth={auth} />
      </Menu>,
      { repo: env.repo },
    );
    return auth;
  }

  test("signed in: name, email, the account's trees and Sign out", async () => {
    const user = userEvent.setup();
    const auth = await renderAccount(true);
    expect(screen.getByText("Ana Khan")).toBeDefined();
    expect(screen.getByText("ana@x.test")).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Trees in my account" })).toBeDefined();
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(auth.getState().status).toBe("signedOut");
  });

  test("signed out: Sign in with Google", async () => {
    await renderAccount(false);
    expect(screen.getByRole("menuitem", { name: "Sign in with Google" })).toBeDefined();
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).toBeNull();
  });
});
