import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { layoutFamily } from "@/core/layout/family";
import { downloadBlob } from "@/ui/export/downloadBlob";
import { gatherInput, visibleWorldRect } from "@/ui/export/gatherInput";

import { docOf, famSimple, person, union } from "../../fixtures/families";

afterEach(() => {
  spyOn(URL, "createObjectURL").mockRestore();
});

describe("downloadBlob", () => {
  test("clicks a download link with the file name, then releases the URL", async () => {
    const created = spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const revoked = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(`${this.download}|${this.href}`);
    });
    const blob = new Blob(["x"], { type: "image/svg+xml" });
    downloadBlob(blob, "tree-2026-10-05.svg", 0);
    expect(created).toHaveBeenCalledWith(blob);
    expect(names).toEqual(["tree-2026-10-05.svg|blob:x"]);
    await new Promise((r) => setTimeout(r, 5));
    expect(revoked).toHaveBeenCalledWith("blob:x");
    click.mockRestore();
    revoked.mockRestore();
  });
});

describe("visibleWorldRect", () => {
  test("is the screen's two corners in world coordinates, whichever way the canvas is mirrored", () => {
    const handle = {
      screenToWorld: ([x, y]: [number, number]): [number, number] => [-(x - 100) / 2, (y - 50) / 2],
    };
    expect(visibleWorldRect(handle, { width: 400, height: 200 })).toEqual({
      x: -150,
      y: -25,
      width: 200,
      height: 100,
    });
  });
  test("is undefined without a canvas or a size", () => {
    expect(visibleWorldRect(null, { width: 1, height: 1 })).toBeUndefined();
    expect(visibleWorldRect({ screenToWorld: (p) => p }, null)).toBeUndefined();
  });
});

describe("gatherInput", () => {
  const doc = famSimple();
  const layout = layoutFamily(doc, { rootId: doc.rootPersonId! });
  const base = { doc, layout, viewRootId: null, selectedId: "c1" };

  test("carries the editor state and no photos by default", async () => {
    let asked = 0;
    const repo = { getPhoto: async () => (asked++, undefined) };
    const input = await gatherInput({ ...base, repo, includePhotos: false, privacy: false });
    expect(input.doc).toBe(doc);
    expect(input.selectedId).toBe("c1");
    expect(input.photos).toEqual({});
    expect(asked).toBe(0);
  });

  test("includes the visible rect only when given a canvas", async () => {
    const repo = { getPhoto: async () => undefined };
    const input = await gatherInput({
      ...base,
      repo,
      includePhotos: false,
      privacy: false,
      visibleRect: { x: 1, y: 2, width: 3, height: 4 },
    });
    expect(input.visibleRect).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  test("turns photos into data URLs, skipping living people under privacy", async () => {
    const d = docOf(
      [
        person("a", "A", "X", "male", { photoId: "pa", isLiving: false }),
        person("b", "B", "X", "female", { photoId: "pb", isLiving: true }),
      ],
      [],
      "a",
    );
    const fetched: string[] = [];
    const repo = {
      getPhoto: async (id: string) => {
        fetched.push(id);
        return new Blob(["hi"], { type: "image/png" });
      },
    };
    const l = layoutFamily(d, { rootId: "a" });
    const open = await gatherInput({
      doc: d,
      layout: l,
      viewRootId: null,
      selectedId: null,
      repo,
      includePhotos: true,
      privacy: false,
    });
    expect(Object.keys(open.photos).toSorted()).toEqual(["pa", "pb"]);
    expect(open.photos.pa).toBe("data:image/png;base64,aGk=");
    fetched.length = 0;
    const closed = await gatherInput({
      doc: d,
      layout: l,
      viewRootId: null,
      selectedId: null,
      repo,
      includePhotos: true,
      privacy: true,
    });
    expect(Object.keys(closed.photos)).toEqual(["pa"]);
    expect(fetched).toEqual(["pa"]);
  });

  test("reads only the photos of people in the chosen scope", async () => {
    const d = docOf(
      [
        person("a", "A", "X", "male", { photoId: "pa", isLiving: false }),
        person("b", "B", "X", "female", { photoId: "pb", isLiving: false }),
        person("c", "C", "X", "male", { photoId: "pc", isLiving: false }),
      ],
      [union("u", ["a", "b"], ["c"])],
      "a",
    );
    const fetched: string[] = [];
    const repo = {
      getPhoto: async (id: string) => (fetched.push(id), new Blob(["x"], { type: "image/png" })),
    };
    const l = layoutFamily(d, { rootId: "a" });
    const input = await gatherInput({
      doc: d,
      layout: l,
      viewRootId: null,
      selectedId: "c",
      scope: "branch",
      repo,
      includePhotos: true,
      privacy: false,
    });
    expect(fetched).toEqual(["pc"]);
    expect(Object.keys(input.photos)).toEqual(["pc"]);
  });

  test("a death record makes a person deceased even if isLiving is still set", async () => {
    const d = docOf(
      [
        person("a", "A", "X", "male", {
          photoId: "pa",
          isLiving: true,
          death: { date: { year: 1990 } },
        }),
      ],
      [],
      "a",
    );
    const repo = { getPhoto: async () => new Blob(["x"], { type: "image/png" }) };
    const input = await gatherInput({
      doc: d,
      layout: layoutFamily(d, { rootId: "a" }),
      viewRootId: null,
      selectedId: null,
      repo,
      includePhotos: true,
      privacy: true,
    });
    expect(Object.keys(input.photos)).toEqual(["pa"]);
  });
});
