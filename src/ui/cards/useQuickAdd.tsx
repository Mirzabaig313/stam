import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { LayoutNode } from "@/core/layout/types";
import type { Rect } from "@/ui/canvas/viewport";
import { nodeIdOf } from "@/ui/keyboard/focusCard";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { Handles, MIN_HANDLE_CARD_WIDTH } from "./Handles";
import { InlineEditor } from "./InlineEditor";
import type { AddRole } from "./nameEntry";
import { quickAddRoles, startAdd } from "./quickAdd";

/** The pointer may cross this gap between a card and its handles without hiding them. */
const LEAVE_GRACE_MS = 250;
/** How long a refused add's message stays by the card. */
const REFUSED_MS = 4000;

type Active = {
  /** Node under the pointer (its card or its handles). */
  hovered: string | null;
  /** Node whose card or handles have the keyboard focus. */
  focused: string | null;
  /** Which of the two moved last: the pointer and the keyboard may be on different cards. */
  last: "hover" | "focus";
  /** The last add the model refused, shown by the card it came from. */
  refused: { nodeId: string; code: string } | null;
};

/** The one card whose handles show: where the pointer or keyboard went last. */
function pointedNode(a: Active): string | null {
  return a.last === "hover" ? (a.hovered ?? a.focused) : (a.focused ?? a.hovered);
}

type ActiveStore = StoreApi<Active>;

function NodeExtras({ node, rect, active }: { node: LayoutNode; rect: Rect; active: ActiveStore }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const editing = useEditor((s) => s.editing);
  const primary = useEditor((s) => s.layout?.primaryNode[node.personId] === node.nodeId);
  const selected = useEditor((s) => s.selectedId === node.personId);
  const roles = useEditor((s) => quickAddRoles(s.viewMode, node));
  // One card shows handles at a time. With none pointed at, the selected card shows its own.
  const pointed = useStore(active, (a) => pointedNode(a) === node.nodeId);
  const nothingPointed = useStore(active, (a) => pointedNode(a) === null);
  const refused = useStore(active, (a) => (a.refused?.nodeId === node.nodeId ? a.refused : null));

  useEffect(() => {
    if (!refused) return;
    const timer = setTimeout(() => {
      if (active.getState().refused === refused) active.setState({ refused: null });
    }, REFUSED_MS);
    return () => clearTimeout(timer);
  }, [refused, active]);

  if (editing) {
    if (editing.personId !== node.personId || !primary) return null;
    return (
      <InlineEditor
        personId={editing.personId}
        role={editing.role}
        fromId={editing.fromId}
        rect={rect}
      />
    );
  }

  const add = (role: AddRole, unionId?: string) => {
    active.setState({ refused: null });
    if (startAdd(store, role, node.personId, unionId)) return;
    active.setState({
      refused: { nodeId: node.nodeId, code: store.getState().error ?? "INVALID" },
    });
  };

  const visible =
    node.kind !== "linked" &&
    roles.size > 0 &&
    rect.width >= MIN_HANDLE_CARD_WIDTH &&
    (pointed || (selected && primary && nothingPointed));
  return (
    <>
      {visible && <Handles node={node} rect={rect} onAdd={add} roles={roles} />}
      {refused && (
        <p
          className="quick-add__refused"
          role="alert"
          style={{ transform: `translate(${rect.x}px, ${rect.y + rect.height + 8}px)` }}
        >
          {t(`handles.error.${refused.code}`)}
        </p>
      )}
    </>
  );
}

export type QuickAddOptions = {
  /** Brings a person's card on screen (the canvas's `centerOnPerson`). */
  reveal?: (personId: string) => void;
  /** Px at the bottom of the canvas hidden under something (the panel's bottom sheet). */
  coveredBottom?: () => number;
  /**
   * Whether the person's card will be on screen once the camera settles (the canvas's
   * `isPersonInView`). Re-layout glides the camera to keep the selected card still, which can
   * carry a new card off screen after the editor first appears; without this, the editor's
   * current box is used.
   */
  isOnScreen?: (personId: string) => boolean;
};

/**
 * Quick add on the canvas: `renderNodeExtras` for `Canvas` draws the "+" handles on the hovered
 * or keyboard-focused card, else on the selected one (one card shows handles at a time), and the inline editor over a card being added. When the
 * new card is off screen, `reveal` brings it into view.
 */
export function useQuickAdd({ reveal, coveredBottom, isOnScreen }: QuickAddOptions = {}): {
  renderNodeExtras: (node: LayoutNode, rect: Rect) => ReactNode;
} {
  const [active] = useState(() =>
    createStore<Active>(() => ({ hovered: null, focused: null, last: "hover", refused: null })),
  );
  const editing = useEditor((s) => s.editing);
  const latest = useRef({ reveal, coveredBottom, isOnScreen });
  useLayoutEffect(() => {
    latest.current = { reveal, coveredBottom, isOnScreen };
  });

  // Which card the pointer and the keyboard are on. Cards live in the SVG and handles in the
  // overlay, so both are watched from the document; neither listens for keys.
  useEffect(() => {
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const leave = () => {
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => active.setState({ hovered: null }), LEAVE_GRACE_MS);
    };
    const onPointerOver = (e: PointerEvent) => {
      const nodeId = nodeIdOf(e.target);
      if (nodeId === null) return leave();
      clearTimeout(leaveTimer);
      active.setState({ hovered: nodeId, last: "hover" });
    };
    const onPointerOut = (e: PointerEvent) => {
      if (e.relatedTarget === null) leave();
    };
    const onFocusIn = (e: FocusEvent) => {
      const nodeId = nodeIdOf(e.target);
      active.setState(nodeId === null ? { focused: null } : { focused: nodeId, last: "focus" });
    };
    const onFocusOut = (e: FocusEvent) => active.setState({ focused: nodeIdOf(e.relatedTarget) });
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      clearTimeout(leaveTimer);
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [active]);

  // A new card can land off screen (a wide family, a far-away parent) or under the bottom sheet:
  // bring it into view.
  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      const { isOnScreen: judge } = latest.current;
      if (judge) {
        if (!judge(editing.personId)) latest.current.reveal?.(editing.personId);
        return;
      }
      const canvas = document.querySelector(".stam-canvas");
      if (!canvas) return;
      const form = document.querySelector(`[data-editing-for="${editing.personId}"]`);
      const box = canvas.getBoundingClientRect();
      const r = form?.getBoundingClientRect();
      const onScreen =
        r !== undefined &&
        r.left >= box.left &&
        r.top >= box.top &&
        r.right <= box.right &&
        r.bottom <= box.bottom - (latest.current.coveredBottom?.() ?? 0);
      if (!onScreen) latest.current.reveal?.(editing.personId);
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  const renderNodeExtras = useCallback(
    (node: LayoutNode, rect: Rect) => <NodeExtras node={node} rect={rect} active={active} />,
    [active],
  );
  return { renderNodeExtras };
}
