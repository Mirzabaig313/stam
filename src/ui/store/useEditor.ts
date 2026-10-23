import { createContext, useContext } from "react";
import { useStore } from "zustand";

import type { EditorActions, EditorState, EditorStore } from "./editorStore";

/** Provided by `EditorPage`; one store per open tree. */
export const EditorContext = createContext<EditorStore | null>(null);

/** The open tree's store itself, for reading state inside event handlers. */
export function useEditorStore(): EditorStore {
  const store = useContext(EditorContext);
  if (!store) throw new Error("useEditor must be used inside an EditorContext provider");
  return store;
}

/**
 * Subscribes to a slice of the editor store. The selector must return a stable value (a field,
 * not a freshly built object), or the component re-renders on every change.
 */
export function useEditor<T>(selector: (state: EditorState & EditorActions) => T): T {
  return useStore(useEditorStore(), selector);
}
