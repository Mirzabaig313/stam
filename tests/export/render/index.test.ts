import { expect, test } from "bun:test";

test("the render entry exposes the plan's names", async () => {
  const mod = await import("@/export/render");
  expect(typeof mod.renderTreeSvg).toBe("function");
  expect(typeof mod.applyPrivacy).toBe("function");
  expect(typeof mod.selectScope).toBe("function");
});
