import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { parentUnionOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";
import { TEMPLATES } from "@/templates";
import { focusCard, nodeIdOf } from "@/ui/keyboard/focusCard";
import { type ArrowKey, nextFocus } from "@/ui/keyboard/navigation";
import type { EditorStore } from "@/ui/store/editorStore";
import { useEditorStore } from "@/ui/store/useEditor";
import { isReadOnlyView, VIEW_MODES } from "@/ui/store/viewLayouts";

/** True while a form control has the focus: its keys (Backspace, Ctrl+Z, arrows…) are its own. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable]") !== null
  );
}

const ARROWS: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * The Latin letter a shortcut key stands for. Latin layouts (QWERTY, AZERTY, Dvorak…) go by the
 * letter typed, so Ctrl+Z is the key labelled Z. Arabic, Urdu and other layouts type no Latin
 * letter, so the physical key decides (`KeyZ`, the key where QWERTY has Z).
 */
export function shortcutLetter(event: Pick<KeyboardEvent, "key" | "code">): string | null {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  const physical = /^Key([A-Z])$/.exec(event.code);
  return physical ? physical[1]!.toLowerCase() : null;
}

/** How long to wait for a revealed card to be drawn before focusing it. */
const REVEAL_WAIT_MS = 300;

type EditorKeyActions = {
  onOpenSearch: () => void;
  /** Ctrl/Cmd+E. */
  onOpenExport?: () => void;
  onRequestDelete: (personId: string) => void;
  /** Brings a person's card on screen when the keyboard moves to a card that is not drawn. */
  onReveal?: (personId: string) => void;
  /** Reading direction of the canvas; defaults to the language's. */
  dir?: "ltr" | "rtl";
};

/** The union whose sibling row the person's card sits in: the biological one, else any. */
function childUnionOf(doc: TreeDocument, personId: string) {
  return (
    parentUnionOf(doc, personId) ??
    Object.values(doc.unions).find((u) => u.children.some((c) => c.personId === personId))
  );
}

/** Alt+←/→: moves the person one place among their siblings, in the direction the user sees. */
function reorder(store: EditorStore, personId: string, key: string, dir: "ltr" | "rtl"): void {
  const doc = store.getState().doc;
  const union = doc && childUnionOf(doc, personId);
  if (!union) return;
  const from = union.children.findIndex((c) => c.personId === personId);
  const later = (key === "ArrowRight") === (dir === "ltr");
  const to = from + (later ? 1 : -1);
  if (to < 0 || to >= union.children.length) return;
  store
    .getState()
    .dispatch({ type: "reorderChild", unionId: union.id, personId, toIndex: to }, "Reorder");
}

/**
 * The editor's one document-level keyboard handler.
 * - Ctrl/Cmd+F opens search; Ctrl/Cmd+E opens the export dialog.
 * - Ctrl/Cmd+Z undoes; Shift+Ctrl/Cmd+Z and Ctrl+Y redo.
 * - Arrows move the focus between cards (`nextFocus`); Alt+←/→ reorders siblings.
 * - Enter on a focused card selects it, which opens the panel; Esc clears the selection.
 * - Delete or Backspace asks to delete the selected person.
 * - Alt+1 … Alt+6 switch the view (family, pedigree, descendants, hourglass, fan, timeline).
 * - Esc closes the relationship calculator (and its path highlight) before it clears the selection.
 * In the fan and timeline views the arrows and Enter belong to those views' own items.
 * All but search stand down while a text field has the focus; everything stands down while a
 * dialog is open or when a control already handled the key.
 */
export function useEditorKeys(actions: EditorKeyActions): void {
  const store = useEditorStore();
  const { i18n } = useTranslation();
  const latest = useRef({ ...actions, dir: actions.dir ?? i18n.dir() });
  useEffect(() => {
    latest.current = { ...actions, dir: actions.dir ?? i18n.dir() };
  });

  useEffect(() => {
    let revealTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * The card the keyboard is on; with the focus nowhere in particular, the selected person's
     * card. Other controls (toolbar, panel) keep their arrow keys.
     */
    const currentNode = (target: EventTarget | null): string | null => {
      const onCard = nodeIdOf(target);
      if (onCard !== null) return onCard;
      if (target !== document.body && target !== document) return null;
      const s = store.getState();
      return s.selectedId !== null ? (s.layout?.primaryNode[s.selectedId] ?? null) : null;
    };

    const moveFocus = (from: string, key: ArrowKey) => {
      const { doc, layout } = store.getState();
      if (!doc || !layout) return;
      const growth = TEMPLATES[store.getState().look.template].growth;
      const to = nextFocus(layout, doc, from, key, latest.current.dir, growth);
      if (to === null || focusCard(to)) return;
      // Off screen, so not drawn: bring it in, then focus it.
      const personId = layout.nodes.find((n) => n.nodeId === to)?.personId;
      if (personId === undefined || !latest.current.onReveal) return;
      latest.current.onReveal(personId);
      clearTimeout(revealTimer);
      revealTimer = setTimeout(() => focusCard(to), REVEAL_WAIT_MS);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = shortcutLetter(event);
      if (mod && !event.altKey && key === "f") {
        event.preventDefault();
        latest.current.onOpenSearch();
        return;
      }
      if (mod && !event.altKey && !event.shiftKey && key === "e" && latest.current.onOpenExport) {
        event.preventDefault();
        latest.current.onOpenExport();
        return;
      }
      if (isTyping(event.target)) return;
      const s = store.getState();

      if (mod && !event.altKey && key === "z") {
        event.preventDefault();
        if (event.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (event.ctrlKey && !event.metaKey && !event.altKey && key === "y") {
        event.preventDefault();
        s.redo();
        return;
      }

      // `code`, not `key`: with Alt held, macOS types symbols instead of digits.
      const digit = /^Digit([1-6])$/.exec(event.code);
      if (digit && event.altKey && !mod && !event.shiftKey) {
        const mode = VIEW_MODES[Number(digit[1]) - 1];
        if (mode) {
          event.preventDefault();
          s.setViewMode(mode);
        }
        return;
      }
      if (mod || event.shiftKey) return;
      const ownKeys = isReadOnlyView(s.viewMode);

      if (ARROWS.has(event.key) && !ownKeys) {
        const from = currentNode(event.target);
        if (from === null) return;
        event.preventDefault();
        if (event.altKey) {
          const personId = s.layout?.nodes.find((n) => n.nodeId === from)?.personId;
          if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && personId) {
            reorder(store, personId, event.key, latest.current.dir);
          }
          return;
        }
        moveFocus(from, event.key as ArrowKey);
        return;
      }
      if (event.altKey) return;

      if (event.key === "Enter" && !ownKeys) {
        const nodeId = nodeIdOf(event.target);
        if (nodeId === null || !(event.target as Element).matches("[data-node-id] > .stam-card")) {
          return;
        }
        const personId = s.layout?.nodes.find((n) => n.nodeId === nodeId)?.personId;
        if (personId) {
          event.preventDefault();
          s.select(personId);
        }
        return;
      }
      if (event.key === "Escape") {
        if (s.relation !== null) {
          s.closeRelation();
          return;
        }
        if (s.selectedId !== null) s.select(null);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && s.selectedId !== null) {
        event.preventDefault();
        latest.current.onRequestDelete(s.selectedId);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(revealTimer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [store]);
}
