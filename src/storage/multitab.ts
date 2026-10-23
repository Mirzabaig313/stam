import { newId } from "@/core/model/ids";

const CHANNEL_NAME = "stam";

/**
 * One id per browser tab (per module instance). BroadcastChannel never echoes to the sending
 * object, but other channels in the same tab do hear it, so the filter must be per tab.
 */
export const TAB_ID = newId();

/** What another tab did to a tree: saved it (the editor), renamed or deleted it (the tree list). */
export type TreeChange = "saved" | "renamed" | "deleted";

type ChangeMessage = { type: TreeChange; treeId: string; tabId: string };

const CHANGES: readonly string[] = ["saved", "renamed", "deleted"] satisfies TreeChange[];

function isChangeMessage(data: unknown): data is ChangeMessage {
  if (typeof data !== "object" || data === null) return false;
  const m = data as Partial<ChangeMessage>;
  return (
    typeof m.type === "string" &&
    CHANGES.includes(m.type) &&
    typeof m.treeId === "string" &&
    typeof m.tabId === "string"
  );
}

function openChannel(): BroadcastChannel | undefined {
  return typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(CHANNEL_NAME);
}

function post(channel: BroadcastChannel | undefined, message: ChangeMessage): void {
  // BroadcastChannel has no target origin; the lint rule is written for window.postMessage.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  channel?.postMessage(message);
}

/** Tells every other tab that `treeId` was renamed or deleted (the tree list does this). */
export function announceTreeChange(
  treeId: string,
  change: TreeChange,
  opts: { tabId?: string } = {},
): void {
  const channel = openChannel();
  post(channel, { type: change, treeId, tabId: opts.tabId ?? TAB_ID });
  channel?.close();
}

/**
 * Tells other tabs when this tab saves `treeId`, and calls `onRemoteChange` when another tab
 * saves, renames or deletes it. `opts.tabId` exists for tests.
 */
export function createTabSync(
  treeId: string,
  onRemoteChange: (change: TreeChange) => void,
  opts: { tabId?: string } = {},
) {
  const tabId = opts.tabId ?? TAB_ID;
  const channel = openChannel();

  channel?.addEventListener("message", (event: MessageEvent) => {
    const data: unknown = event.data;
    if (isChangeMessage(data) && data.treeId === treeId && data.tabId !== tabId) {
      onRemoteChange(data.type);
    }
  });

  return {
    announceSave(): void {
      post(channel, { type: "saved", treeId, tabId });
    },
    close(): void {
      channel?.close();
    },
  };
}
