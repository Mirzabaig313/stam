import { describe, expect, test } from "bun:test";

import { fitWithin } from "@/ui/photos/resizePhoto";

describe("fitWithin", () => {
  test("scales the long side down to max, keeping the aspect ratio", () => {
    expect(fitWithin(2000, 1000)).toEqual([512, 256]);
    expect(fitWithin(1000, 2000)).toEqual([256, 512]);
  });

  test("never enlarges", () => {
    expect(fitWithin(300, 200)).toEqual([300, 200]);
    expect(fitWithin(512, 512)).toEqual([512, 512]);
  });

  test("honours a custom max and rounds to whole pixels, at least 1", () => {
    expect(fitWithin(1000, 333, 100)).toEqual([100, 33]);
    expect(fitWithin(10000, 1, 512)).toEqual([512, 1]);
  });
});
