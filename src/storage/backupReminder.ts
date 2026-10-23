/** Edit days (yyyy-mm-dd) since the last backup before we nudge the user. */
export const BACKUP_REMIND_AFTER_DAYS = 7;

export type BackupState = { lastBackupAt?: string; editDays: string[] };

/** Notes that the tree was edited on `today` (yyyy-mm-dd). */
export function recordEditDay(state: BackupState, today: string): BackupState {
  if (state.editDays.includes(today)) return state;
  return { ...state, editDays: [...state.editDays, today] };
}

export function shouldRemindBackup(state: BackupState): boolean {
  const since = state.lastBackupAt;
  const days = new Set(state.editDays.filter((day) => since === undefined || day > since));
  return days.size >= BACKUP_REMIND_AFTER_DAYS;
}

export function markBackedUp(_state: BackupState, today: string): BackupState {
  return { lastBackupAt: today, editDays: [] };
}
