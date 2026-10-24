import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createApi } from "@/cloud/api";
import { createAuthStore } from "@/cloud/auth";
import { createCloudSession } from "@/cloud/cloudSession";
import { createSessionStore } from "@/cloud/session";
import type { CloudMeta } from "@/storage/treeRepo";
import { ShareDialog } from "@/ui/share/ShareDialog";
import { createEditorStore } from "@/ui/store/editorStore";
import { EditorContext } from "@/ui/store/useEditor";

import { fakeFetch, json } from "../../cloud/fakeFetch";
import { fakeRoom } from "../../cloud/roomFake";
import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";

afterEach(cleanup);

const ME = { user: { id: "u1", name: "Alice", email: "a@x" }, trees: [] };
const LINK = {
  id: "l1",
  role: "view",
  hideLiving: false,
  url: "https://stam.test/s/tok1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

async function setup(opts: {
  cloud?: CloudMeta;
  signedIn?: boolean;
  routes?: Parameters<typeof fakeFetch>[0];
  photo?: boolean;
}) {
  const env = await makeEditorEnv();
  let doc = famSimple();
  if (opts.photo) {
    const id = Object.keys(doc.persons)[0]!;
    doc = { ...doc, persons: { ...doc.persons, [id]: { ...doc.persons[id]!, photoId: "ph1" } } };
    await env.repo.putPhoto("ph1", new Blob(["webp"]));
  }
  await env.repo.saveTree(doc);
  if (opts.cloud) await env.repo.setCloud(doc.id, opts.cloud);
  const { fetch, calls } = fakeFetch({
    "GET /api/me": () => (opts.signedIn === false ? json({ error: "SIGNED_OUT" }, 401) : json(ME)),
    ...opts.routes,
  });
  const api = createApi(fetch);
  const auth = createAuthStore({
    api,
    session: createSessionStore({ getItem: () => "tok", setItem() {}, removeItem() {} }),
  });
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
      <ShareDialog onClose={() => {}} api={api} auth={auth} />
    </EditorContext.Provider>,
    { repo: env.repo, route: `/app/t/${doc.id}` },
  );
  return { env, doc, calls, store };
}

