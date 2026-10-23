import {
  type BackupState,
  markBackedUp,
  recordEditDay,
  shouldRemindBackup,
} from "@/storage/backupReminder";
import type { TreeRepo } from "@/storage/treeRepo";

const SETTING_KEY = "backup";

const pad = (n: number) => String(n).padStart(2, "0");

/** The local calendar day as yyyy-mm-dd, the unit the backup reminder counts in. */
export function localDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function readBackupState(repo: TreeRepo): Promise<BackupState> {
  return (await repo.getSetting<BackupState>(SETTING_KEY)) ?? { editDays: [] };
}

export async function isBackupDue(repo: TreeRepo): Promise<boolean> {
  return shouldRemindBackup(await readBackupState(repo));
}

/** Notes that something was saved today. */
export async function noteEditDay(repo: TreeRepo, now: Date = new Date()): Promise<void> {
  const state = await readBackupState(repo);
  const next = recordEditDay(state, localDay(now));
  if (next !== state) await repo.setSetting(SETTING_KEY, next);
}

/** Notes that a backup was downloaded today. */
export async function noteBackup(repo: TreeRepo, now: Date = new Date()): Promise<void> {
  await repo.setSetting(SETTING_KEY, markBackedUp(await readBackupState(repo), localDay(now)));
}
