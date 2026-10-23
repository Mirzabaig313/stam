import "@fontsource-variable/archivo/wdth-italic.css";
import "./canvas.css";

import {
  type FocusEvent,
  forwardRef,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";

import { CARD_H, CARD_W } from "@/core/layout/constants";
import type { LayoutNode, LayoutResult } from "@/core/layout/types";
import type { TreeDocument } from "@/core/model/types";
import { type CardNode, type DragRole, PersonCard } from "@/ui/cards/PersonCard";
import type { DropTarget } from "@/ui/dnd/resolveDrop";

import { dimmedEdgeIds, focusSet, mirrorFrame } from "./derive";
import { Edges } from "./Edges";
import { GenerationRuler, rowsOf } from "./GenerationRuler";
import { Minimap } from "./Minimap";
import { REFLOW_MS } from "./motion";
import { useLayoutTween } from "./useLayoutTween";
import { usePanZoom } from "./usePanZoom";
import { centerOn, fitBounds, intersects, lod, type Rect, visibleRect, zoomAt } from "./viewport";

type Point = [number, number];

/** Zoom buttons step by this factor. */
const ZOOM_STEP = 1.2;
/** Culling margin around the screen, in screen px. */
const CULL_MARGIN = 200;
/** A focused card closer than this to the screen edge is scrolled into the middle. */
const FOCUS_MARGIN = 24;
/** The reorder insertion line overhangs the row by this much, top and bottom. */
const DROP_LINE_OVERHANG = 8;

/** What a running drag shows on the canvas: the dragged person and what the pointer is over. */
export type DragFeedback = { personId: string; target: DropTarget };

/** `data-drag` on the canvas while dragging: lets CSS show a not-allowed cursor. */
function dragState(feedback: DragFeedback): "none" | "allowed" | "blocked" | "reorder" {
  const { target } = feedback;
  if (target.kind === "person") return target.actions.length > 0 ? "allowed" : "blocked";
  return target.kind;
}

function dragRoleOf(feedback: DragFeedback | null | undefined, personId: string): DragRole {
  if (!feedback) return undefined;
  if (feedback.personId === personId) return "source";
  const { target } = feedback;
  if (target.kind !== "person" || target.personId !== personId) return undefined;
  return target.actions.length > 0 ? "target" : "blocked";
}

export type CanvasProps = {
  doc: TreeDocument;
  layout: LayoutResult;
  selectedId: string | null;
  /** Dim everyone who is not the selected person, an ancestor or a descendant. */
  focusMode: boolean;
  /** RTL mirrors the tree, so it reads right to left. */
  dir: "ltr" | "rtl";
  onSelect: (personId: string | null) => void;
  onToggleCollapse: (personId: string) => void;
  /** "↑ View family" on a spouse card: called with the spouse's topmost biological ancestor. */
  onViewFamily: (personId: string) => void;
  photoUrl: (photoId: string) => string | undefined;
  /** Collapsed person ids; without it, a card counts as collapsed when it has hidden descendants. */
  collapsed?: ReadonlySet<string>;
  /**
   * Extra HTML per rendered node (quick-add handles, the inline editor), drawn in an overlay above
   * the SVG. `screenRect` is the card's box in px from the canvas's top-left corner.
   */
  renderNodeExtras?: (node: LayoutNode, screenRect: Rect) => ReactNode;
  /** Pointer pressed on a card (drag and drop starts here). */
  onNodePointerDown?: (node: LayoutNode, event: PointerEvent<SVGGElement>) => void;
  /** Right-click, or Shift+F10 / the ContextMenu key on a focused card. */
  onNodeContextMenu?: (
    node: LayoutNode,
    event: MouseEvent<SVGGElement> | KeyboardEvent<SVGGElement>,
  ) => void;
  /**
   * Drag and drop feedback: the dragged person's cards fade, the card under the pointer is
   * outlined (allowed) or struck through (not allowed), and a reorder draws an insertion line.
   */
  dragFeedback?: DragFeedback | null;
  /** Touch: a second finger started a pinch, so a card's press (long-press, drag) must stop. */
  onTouchTakeover?: () => void;
  /** Touch: a card is picked up, so its finger moves the card rather than the canvas. */
  isCardHeld?: () => boolean;
};

/**
 * Imperative controls. World points are layout coordinates (as in `LayoutResult`); screen
 * points are px from the canvas's top-left corner.
 */
export type CanvasHandle = {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  /**
   * Glides the person's card to the middle of the screen. `bottomInset` is how many px at the
   * bottom are covered (a bottom sheet): the card is centred in the area above them.
   */
  centerOnPerson(personId: string, options?: { bottomInset?: number }): void;
  worldToScreen(p: Point): Point;
  screenToWorld(p: Point): Point;
};

/**
 * The family-tree canvas: an SVG of cards and connectors with pan and zoom, off-screen culling,
 * level of detail, animated re-layout, a generation ruler and a minimap. Presentational: all
 * state comes in through props and goes out through callbacks.
 */
export const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(props, ref) {
  const { doc, layout, selectedId, focusMode, dir, collapsed, renderNodeExtras, dragFeedback } =
    props;
  const { t } = useTranslation();
  const containerRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const { viewport, size, viewportRef, setViewport, goal, isPinching } = usePanZoom(
    containerRef,
    svgRef,
    {
      isBackground: (el) => el.closest("[data-node-id]") === null,
      onBackgroundClick: () => propsRef.current.onSelect(null),
      onTouchTakeover: () => propsRef.current.onTouchTakeover?.(),
      isCardHeld: () => propsRef.current.isCardHeld?.() ?? false,
    },
  );

  // ---- What to draw -----------------------------------------------------------------------
  const rtl = dir === "rtl";
  /** Layout x to drawing x (and back: the mirror is its own inverse). */
  const flipX = (x: number) => (rtl ? -x : x);

  const frame = useLayoutTween(layout);
  const display = useMemo(() => (rtl ? mirrorFrame(frame) : frame), [frame, rtl]);
  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.nodeId, n])), [layout]);
  const bounds = useMemo((): Rect => {
    const b = layout.bounds;
    return rtl ? { ...b, x: -(b.x + b.width) } : b;
  }, [layout, rtl]);
  const rows = useMemo(() => rowsOf(display.nodes), [display]);

  const focus = useMemo(
    () => (focusMode && selectedId && doc.persons[selectedId] ? focusSet(doc, selectedId) : null),
    [focusMode, selectedId, doc],
  );
  const dimmedEdges = useMemo(
    () => (focus ? dimmedEdgeIds(layout.edges, layout.nodes, doc, focus) : null),
    [focus, layout, doc],
  );

  const edgeBoxes = useMemo(
    () =>
      display.edges.map((edge): Rect => {
        const xs = edge.points.map((p) => p[0]);
        const ys = edge.points.map((p) => p[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return {
          x: x - 2,
          y: y - 2,
          width: Math.max(...xs) - x + 4,
          height: Math.max(...ys) - y + 4,
        };
      }),
    [display],
  );

  const selectedNodeId = selectedId ? layout.primaryNode[selectedId] : undefined;
  const tabStop = selectedNodeId ?? layout.nodes[0]?.nodeId;

  const visible = visibleRect(viewport, size, CULL_MARGIN);
  const shownNodes = display.nodes.filter(
    (n) =>
      n.nodeId === tabStop ||
      intersects({ x: n.x, y: n.y, width: CARD_W, height: CARD_H }, visible),
  );
  const shownEdges = display.edges.filter((_, i) => intersects(edgeBoxes[i]!, visible));
  const level = lod(viewport.k);

  // ---- Camera -----------------------------------------------------------------------------
  const centreOf = (node: LayoutNode): Point => [flipX(node.x + CARD_W / 2), node.y + CARD_H / 2];

  const centerOnPerson = (personId: string, options: { bottomInset?: number } = {}) => {
    const nodeId = propsRef.current.layout.primaryNode[personId];
    const node = nodeId ? nodeById.get(nodeId) : undefined;
    const inset = Math.min(Math.max(options.bottomInset ?? 0, 0), size.height);
    const area = { width: size.width, height: size.height - inset };
    if (node) setViewport(centerOn(goal(), centreOf(node), area), true);
  };

  useImperativeHandle(ref, () => ({
    zoomIn: () => setViewport(zoomAt(goal(), [size.width / 2, size.height / 2], ZOOM_STEP), true),
    zoomOut: () =>
      setViewport(zoomAt(goal(), [size.width / 2, size.height / 2], 1 / ZOOM_STEP), true),
    fit: () => setViewport(fitBounds(bounds, size), true),
    centerOnPerson,
    worldToScreen: ([x, y]) => {
      const v = viewportRef.current;
      return [flipX(x) * v.k + v.x, y * v.k + v.y];
    },
    screenToWorld: ([x, y]) => {
      const v = viewportRef.current;
      return [flipX((x - v.x) / v.k), (y - v.y) / v.k];
    },
  }));

  // Fit when the tree first has a size, and again when the direction or the view root changes.
  const fittedFor = useRef<string | null>(null);
  const fitKey = `${dir}|${layout.nodes[0]?.nodeId ?? ""}`;
  useLayoutEffect(() => {
    if (size.width === 0 || size.height === 0 || layout.nodes.length === 0) return;
    if (fittedFor.current === fitKey) return;
    const first = fittedFor.current === null;
    fittedFor.current = fitKey;
    setViewport(fitBounds(bounds, size), !first);
  }, [fitKey, size, bounds, layout, setViewport]);

  // Re-layout (collapse, edits): keep the card the user acted on (the toggled person, else the
  // selected one) still on screen. The camera moves with the same duration and easing as the
  // cards' tween, so the card does not move at all. A new view root or direction refits instead.
  const anchorRef = useRef<string | null>(null);
  const previous = useRef({ layout, fitKey });
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { layout, fitKey };
    const personId = anchorRef.current ?? propsRef.current.selectedId;
    anchorRef.current = null;
    if (before.layout === layout || before.fitKey !== fitKey || !personId) return;
    const nodeIn = (l: LayoutResult) => {
      const nodeId = l.primaryNode[personId];
      return l.nodes.find((n) => n.nodeId === nodeId);
    };
    const from = nodeIn(before.layout);
    const to = nodeIn(layout);
    if (!from || !to) return;
    const dx = flipX(to.x - from.x);
    const dy = to.y - from.y;
    if (dx === 0 && dy === 0) return;
    const v = goal();
    setViewport({ ...v, x: v.x - dx * v.k, y: v.y - dy * v.k }, true, REFLOW_MS);
    // flipX only reads `rtl`, which is part of fitKey.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, fitKey, goal, setViewport]);

  // ---- Card callbacks: stable, so memoised cards skip re-rendering while panning -------------
  const cardHandlers = useMemo(() => {
    const layoutNode = (node: CardNode): LayoutNode =>
      propsRef.current.layout.nodes.find((n) => n.nodeId === node.nodeId) ?? node;
    return {
      onSelect: (personId: string) => propsRef.current.onSelect(personId),
      onToggleCollapse: (personId: string) => {
        anchorRef.current = personId;
        propsRef.current.onToggleCollapse(personId);
      },
      onViewFamily: (personId: string) => propsRef.current.onViewFamily(personId),
      onPointerDown: (node: CardNode, e: PointerEvent<SVGGElement>) => {
        // A finger that joins a pinch is the pinch's, even when it lands on a card.
        if (e.pointerType === "touch" && isPinching()) return;
        propsRef.current.onNodePointerDown?.(layoutNode(node), e);
      },
      onContextMenu: (node: CardNode, e: MouseEvent<SVGGElement> | KeyboardEvent<SVGGElement>) =>
        propsRef.current.onNodeContextMenu?.(layoutNode(node), e),
    };
  }, [isPinching]);
  const seeOriginalRef = useRef(centerOnPerson);
  useLayoutEffect(() => {
    seeOriginalRef.current = centerOnPerson;
  });
  const onSeeOriginal = useMemo(
    () => (personId: string) => {
      seeOriginalRef.current(personId);
      propsRef.current.onSelect(personId);
    },
    [],
  );

  // Keyboard focus on a card at the screen edge brings the card into the middle.
  const onFocus = (e: FocusEvent<SVGSVGElement>) => {
    const nodeId = (e.target as Element).closest("[data-node-id]")?.getAttribute("data-node-id");
    const node = nodeId ? display.nodes.find((n) => n.nodeId === nodeId) : undefined;
    if (!node) return;
    const v = viewportRef.current;
    const left = node.x * v.k + v.x;
    const top = node.y * v.k + v.y;
    const inside =
      left >= FOCUS_MARGIN &&
      top >= FOCUS_MARGIN &&
      left + CARD_W * v.k <= size.width - FOCUS_MARGIN &&
      top + CARD_H * v.k <= size.height - FOCUS_MARGIN;
    if (!inside) setViewport(centerOn(v, [node.x + CARD_W / 2, node.y + CARD_H / 2], size), true);
  };

  const photoOf = (personId: string) => {
    const photoId = doc.persons[personId]?.photoId;
    return photoId ? props.photoUrl(photoId) : undefined;
  };

  const dropLine = dragFeedback?.target.kind === "reorder" ? dragFeedback.target : null;

  const selectedBoxes = selectedId
    ? display.nodes.filter((n) => n.personId === selectedId)
    : undefined;

  return (
    <section
      ref={containerRef}
      className="stam-canvas"
      dir={dir}
      aria-label={t("canvas.region")}
      data-lod={level}
      data-drag={dragFeedback ? dragState(dragFeedback) : undefined}
    >
      <svg ref={svgRef} className="stam-canvas__svg" width="100%" height="100%" onFocus={onFocus}>
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`}>
          <Edges edges={shownEdges} lod={level} dimmedIds={dimmedEdges} />
          <g className="stam-canvas__nodes">
            {shownNodes.map((node) => (
              <PersonCard
                key={node.nodeId}
                doc={doc}
                node={node}
                lod={level}
                selected={node.personId === selectedId}
                dimmed={focus !== null && !focus.has(node.personId)}
                tabbable={node.nodeId === tabStop}
                dir={dir}
                collapsed={collapsed ? collapsed.has(node.personId) : undefined}
                photoUrl={photoOf(node.personId)}
                dragRole={dragRoleOf(dragFeedback, node.personId)}
                onSeeOriginal={onSeeOriginal}
                {...cardHandlers}
              />
            ))}
          </g>
          {dropLine && (
            <line
              className="stam-drop-line"
              x1={flipX(dropLine.indicatorX)}
              x2={flipX(dropLine.indicatorX)}
              y1={dropLine.rowY - DROP_LINE_OVERHANG}
              y2={dropLine.rowY + CARD_H + DROP_LINE_OVERHANG}
            />
          )}
        </g>
      </svg>

      {renderNodeExtras && (
        <div className="stam-canvas__overlay">
          {shownNodes.map((node) => (
            <Fragment key={node.nodeId}>
              {renderNodeExtras(nodeById.get(node.nodeId) ?? node, {
                x: node.x * viewport.k + viewport.x,
                y: node.y * viewport.k + viewport.y,
                width: CARD_W * viewport.k,
                height: CARD_H * viewport.k,
              })}
            </Fragment>
          ))}
        </div>
      )}

      {/* Ruler at inline-start, minimap at bottom inline-end: placed by flex layout, which
          follows `dir` (the bundler lowers inline insets to left/right keyed on `lang`). */}
      <div className="stam-canvas__chrome">
        <GenerationRuler
          rows={rows}
          viewport={viewport}
          height={size.height}
          activeGeneration={selectedNodeId ? nodeById.get(selectedNodeId)?.generation : null}
        />
        {layout.nodes.length > 0 && (
          <Minimap
            nodes={display.nodes}
            bounds={bounds}
            viewport={viewport}
            screen={size}
            selected={selectedBoxes}
            onCenter={(p) => setViewport(centerOn(viewportRef.current, p, size))}
          />
        )}
      </div>
    </section>
  );
});
