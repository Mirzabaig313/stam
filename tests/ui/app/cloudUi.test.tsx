import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";

import { createApi } from "@/cloud/api";
import { createAuthStore } from "@/cloud/auth";
import { createCloudSession } from "@/cloud/cloudSession";
import type { RoomConnection, RoomHandlers } from "@/cloud/transport";
import type { TreeDocument } from "@/core/model/types";
import { AddPersonButton } from "@/ui/app/AddPerson";
import { EditorPage } from "@/ui/app/EditorPage";
import { LinkPage } from "@/ui/app/LinkPage";
import { Toolbar } from "@/ui/app/Toolbar";
import { TreeListPage } from "@/ui/app/TreeListPage";
import { createEditorStore } from "@/ui/store/editorStore";
import { EditorContext } from "@/ui/store/useEditor";

import { fakeFetch, json } from "../../cloud/fakeFetch";
import { fakeRoom } from "../../cloud/roomFake";
import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";

afterEach(cleanup);

const noStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const signedIn = { getItem: () => "1", setItem() {}, removeItem() {} };

/** A room that answers hello with a welcome carrying `doc`. */
function roomWith(doc: TreeDocument) {
  return (opts: { handlers: RoomHandlers }): RoomConnection => {
    queueMicrotask(() => opts.handlers.onOpen());
    return {
      send: (msg) => {
        if (msg.type === "hello") {
          opts.handlers.onMessage({
            type: "welcome",
            role: "view",
            hideLiving: false,
            version: 3,
            doc,
          });
        }
      },
      stop: () => {},
    };
  };
}

const tree = (id: string, name: string): TreeDocument => ({ ...famSimple(), id, name });
const noop = () => {};

describe("link page", () => {
  test("opens the shared tree and goes to it", async () => {
    const env = await makeEditorEnv();
    const doc = tree("sharedtree1", "Their family");
    const { fetch } = fakeFetch({
      "GET /api/s/tok": () =>
        json({ treeId: doc.id, role: "view", hideLiving: false, name: doc.name }),
    });
    renderApp(
      <Routes>
        <Route
          path="/s/:token"
          element={<LinkPage api={createApi(fetch)} connect={roomWith(doc)} />}
        />
        <Route path="/app/t/:treeId" element={<p>Tree page</p>} />
      </Routes>,
      { repo: env.repo, route: "/s/tok" },
    );
    await screen.findByText("Tree page");
    expect((await env.repo.getMeta(doc.id))?.cloud).toMatchObject({ role: "view", token: "tok" });
  });

  test("a link that was turned off says so", async () => {
    const env = await makeEditorEnv();
    const { fetch } = fakeFetch({ "GET /api/s/gone": () => json({ error: "LINK_OFF" }, 404) });
    renderApp(
      <Routes>
        <Route path="/s/:token" element={<LinkPage api={createApi(fetch)} />} />
      </Routes>,
      { repo: env.repo, route: "/s/gone" },
    );
    expect(await screen.findByText("This link was turned off or doesn't exist.")).toBeDefined();
  });

  test("too many tries says to wait, and keeps the copy this device has", async () => {
    const env = await makeEditorEnv();
    const { fetch } = fakeFetch({
      "GET /api/s/busy": () => json({ error: "RATE_LIMITED" }, 429),
    });
    renderApp(
      <Routes>
        <Route path="/s/:token" element={<LinkPage api={createApi(fetch)} />} />
      </Routes>,
      { repo: env.repo, route: "/s/busy" },
    );
    expect(
      await screen.findByText("Too many tries just now. Wait a minute, then open the link again."),
    ).toBeDefined();

    const doc = tree("sharedtree3", "Their family");
    await env.repo.saveTree(doc);
    await env.repo.setCloud(doc.id, { role: "view", token: "busy", version: 3 });
    cleanup();
    renderApp(
      <Routes>
        <Route path="/s/:token" element={<LinkPage api={createApi(fetch)} />} />
        <Route path="/app/t/:treeId" element={<p>Tree page</p>} />
      </Routes>,
      { repo: env.repo, route: "/s/busy" },
    );
    await screen.findByText("Tree page");
    expect((await env.repo.getMeta(doc.id))?.cloud?.token).toBe("busy");
  });

  test("a link that was turned off removes the copy this device kept of it", async () => {
    const env = await makeEditorEnv();
    const doc = tree("sharedtree2", "Their family");
    await env.repo.saveTree(doc);
    await env.repo.setCloud(doc.id, { role: "view", token: "gone", version: 3 });
    const { fetch } = fakeFetch({ "GET /api/s/gone": () => json({ error: "LINK_OFF" }, 404) });
    renderApp(
      <Routes>
        <Route path="/s/:token" element={<LinkPage api={createApi(fetch)} />} />
      </Routes>,
      { repo: env.repo, route: "/s/gone" },
    );
    await screen.findByText("This link was turned off or doesn't exist.");
    expect(await env.repo.getMeta(doc.id)).toBeUndefined();
  });
});

