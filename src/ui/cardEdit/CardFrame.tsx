import "./cardEdit.css";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { nodeHeight, nodeWidth } from "@/core/layout/result";
import type { LayoutNode } from "@/core/layout/types";
import { type LineKey, LINES, SIZE_PERCENT } from "@/templates/cardStyle";
import type { Rect } from "@/ui/canvas/viewport";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { cardEdit, clampPercent, patched, without } from "./actions";
import { CardToolbar, TextToolbar } from "./Toolbars";
import { useStyleGesture } from "./useStyleGesture";

type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
const CORNERS: readonly Corner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];
/** Alt + Shift + arrow keys resize the focused card by this much, in layout px. */
const KEY_STEP = 8;
/** Room the toolbar needs above the card; with less, it goes below. */
const TOOLBAR_ROOM = 96;

type Box = { x: number; y: number; width: number; height: number };

/** Where a card's name and years lines are on screen, relative to the overlay. */
function measureLines(nodeId: string, overlay: Element | null): Partial<Record<LineKey, Box>> {
  const out: Partial<Record<LineKey, Box>> = {};
  if (!overlay) return out;
  const origin = overlay.getBoundingClientRect();
  const card = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
  for (const key of LINES) {
    const el = card?.querySelector(`[data-line="${key}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    out[key] = {
      x: r.left - origin.left - 4,
      y: r.top - origin.top - 2,
      width: r.width + 8,
      height: r.height + 4,
    };
  }
  return out;
}

const sameBoxes = (a: Partial<Record<LineKey, Box>>, b: Partial<Record<LineKey, Box>>) =>
  LINES.every((k) => {
    const p = a[k];
    const q = b[k];
    return (
      p === q ||
      (!!p && !!q && p.x === q.x && p.y === q.y && p.width === q.width && p.height === q.height)
    );
  });

/**
 * The selected card, ready to edit: four corner handles that resize it (Shift keeps its shape, Esc
 * puts it back, a double-click returns it to the template's size), a box around each of its lines
 * that a click selects, and the card or text toolbar above it.
 */
export function CardFrame({ node, rect }: { node: LayoutNode; rect: Rect }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const gesture = useStyleGesture();
  const metrics = useEditor((s) => s.layout?.metrics);
  const line = useStore(cardEdit, (s) => (s.line?.personId === node.personId ? s.line.key : null));
  const ref = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Partial<Record<LineKey, Box>>>({});
  const [announce, setAnnounce] = useState("");

  // The lines move with the card: measure them again whenever it is drawn somewhere else or
  // in another style.
  const style = useEditor((s) => s.cardStyles[node.personId]);
  const look = useEditor((s) => s.look);
  useLayoutEffect(() => {
    const next = measureLines(node.nodeId, ref.current?.closest(".stam-canvas__overlay") ?? null);
    setLines((prev) => (sameBoxes(prev, next) ? prev : next));
  }, [node.nodeId, rect.x, rect.y, rect.width, rect.height, style, look]);

  // Esc leaves the text toolbar for the card toolbar before it clears the selection.
  useEffect(() => {
    if (!line) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cardEdit.setState({ line: null });
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [line]);

  // Alt + Shift + arrows resize the selected card, one undo step per press.
  useEffect(() => {
    if (!metrics) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || !e.key.startsWith("Arrow")) return;
      e.preventDefault();
      e.stopPropagation();
      const w = nodeWidth(node, metrics);
      const h = nodeHeight(node, metrics);
      const dw = e.key === "ArrowRight" ? KEY_STEP : e.key === "ArrowLeft" ? -KEY_STEP : 0;
      const dh = e.key === "ArrowDown" ? KEY_STEP : e.key === "ArrowUp" ? -KEY_STEP : 0;
      const size = {
        w: clampPercent(((w + dw) / metrics.cardW) * 100),
        h: clampPercent(((h + dh) / metrics.cardH) * 100),
      };
      gesture.commit(patched(store.getState().cardStyles, node.personId, { size }), "Resize card");
      setAnnounce(t("cardEdit.sizeNow", size));
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [node, metrics, gesture, store, t]);

  if (!metrics) return null;
  const w0 = nodeWidth(node, metrics);
  const h0 = nodeHeight(node, metrics);
  const zoom = rect.width / w0;

  function startResize(corner: Corner, e: ReactPointerEvent<HTMLButtonElement>) {
    if (!metrics) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    const signX = corner.endsWith("Left") ? -1 : 1;
    const signY = corner.startsWith("top") ? -1 : 1;
    let frame = 0;
    let last: { w: number; h: number } | null = null;
    const sizeAt = (ev: PointerEvent) => {
      let w = w0 + (signX * (ev.clientX - start.x)) / zoom;
      let h = h0 + (signY * (ev.clientY - start.y)) / zoom;
      if (ev.shiftKey) {
        const k = Math.max(w / w0, h / h0);
        w = w0 * k;
        h = h0 * k;
      }
      return {
        w: clampPercent((w / metrics.cardW) * 100),
        h: clampPercent((h / metrics.cardH) * 100),
      };
    };
    const onMove = (ev: PointerEvent) => {
      last = sizeAt(ev);
      cancelAnimationFrame(frame);
      const size = last;
      frame = requestAnimationFrame(() =>
        gesture.preview(patched(store.getState().cardStyles, node.personId, { size })),
      );
    };
    const finish = (keep: boolean) => {
      cancelAnimationFrame(frame);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onEsc, true);
      if (keep && last) {
        gesture.commit(
          patched(store.getState().cardStyles, node.personId, { size: last }),
          "Resize card",
        );
        setAnnounce(t("cardEdit.sizeNow", last));
      } else {
        gesture.cancel();
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onEsc, true);
  }

  const resetSize = () =>
    gesture.commit(without(store.getState().cardStyles, node.personId, ["size"]), "Resize card");

  const below = rect.y < TOOLBAR_ROOM;
  return (
    <div ref={ref} className="card-frame" data-card-frame={node.personId}>
      {CORNERS.map((corner) => (
        <button
          key={corner}
          type="button"
          className={`card-frame__handle card-frame__handle--${corner}`}
          style={{
            left: corner.endsWith("Left") ? rect.x : rect.x + rect.width,
            top: corner.startsWith("top") ? rect.y : rect.y + rect.height,
          }}
          aria-label={t(`cardEdit.resize.${corner}`)}
          title={t("cardEdit.resizeHint")}
          onPointerDown={(e) => startResize(corner, e)}
          onDoubleClick={resetSize}
        />
      ))}
      {LINES.map((key) => {
        const box = lines[key];
        if (!box) return null;
        return (
          <button
            key={key}
            type="button"
            className={
              line === key ? "card-frame__line card-frame__line--selected" : "card-frame__line"
            }
            style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
            aria-label={t(`cardEdit.editLine.${key}`)}
            aria-pressed={line === key}
            onClick={() => cardEdit.setState({ line: { personId: node.personId, key } })}
          />
        );
      })}
      <div
        className={below ? "card-frame__bar card-frame__bar--below" : "card-frame__bar"}
        style={{
          left: rect.x + rect.width / 2,
          // Clear of the quick-add "+" above (or below) the card.
          top: below ? rect.y + rect.height + 44 : rect.y - 44,
        }}
      >
        {line ? <TextToolbar node={node} line={line} /> : <CardToolbar node={node} />}
      </div>
      <output className="visually-hidden">{announce}</output>
    </div>
  );
}

/** Size limits as percent, for tests and the slider-free keyboard path. */
export const RESIZE_LIMITS = SIZE_PERCENT;
