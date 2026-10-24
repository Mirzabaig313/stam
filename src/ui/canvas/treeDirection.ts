import { useContext, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { TEMPLATES } from "@/templates";
import { type TreeDirection, useSettings } from "@/ui/settings/settings";
import { EditorContext } from "@/ui/store/useEditor";

export type Dir = "ltr" | "rtl";

/**
 * The direction the tree is drawn in: the setting, or with "auto" the direction the tree's
 * template reads in (Shajara: right to left), else the interface's.
 */
export function resolveTreeDir(setting: TreeDirection, interfaceDir: Dir, preferred?: Dir): Dir {
  return setting === "auto" ? (preferred ?? interfaceDir) : setting;
}

/** Outside an open tree there is no template to prefer a direction. */
const NO_EDITOR = createStore(() => null);

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
  const editor = useContext(EditorContext);
  const preferred = useStore(editor ?? NO_EDITOR, (s) =>
    s ? TEMPLATES[s.look.template].preferredDirection : undefined,
  );
  return resolveTreeDir(settings.treeDirection, useInterfaceDir(), preferred);
}
