import { expect, test } from "bun:test";

import { APP_NAME, SNAPSHOT_LIMIT, UNDO_LIMIT } from "@/config";

test("config pins product constants", () => {
  expect(APP_NAME).toBe("Stam");
  expect(UNDO_LIMIT).toBe(200);
  expect(SNAPSHOT_LIMIT).toBe(5);
});
