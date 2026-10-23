import { useSyncExternalStore } from "react";

import { type TreeDirection, useSettings } from "@/ui/settings/settings";

export type Dir = "ltr" | "rtl";

/** The direction the tree is drawn in: the setting, or with "auto" the interface's. */
export function resolveTreeDir(setting: TreeDirection, interfaceDir: Dir): Dir {
  return setting === "auto" ? interfaceDir : setting;
}

function subscribeToDir(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"] });
  return () => observer.disconnect();
}

const documentDir = (): Dir => (document.documentElement.dir === "rtl" ? "rtl" : "ltr");

/**
 * The interface's direction: `<html dir>`, which the language sets (through i18n). Read from the
 * document, so it always agrees with what the CSS lays out.
 */
export function useInterfaceDir(): Dir {
  return useSyncExternalStore(subscribeToDir, documentDir, () => "ltr");
}

/**
 * The tree's drawing direction for the canvas, the fan, the timeline, their handles and arrow
 * keys, and exports. RTL mirrors the family layout, so the first child is on the right.
 */
export function useTreeDir(): Dir {
  const [settings] = useSettings();
  return resolveTreeDir(settings.treeDirection, useInterfaceDir());
}
