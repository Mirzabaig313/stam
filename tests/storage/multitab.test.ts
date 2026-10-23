import { afterEach, describe, expect, test } from "bun:test";

import { announceTreeChange, createTabSync, type TreeChange } from "@/storage/multitab";

const open: { close(): void }[] = [];
afterEach(() => {
  for (const sync of open.splice(0)) sync.close();
});

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createTabSync", () => {
  test("another tab on the same tree is told about a save", async () => {
    const seen: TreeChange[] = [];
    const a = createTabSync("t1", () => {}, { tabId: "tab-a" });
    const b = createTabSync("t1", (change) => seen.push(change), { tabId: "tab-b" });
    open.push(a, b);
    a.announceSave();
    await wait();
    expect(seen).toEqual(["saved"]);
  });

  test("the tree list's rename and delete reach an open editor", async () => {
    const seen: TreeChange[] = [];
    const b = createTabSync("t1", (change) => seen.push(change), { tabId: "tab-b" });
    open.push(b);
    announceTreeChange("t1", "renamed", { tabId: "tab-list" });
    announceTreeChange("t2", "deleted", { tabId: "tab-list" });
    announceTreeChange("t1", "deleted", { tabId: "tab-list" });
    await wait();
    expect(seen).toEqual(["renamed", "deleted"]);
  });

  test("two instances in the same tab do not notify each other", async () => {
    let notified = 0;
    // No injected tabId: both use this tab's module-level id.
    const a = createTabSync("t1", () => notified++);
    const b = createTabSync("t1", () => notified++);
    open.push(a, b);
    a.announceSave();
    b.announceSave();
    await wait();
    expect(notified).toBe(0);
  });

  test("other trees are ignored", async () => {
    let otherTree = 0;
    const a = createTabSync("t1", () => {}, { tabId: "tab-a" });
    const c = createTabSync("t2", () => otherTree++, { tabId: "tab-c" });
    open.push(a, c);
    a.announceSave();
    await wait();
    expect(otherTree).toBe(0);
  });

  test("a closed tab stops listening", async () => {
    let remote = 0;
    const a = createTabSync("t1", () => {}, { tabId: "tab-a" });
    const b = createTabSync("t1", () => remote++, { tabId: "tab-b" });
    open.push(a);
    b.close();
    a.announceSave();
    await wait();
    expect(remote).toBe(0);
  });
});
