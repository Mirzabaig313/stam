import { expect, test } from "bun:test";

import { encodeCommand } from "@/sync/wire";

import { describeWorker, makeLink, signIn, Socket, upload } from "./helpers";

// Presence and names through the real Worker and Durable Object (P2).

/** The next presence message whose list matches `check`. */
async function presenceWhere(
  socket: Socket,
  check: (people: { id: string; name: string }[]) => boolean,
): Promise<{ id: string; name: string; kind: string; selectedPersonId?: string }[]> {
  for (;;) {
    const msg = (await socket.next("presence")) as { people: never[] };
    if (check(msg.people)) return msg.people;
  }
}

describeWorker("who is in a shared tree", () => {
  test("people see each other by name and selection, and see others leave", async () => {
    const owner = await signIn("pria");
    const doc = await upload(owner);
    const person = Object.keys(doc.persons)[0]!;
    const link = await makeLink(owner, doc.id, "edit");
    const o = new Socket(`/api/trees/${doc.id}/ws`, owner);
    const e = new Socket(`/api/trees/${doc.id}/ws?t=${link.token}`);
    await Promise.all([o.opened, e.opened]);
    o.send({ type: "hello", lastVersion: 0 });
    e.send({ type: "hello", name: "  Sara  " });
    await Promise.all([o.next("welcome"), e.next("welcome")]);

    // Each sees the other, never itself, under an id the room made.
    const forOwner = await presenceWhere(o, (p) => p.some((x) => x.name === "Sara"));
    expect(forOwner).toEqual([{ id: expect.any(String), name: "Sara", kind: "link" }]);
    const forGuest = await presenceWhere(e, (p) => p.length === 1);
    expect(forGuest).toEqual([{ id: expect.any(String), name: "Pria", kind: "owner" }]);

    e.send({ type: "presence", selectedPersonId: person });
    const selected = await presenceWhere(o, (p) =>
      p.some((x) => (x as { selectedPersonId?: string }).selectedPersonId === person),
    );
    expect(selected[0]!.selectedPersonId).toBe(person);

    // Edits carry the name the link user gave.
    e.send({
      type: "op",
      opId: "presence01",
      cmd: encodeCommand({ type: "renameTree", name: "By Sara" }),
    });
    expect((await o.next("applied")).author).toEqual({ kind: "link", name: "Sara" });

    e.close();
    expect(await presenceWhere(o, (p) => p.length === 0)).toEqual([]);
    o.close();
  });

  test("someone signed in with Google who opens a link is named from the account", async () => {
    const owner = await signIn("rana");
    const doc = await upload(owner);
    const link = await makeLink(owner, doc.id, "edit");
    const relative = await signIn("tariq");
    const o = new Socket(`/api/trees/${doc.id}/ws`, owner);
    // A link socket that also carries the relative's session token.
    const r = new Socket(`/api/trees/${doc.id}/ws?t=${link.token}`, relative);
    await Promise.all([o.opened, r.opened]);
    o.send({ type: "hello", lastVersion: 0 });
    r.send({ type: "hello", name: "Typed name" });
    expect(await r.next("welcome")).toMatchObject({ role: "edit" });
    const people = await presenceWhere(o, (p) => p.length === 1);
    expect(people).toEqual([{ id: expect.any(String), name: "Tariq", kind: "link" }]);
    o.close();
    r.close();
  });
});
