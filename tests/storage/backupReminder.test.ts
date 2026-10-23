import { describe, expect, test } from "bun:test";

import {
  type BackupState,
  markBackedUp,
  recordEditDay,
  shouldRemindBackup,
} from "@/storage/backupReminder";

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

function recordAll(state: BackupState, list: string[]): BackupState {
  return list.reduce(recordEditDay, state);
}

describe("backup reminder", () => {
  test("seven distinct edit days trigger the reminder; six do not", () => {
    expect(shouldRemindBackup(recordAll({ editDays: [] }, days(6)))).toBe(false);
    expect(shouldRemindBackup(recordAll({ editDays: [] }, days(7)))).toBe(true);
  });

  test("duplicate days do not count", () => {
    const state = recordAll({ editDays: [] }, [...days(6), ...days(6), "2026-10-06"]);
    expect(state.editDays).toHaveLength(6);
    expect(shouldRemindBackup(state)).toBe(false);
  });

  test("recordEditDay does not mutate its input", () => {
    const state: BackupState = { editDays: ["2026-10-01"] };
    recordEditDay(state, "2026-10-02");
    expect(state.editDays).toEqual(["2026-10-01"]);
  });

  test("markBackedUp resets the count and remembers the day", () => {
    const state = markBackedUp(recordAll({ editDays: [] }, days(9)), "2026-10-10");
    expect(state).toEqual({ lastBackupAt: "2026-10-10", editDays: [] });
    expect(shouldRemindBackup(state)).toBe(false);
    expect(shouldRemindBackup(recordAll(state, ["2026-10-11", "2026-10-12"]))).toBe(false);
  });

  test("only edit days after the last backup count", () => {
    const stale: BackupState = { lastBackupAt: "2026-10-20", editDays: days(8) };
    expect(shouldRemindBackup(stale)).toBe(false);
  });
});
