import { describe, expect, test } from "bun:test";

import { scopeCss } from "@/export/pdf/scopeCss";

describe("scopeCss", () => {
  test("prefixes every selector of every rule", () => {
    expect(scopeCss("text{font:x}\n.a, .b .c{fill:red}", ".w")).toBe(
      ".w text{font:x}\n.w .a, .w .b .c{fill:red}",
    );
  });
  test("leaves at-rules alone", () => {
    expect(scopeCss("@media print{.a{x:y}}", ".w")).toContain("@media print");
  });
});
