import { createElement, type ReactNode, useCallback, useState } from "react";

import { DeleteDialog } from "./DeleteDialog";

/**
 * Owns the delete dialog. Render `dialog` somewhere inside the editor, and call
 * `requestDelete(personId)` from a button or a keyboard shortcut to open it.
 */
export function useDeleteDialog(): {
  requestDelete: (personId: string) => void;
  dialog: ReactNode;
} {
  const [personId, setPersonId] = useState<string | null>(null);
  const close = useCallback(() => setPersonId(null), []);
  const requestDelete = useCallback((id: string) => setPersonId(id), []);
  const dialog =
    personId === null ? null : createElement(DeleteDialog, { personId, onClose: close });
  return { requestDelete, dialog };
}