async function setupList(routes: Parameters<typeof fakeFetch>[0] = {}) {
  const env = await makeEditorEnv();
  await env.repo.saveTree(tree("localtree01", "Local family"));
  await env.repo.saveTree(tree("ownedtree01", "Owned family"));
  await env.repo.setCloud("ownedtree01", { role: "owner", version: 1 });
  await env.repo.saveTree(tree("linktree001", "Their family"));
  await env.repo.setCloud("linktree001", { role: "view", token: "t", version: 1 });
  const me = {
    user: { id: "u1", name: "Alice", email: "a@x" },
    trees: [
      { id: "ownedtree01", name: "Owned family", createdAt: "x" },
      { id: "elsewhere01", name: "Other device family", createdAt: "x" },
    ],
  };
  const { fetch, calls } = fakeFetch({ "GET /api/me": () => json(me), ...routes });
  const api = createApi(fetch);
  const auth = createAuthStore({ api, storage: signedIn });
  renderApp(<TreeListPage api={api} auth={auth} afterImport={async () => {}} />, {
    repo: env.repo,
  });
  await screen.findByText("Local family");
  (await screen.findByText("Alice")).closest(".tree-list-account"); // the account has loaded
  return { env, calls };
}

describe("tree list with the cloud", () => {
  test("groups my trees, trees shared with me and trees in my account", async () => {
    await setupList();
    const shared = await screen.findByRole("region", { name: "Shared with me" });
    expect(within(shared).getByText("Their family")).toBeDefined();
    expect(within(shared).getByText("Can view")).toBeDefined();
    const account = await screen.findByRole("region", { name: "In your account" });
    expect(within(account).getByText("Other device family")).toBeDefined();
    expect(within(account).queryByText("Owned family")).toBeNull();
    expect(screen.getByText("Alice").tagName).toBe("BDI");
  });

  test("save to account uploads without a link and marks the card", async () => {
    const user = userEvent.setup();
    const { calls } = await setupList({
      "POST /api/trees": () => json({ id: "localtree01", version: 0 }, 201),
    });
    await user.click(await screen.findByRole("button", { name: "Actions for Local family" }));
    await user.click(await screen.findByRole("menuitem", { name: "Save to my account" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.path === "/api/trees")).toBe(true),
    );
    expect(calls.some((c) => c.path.includes("/links"))).toBe(false);
    await waitFor(() => expect(screen.getAllByText("In your account").length).toBeGreaterThan(1));
  });

  test("remove from account deletes the cloud copy and keeps the local tree", async () => {
    const user = userEvent.setup();
    const { calls, env } = await setupList({
      "DELETE /api/trees/ownedtree01": () => new Response(null, { status: 204 }),
    });
    await user.click(await screen.findByRole("button", { name: "Actions for Owned family" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove from account" }));
    const confirms = await screen.findAllByRole("button", { name: "Remove from account" });
    await user.click(confirms.at(-1)!);
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    await waitFor(async () =>
      expect((await env.repo.getMeta("ownedtree01"))?.cloud).toBeUndefined(),
    );
    expect(await env.repo.getMeta("ownedtree01")).toBeDefined();
  });
});

describe("view links in the editor", () => {
  test("a view link hides Share and turns off adding people", async () => {
    const env = await makeEditorEnv();
    const doc = famSimple();
    await env.repo.saveTree(doc);
    await env.repo.setCloud(doc.id, { role: "view", token: "t", version: 0 });
    const api = createApi(fakeFetch().fetch);
    const auth = createAuthStore({ api, storage: noStorage });
    const room = fakeRoom();
    const store = createEditorStore({
      repo: env.repo,
      autosaver: env.autosaver,
      now: env.now,
      openCloud: (args) =>
        createCloudSession({ ...args, repo: env.repo, api, auth, connect: room.connect }),
    });
    await store.getState().load(doc.id);
    renderApp(
      <EditorContext.Provider value={store}>
        <Toolbar
          autosaver={env.autosaver}
          onZoomIn={noop}
          onZoomOut={noop}
          onFit={noop}
          onOpenSearch={noop}
          onOpenUnconnected={noop}
        />
        <AddPersonButton />
      </EditorContext.Provider>,
      { repo: env.repo },
    );
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    expect(screen.getAllByText("Can view").length).toBeGreaterThan(0);
    for (const add of screen.getAllByRole("button", { name: /add/i })) {
      expect((add as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe("local use", () => {
  test("a browser that never signed in makes no /api requests", async () => {
    const env = await makeEditorEnv();
    const doc = famSimple();
    await env.repo.saveTree(doc);
    const spy = spyOn(globalThis, "fetch");
    const auth = createAuthStore({ storage: noStorage });
    renderApp(<TreeListPage auth={auth} afterImport={async () => {}} />, { repo: env.repo });
    await screen.findByText(doc.name);
    cleanup();
    renderApp(
      <Routes>
        <Route path="/app/t/:treeId" element={<EditorPage />} />
      </Routes>,
      { repo: env.repo, route: `/app/t/${doc.id}` },
    );
    await screen.findAllByText(doc.name);
    const apiCalls = spy.mock.calls.filter(([input]) => String(input).includes("/api/"));
    expect(apiCalls).toEqual([]);
    spy.mockRestore();
  });
});
