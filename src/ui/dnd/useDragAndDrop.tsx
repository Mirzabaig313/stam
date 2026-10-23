import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { CARD_W } from "@/core/layout/constants";
import type { LayoutNode } from "@/core/layout/types";
import { descendantsOf } from "@/core/model/tree";
import type { CanvasHandle, CanvasProps } from "@/ui/canvas/Canvas";
import { SearchBox } from "@/ui/panels/SearchBox";
import { useEditorStore } from "@/ui/store/useEditor";

import { CardMenu } from "./CardMenu";
import { DragGhost } from "./DragGhost";
import { DropMenu, type RenderUnionChoice } from "./DropMenu";
import { type DropTarget, resolveDrop } from "./resolveDrop";
import { type DragSession, useDrag } from "./useDrag";

type Point = [number, number];

/** How long a refused reorder's message stays up. */
const NOTICE_MS = 4000;

type Popup =
  | { kind: "card"; personId: string; at: Point }
  | { kind: "picker"; personId: string; at: Point }
  | { kind: "drop"; draggedId: string; targetId: string; at: Point };

export type DragAndDrop = {
  /** Spread onto `Canvas`. */
  canvasProps: Pick<
    CanvasProps,
    "onNodePointerDown" | "onNodeContextMenu" | "dragFeedback" | "onTouchTakeover" | "isCardHeld"
  >;
  /** The ghost card, menus, picker and notices; mount next to the canvas. */
  layer: ReactNode;
};

/**
 * Smart drag and drop on the canvas (FR-D1..D7): drag a card between its siblings to reorder,
 * or onto another person for a menu of what is allowed. The card context menu's "Move to…" is
 * the same thing from the keyboard: pick the person with the search picker, then the menu.
 */
export function useDragAndDrop({
  canvasRef,
  renderUnionChoice,
}: {
  canvasRef: RefObject<CanvasHandle | null>;
  renderUnionChoice: RenderUnionChoice;
}): DragAndDrop {
  const { t } = useTranslation();
  const store = useEditorStore();
  const containerRef = useRef<Element | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  /** The canvas's box on the page: client px to canvas px. */
  const origin = (): Point => {
    const box = containerRef.current?.getBoundingClientRect();
    return box ? [box.left, box.top] : [0, 0];
  };

  const drag = useDrag({
    toWorld: ([x, y]) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const [ox, oy] = origin();
      return canvas.screenToWorld([x - ox, y - oy]);
    },
    resolve: (personId, world): DropTarget => {
      const { doc, layout } = store.getState();
      return doc && layout ? resolveDrop(layout, doc, personId, world) : { kind: "none" };
    },
    homeOf: (node) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      // In RTL the drawing is mirrored: the card's left edge is the screen x of its far end.
      const [ax, top] = canvas.worldToScreen([node.x, node.y]);
      const [bx] = canvas.worldToScreen([node.x + CARD_W, node.y]);
      const [ox, oy] = origin();
      return [Math.min(ax, bx) + ox, top + oy];
    },
    onDrop,
    onLongPress: (node, at) => setPopup({ kind: "card", personId: node.personId, at }),
  });

  /** Acts on a release; false sends the card back. */
  function onDrop(session: DragSession): boolean {
    const { target, node } = session;
    if (target.kind === "person") {
      if (target.actions.length === 0) return false;
      setPopup({
        kind: "drop",
        draggedId: node.personId,
        targetId: target.personId,
        at: session.pointer,
      });
      return true;
    }
    if (target.kind !== "reorder") return false;
    const { doc, dispatch } = store.getState();
    const union = doc?.unions[target.unionId];
    const from = union?.children.findIndex((c) => c.personId === node.personId) ?? -1;
    if (from < 0 || from === target.toIndex) return false; // back in its own slot
    const cmd = {
      type: "reorderChild",
      unionId: target.unionId,
      personId: node.personId,
      toIndex: target.toIndex,
    } as const;
    if (dispatch(cmd, "Reorder children") === null) {
      setNotice(store.getState().error ?? "INVALID");
      return false;
    }
    return true;
  }

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  function onNodePointerDown(node: LayoutNode, event: PointerEvent<SVGGElement>) {
    containerRef.current = event.currentTarget.closest(".stam-canvas");
    const canvas = canvasRef.current;
    if (canvas) setScale(canvas.worldToScreen([0, 1])[1] - canvas.worldToScreen([0, 0])[1]);
    drag.start(node, event);
  }

  function onNodeContextMenu(
    node: LayoutNode,
    event: MouseEvent<SVGGElement> | KeyboardEvent<SVGGElement>,
  ) {
    event.preventDefault();
    // A touch long-press is ours: it picks the card up, or opens this menu on release.
    if (drag.isPressing()) return;
    let at: Point;
    if ("clientX" in event && (event.clientX !== 0 || event.clientY !== 0)) {
      at = [event.clientX, event.clientY];
    } else {
      const box = event.currentTarget.getBoundingClientRect();
      at = [box.left, box.bottom];
    }
    setPopup({ kind: "card", personId: node.personId, at });
  }

  const session = drag.session;
  const dragFeedback = useMemo(
    () =>
      session
        ? {
            personId: session.node.personId,
            target: session.phase === "returning" ? ({ kind: "none" } as const) : session.target,
          }
        : null,
    [session],
  );

  const pickerExclude = useMemo(() => {
    if (popup?.kind !== "picker") return undefined;
    const doc = store.getState().doc;
    if (!doc) return new Set([popup.personId]);
    return new Set([popup.personId, ...descendantsOf(doc, popup.personId)]);
  }, [popup, store]);

  const close = () => setPopup(null);

  const layer = (
    <>
      {session && <DragGhost session={session} scale={scale} />}
      {popup?.kind === "card" && (
        <CardMenu
          personId={popup.personId}
          at={popup.at}
          onMoveTo={(personId) => setPopup({ kind: "picker", personId, at: popup.at })}
          onClose={close}
        />
      )}
      {popup?.kind === "picker" && (
        <SearchBox
          mode="picker"
          exclude={pickerExclude}
          onPick={(targetId) =>
            setPopup({ kind: "drop", draggedId: popup.personId, targetId, at: popup.at })
          }
          onClose={close}
        />
      )}
      {popup?.kind === "drop" && (
        <DropMenu
          key={`${popup.draggedId}>${popup.targetId}`}
          draggedId={popup.draggedId}
          targetId={popup.targetId}
          at={popup.at}
          onClose={close}
          renderUnionChoice={renderUnionChoice}
        />
      )}
      {notice && (
        <p role="alert" className="dnd-notice">
          {t(`dnd.error.${notice}`, { defaultValue: t("dnd.error.INVALID") })}
        </p>
      )}
    </>
  );

  return {
    canvasProps: {
      onNodePointerDown,
      onNodeContextMenu,
      dragFeedback,
      onTouchTakeover: drag.cancel,
      isCardHeld: drag.isHolding,
    },
    layer,
  };
}