describe("share dialog", () => {
  test("signed out, it offers Google sign-in that comes back to the same tree", async () => {
    await setup({ signedIn: false });
    const link = await screen.findByRole("link", { name: "Sign in with Google" });
    expect(link.getAttribute("href")).toMatch(
      new RegExp(
        `^/api/auth/google\\?return=${encodeURIComponent(`${location.pathname}?share=1`)}&nonce=[\\w-]{43}$`,
      ),
    );
  });

  test("upload shows progress, then the link rows", async () => {
    const user = userEvent.setup();
    const { doc, calls, store } = await setup({
      routes: {
        "POST /api/trees": () => json({ id: famSimple().id, version: 0 }, 201),
        [`GET /api/trees/${famSimple().id}/links`]: () => json([]),
      },
    });
    await user.click(await screen.findByRole("button", { name: "Upload and share" }));
    // One row for each link: view and edit.
    expect(await screen.findAllByRole("button", { name: "Create link" })).toHaveLength(2);
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/trees")).toBe(true);
    expect(store.getState().cloud?.role).toBe("owner");
    expect(doc.id).toBe(famSimple().id);
  });

  test("photo upload failures are reported and retried", async () => {
    const user = userEvent.setup();
    let tries = 0;
    await setup({
      photo: true,
      routes: {
        "POST /api/trees": () => json({ id: famSimple().id, version: 0 }, 201),
        [`PUT /api/trees/${famSimple().id}/photos/ph1`]: () =>
          new Response(null, { status: tries++ === 0 ? 500 : 204 }),
        [`GET /api/trees/${famSimple().id}/links`]: () => json([]),
      },
    });
    await user.click(await screen.findByRole("button", { name: "Upload and share" }));
    expect(await screen.findByText("1 photo didn't upload.")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText("1 photo didn't upload.")).toBeNull());
  });

  test("copy writes the link url", async () => {
    const user = userEvent.setup();
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (s: string) => void written.push(s) },
      configurable: true,
    });
    await setup({
      cloud: { role: "owner", version: 0 },
      routes: { [`GET /api/trees/${famSimple().id}/links`]: () => json([LINK]) },
    });
    await user.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(written).toEqual([LINK.url]);
    expect(await screen.findByText("Copied")).toBeDefined();
  });

  test("changing 'hide living' resets the link after a confirm", async () => {
    const user = userEvent.setup();
    const { calls } = await setup({
      cloud: { role: "owner", version: 0 },
      routes: {
        [`GET /api/trees/${famSimple().id}/links`]: () => json([LINK]),
        [`POST /api/trees/${famSimple().id}/links`]: (body) =>
          json(
            {
              ...LINK,
              id: "l2",
              url: "https://stam.test/s/tok2",
              hideLiving: (body as { hideLiving: boolean }).hideLiving,
            },
            201,
          ),
      },
    });
    await user.click(await screen.findByRole("checkbox", { name: "Hide living people's details" }));
    const resets = await screen.findAllByRole("button", { name: "Reset link" });
    await user.click(resets.at(-1)!); // the confirm dialog's
    await screen.findByDisplayValue("https://stam.test/s/tok2");
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      body: { role: "view", hideLiving: true },
    });
  });

  test("turn off removes the link", async () => {
    const user = userEvent.setup();
    await setup({
      cloud: { role: "owner", version: 0 },
      routes: {
        [`GET /api/trees/${famSimple().id}/links`]: () => json([LINK]),
        [`DELETE /api/trees/${famSimple().id}/links/l1`]: () => new Response(null, { status: 204 }),
      },
    });
    await user.click(await screen.findByRole("button", { name: "Turn off" }));
    const confirm = await screen.findAllByRole("button", { name: "Turn off" });
    await user.click(confirm.at(-1)!);
    // Both rows offer a new link now: view and edit.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Create link" })).toHaveLength(2),
    );
  });

  test("an edit link never hides living people, even with the box ticked", async () => {
    const user = userEvent.setup();
    const { calls } = await setup({
      cloud: { role: "owner", version: 0 },
      routes: {
        [`GET /api/trees/${famSimple().id}/links`]: () => json([]),
        [`POST /api/trees/${famSimple().id}/links`]: (body) =>
          json({ ...LINK, ...(body as object), id: "l9", url: "https://stam.test/s/e" }, 201),
      },
    });
    await user.click(await screen.findByRole("checkbox", { name: "Hide living people's details" }));
    const [, editCreate] = await screen.findAllByRole("button", { name: "Create link" });
    expect(editCreate!.getAttribute("aria-describedby")).toBe("share-edit-hint");
    await user.click(editCreate!);
    await screen.findByRole("textbox", { name: "Edit link" });
    expect(calls.at(-1)).toMatchObject({ body: { role: "edit", hideLiving: false } });
  });

  test("turning off the edit link leaves the view link", async () => {
    const user = userEvent.setup();
    const EDIT = { ...LINK, id: "l5", role: "edit" as const, url: "https://stam.test/s/edit5" };
    await setup({
      cloud: { role: "owner", version: 0 },
      routes: {
        [`GET /api/trees/${famSimple().id}/links`]: () => json([LINK, EDIT]),
        [`DELETE /api/trees/${famSimple().id}/links/l5`]: () => new Response(null, { status: 204 }),
      },
    });
    const turnOffs = await screen.findAllByRole("button", { name: "Turn off" });
    await user.click(turnOffs[1]!); // the edit row's
    const confirm = await screen.findAllByRole("button", { name: "Turn off" });
    await user.click(confirm.at(-1)!);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit link" })).toBeNull());
    expect(screen.getByRole("textbox", { name: "Share link" })).toHaveProperty("value", LINK.url);
  });

  test("the edit row makes an edit link, beside the view link", async () => {
    const user = userEvent.setup();
    const { calls } = await setup({
      cloud: { role: "owner", version: 0 },
      routes: {
        [`GET /api/trees/${famSimple().id}/links`]: () => json([LINK]),
        [`POST /api/trees/${famSimple().id}/links`]: () =>
          json({ ...LINK, id: "l3", role: "edit", url: "https://stam.test/s/edit1" }, 201),
      },
    });
    expect(await screen.findByRole("heading", { name: "Can edit" })).toBeDefined();
    await user.click(await screen.findByRole("button", { name: "Create link" }));
    expect(await screen.findByRole("textbox", { name: "Edit link" })).toHaveProperty(
      "value",
      "https://stam.test/s/edit1",
    );
    expect(screen.getByRole("textbox", { name: "Share link" })).toHaveProperty("value", LINK.url);
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      body: { role: "edit", hideLiving: false },
    });
  });
});
