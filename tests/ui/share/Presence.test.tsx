import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createApi } from "@/cloud/api";
import { createAuthStore } from "@/cloud/auth";
import { createIdentity } from "@/cloud/identity";
import { createSessionStore } from "@/cloud/session";
import type { PresencePerson } from "@/sync/protocol";
import { DisplayNamePrompt, PresenceAvatars, PresenceRings } from "@/ui/share/Presence";
import { createEditorStore, type EditorStore } from "@/ui/store/editorStore";
import { EditorContext } from "@/ui/store/useEditor";

import { fakeFetch, json } from "../../cloud/fakeFetch";
import { makeEditorEnv } from "../../fixtures/editorEnv";
import { renderApp } from "../../fixtures/renderApp";

afterEach(cleanup);

const ME = { user: { id: "u1", name: "Tariq", email: "t@x" }, trees: [] };

/** An auth store that knows this browser is signed out. */
function signedOutAuth() {
  const auth = createAuthStore({
    api: createApi(fakeFetch().fetch),
    session: createSessionStore({ getItem: () => null, setItem() {}, removeItem() {} }),
  });
  void auth.getState().refresh();
  return auth;
}

async function storeWith(role: "owner" | "edit", presence: PresencePerson[]) {
  const env = await makeEditorEnv();
  const store = createEditorStore({ repo: env.repo, autosaver: env.autosaver, now: env.now });
  store.setState({
    cloud: { role, status: "live", pendingCount: 0, closed: null, dropped: [], presence },
  });
  return { env, store };
}

function render(
  store: EditorStore,
  ui: React.ReactNode,
  repo: Awaited<ReturnType<typeof makeEditorEnv>>["repo"],
) {
  return renderApp(<EditorContext.Provider value={store}>{ui}</EditorContext.Provider>, { repo });
}

const people = (n: number): PresencePerson[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Person ${i}`, kind: "link" }));

describe("presence in the editor", () => {
  test("avatars name everyone; after four, the rest are +N", async () => {
    const { store, env } = await storeWith("owner", [
      ...people(5),
      { id: "anon", name: "", kind: "link" },
    ]);
    render(store, <PresenceAvatars />, env.repo);
    const list = screen.getByRole("list", { name: /Also here: Person 0, Person 1/ });
    expect(list.getAttribute("aria-label")).toContain("Guest");
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("+2")).toBeDefined();
  });

  test("the owner is marked, so a link user who types the owner's name stands apart", async () => {
    const { store, env } = await storeWith("edit", [
      { id: "o", name: "Mirza", kind: "owner" },
      { id: "x", name: "Mirza", kind: "link" },
    ]);
    render(store, <PresenceAvatars />, env.repo);
    expect(screen.getByRole("img", { name: "Mirza (owner)" })).toBeDefined();
    expect(screen.getByRole("img", { name: "Mirza" })).toBeDefined();
  });

  test("nobody else here: nothing is shown", async () => {
    const { store, env } = await storeWith("owner", []);
    const { container } = render(store, <PresenceAvatars />, env.repo);
    expect(container.querySelector(".presence")).toBeNull();
  });

  test("a person someone selected gets a ring in that someone's colour", async () => {
    const { store, env } = await storeWith("owner", [
      { id: "c1", name: "Sara", kind: "link", selectedPersonId: 'p"1' },
    ]);
    const { container } = render(store, <PresenceRings />, env.repo);
    const css = container.querySelector("style")!.textContent!;
    expect(css).toContain('[data-person-id="p\\"1"]');
    expect(css).toMatch(/var\(--hue-\d-deep\)/);
  });
});

describe("the name an edit link asks for", () => {
  test("someone with an edit link and no name is asked once, and the name is kept", async () => {
    const user = userEvent.setup();
    const { store, env } = await storeWith("edit", []);
    const auth = signedOutAuth();
    const names: string[] = [];
    store.setState({ setDisplayName: (n: string) => void names.push(n) });
    const identity = createIdentity({ getItem: () => null, setItem() {}, removeItem() {} });
    render(store, <DisplayNamePrompt identity={identity} auth={auth} />, env.repo);
    await user.type(screen.getByLabelText("Your name"), "Sara");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(names).toEqual(["Sara"]);
    expect(screen.queryByText("What should we call you?")).toBeNull();
  });

  test("someone signed in with Google is named from the account and not asked", async () => {
    const { store, env } = await storeWith("edit", []);
    const auth = createAuthStore({
      api: createApi(fakeFetch({ "GET /api/me": () => json(ME) }).fetch),
      session: createSessionStore({ getItem: () => "tok", setItem() {}, removeItem() {} }),
    });
    await auth.getState().refresh();
    const identity = createIdentity({ getItem: () => null, setItem() {}, removeItem() {} });
    render(store, <DisplayNamePrompt identity={identity} auth={auth} />, env.repo);
    expect(screen.queryByText("What should we call you?")).toBeNull();
  });

  test("Not now is remembered: the prompt does not come back", async () => {
    const user = userEvent.setup();
    const { store, env } = await storeWith("edit", []);
    const data: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => void (data[k] = v),
      removeItem() {},
    };
    const auth = signedOutAuth();
    render(store, <DisplayNamePrompt identity={createIdentity(storage)} auth={auth} />, env.repo);
    await user.click(screen.getByRole("button", { name: "Not now" }));
    cleanup();
    render(store, <DisplayNamePrompt identity={createIdentity(storage)} auth={auth} />, env.repo);
    expect(screen.queryByText("What should we call you?")).toBeNull();
  });

  test("an owner, or someone already named, is not asked", async () => {
    const owner = await storeWith("owner", []);
    render(owner.store, <DisplayNamePrompt />, owner.env.repo);
    expect(screen.queryByText("What should we call you?")).toBeNull();
    cleanup();
    const named = await storeWith("edit", []);
    const identity = createIdentity({
      getItem: (k) => (k === "stam.displayName" ? "Ali" : null),
      setItem() {},
      removeItem() {},
    });
    render(named.store, <DisplayNamePrompt identity={identity} />, named.env.repo);
    expect(screen.queryByText("What should we call you?")).toBeNull();
  });
});
