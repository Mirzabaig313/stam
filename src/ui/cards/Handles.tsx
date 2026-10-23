import "./handles.css";

import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { CARD_W, COUPLE_GAP } from "@/core/layout/constants";
import type { LayoutNode } from "@/core/layout/types";
import { parentsOf, unionsOf } from "@/core/model/tree";
import { useTreeDir } from "@/ui/canvas/treeDirection";
import type { Rect } from "@/ui/canvas/viewport";
import { focusCard } from "@/ui/keyboard/focusCard";
import { useEditor } from "@/ui/store/useEditor";

import { personLabel } from "./describe";
import type { AddRole } from "./nameEntry";
import { UnionChooser } from "./UnionChooser";

/** Handle buttons are this many px square on screen at every zoom (a 24 px touch target). */
export const HANDLE_SIZE = 24;
const HALF = HANDLE_SIZE / 2;
/**
 * Clear space between a card's edge and a handle. It clears the card's keyboard focus ring too,
 * which is drawn 2 px wide starting 2 px out.
 */
const EDGE_GAP = 4;
/** The least space left between a side handle and the neighbouring card. */
const NEIGHBOUR_GAP = 2;
/** Side handles need this much room between two cards. */
const SIDE_ROOM = EDGE_GAP + HANDLE_SIZE + NEIGHBOUR_GAP;
/** The "+N" badge reaches this far below the card, in card px. */
const BADGE_REACH = 9;

/** Below this on-screen card width the cards show only a name or a dot: no handles. */
export const MIN_HANDLE_CARD_WIDTH = CARD_W * 0.45;

export type HandlesProps = {
  node: LayoutNode;
  /** The card's box on screen, in px from the canvas's top-left corner. */
  rect: Rect;
  onAdd: (role: AddRole, unionId?: string) => void;
  /** The adds this view can draw (see `quickAddRoles`); every one when left out. */
  roles?: ReadonlySet<AddRole>;
};

const EVERY_ROLE: ReadonlySet<AddRole> = new Set(["parent", "child", "spouse", "sibling"]);

type Open = "start" | "end" | "union" | null;

type Point = [x: number, y: number];

/** Places an element at screen px; `shift` then moves it by a share of its own width. */
const at = (x: number, y: number, shift = 0): CSSProperties => ({
  transform: `translate(${x}px, ${y}px)${shift ? ` translateX(${shift * 100}%)` : ""}`,
});

/**
 * The quick-add "+" handles around a card: top adds a parent (hidden with two biological
 * parents), bottom adds a child (asking which union first when there are several), and both sides
 * open a "Spouse" / "Sibling" chooser. Positions are physical screen px, like `rect`.
 */
export function Handles({ node, rect, onAdd, roles = EVERY_ROLE }: HandlesProps) {
  const { t } = useTranslation();
  // The drawing's direction, which the tree-direction setting can set apart from the language's.
  const rtl = useTreeDir() === "rtl";
  const doc = useEditor((s) => s.doc);
  const [open, setOpen] = useState<Open>(null);
  const handleRefs = useRef<Partial<Record<"start" | "end" | "union", HTMLButtonElement | null>>>(
    {},
  );
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === "start" || open === "end") menuRef.current?.querySelector("button")?.focus();
  }, [open]);

  const person = doc?.persons[node.personId];
  if (!doc || !person) return null;

  const name = personLabel(person, t);
  const besideRoles = (["spouse", "sibling"] as const).filter((role) => roles.has(role));
  const parents = parentsOf(doc, node.personId);
  const unionCount = unionsOf(doc, node.personId).length;
  const k = rect.width / CARD_W;
  const { width: w, height: h } = rect;

  // "↑ View family" sits above a spouse card's inline-end corner: move the top handle clear of it.
  const familyButton = node.kind === "spouse" && parents.length > 0;
  const topX = familyButton ? (rtl ? w * 0.75 : w * 0.25) : w / 2;
  // Every handle sits outside its card edge: above, or below (past the "+N" badge of a collapsed
  // card). Nothing is ever drawn over a name, avatar or date.
  const topY = -HANDLE_SIZE - EDGE_GAP;
  const bottomY = (node.hiddenCount > 0 ? h + BADGE_REACH * k : h) + EDGE_GAP;
  // The side handles stand centred on the side edges, in the gap to the neighbour. When zoomed
  // out the couple gap is narrower than a handle, so they join the bottom handle in a row below
  // the card instead of covering the neighbouring card.
  const roomBeside = COUPLE_GAP * k >= SIDE_ROOM;
  const left: Point = roomBeside
    ? [-HANDLE_SIZE - EDGE_GAP, h / 2 - HALF]
    : [w / 2 - HALF - EDGE_GAP - HANDLE_SIZE, bottomY];
  const right: Point = roomBeside
    ? [w + EDGE_GAP, h / 2 - HALF]
    : [w / 2 + HALF + EDGE_GAP, bottomY];
  // Inline-start and inline-end in screen terms: the start side is the left one in LTR.
  const startAt = rtl ? right : left;
  const endAt = rtl ? left : right;

  const close = (back: "start" | "end" | "union") => {
    setOpen(null);
    handleRefs.current[back]?.focus();
  };

  const onMenuKey = (side: "start" | "end") => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(side);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    e.stopPropagation();
    const items = [...e.currentTarget.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  const onMenuBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(null);
  };

  // Tab goes from a card to its handles; Shift+Tab from the first handle goes back to the card
  // (the canvas's own tab stop may be another card).
  const backToCard = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Tab" || !e.shiftKey) return;
    const first = e.currentTarget.parentElement?.querySelector(".quick-add__handle");
    if (first === e.currentTarget && focusCard(node.nodeId)) e.preventDefault();
  };

  // `edge` is where the button is on screen, which is what its label says (RTL swaps start and end).
  const sideHandle = (side: "start" | "end", [x, y]: Point, edge: "Left" | "Right") => (
    <button
      ref={(el) => {
        handleRefs.current[side] = el;
      }}
      type="button"
      className="quick-add__handle"
      onKeyDown={backToCard}
      style={at(x, y)}
      aria-label={t(`handles.addBeside${edge}`, { name })}
      aria-haspopup="menu"
      aria-expanded={open === side}
      onClick={() => setOpen(open === side ? null : side)}
    >
      <span aria-hidden="true">+</span>
    </button>
  );

  // The menu opens outward from its handle: beside it, or under it when the handle is in the row
  // below the card.
  const menuAt = open === "start" ? startAt : endAt;
  const menuOnLeft = menuAt === left;
  const menuStyle = roomBeside
    ? at(menuOnLeft ? menuAt[0] - 4 : menuAt[0] + HANDLE_SIZE + 4, menuAt[1], menuOnLeft ? -1 : 0)
    : at(
        menuOnLeft ? menuAt[0] + HANDLE_SIZE : menuAt[0],
        menuAt[1] + HANDLE_SIZE + 4,
        menuOnLeft ? -1 : 0,
      );

  return (
    <div className="quick-add" data-handles-for={node.nodeId} style={at(rect.x, rect.y)}>
      {parents.length < 2 && roles.has("parent") && (
        <button
          type="button"
          className="quick-add__handle"
          onKeyDown={backToCard}
          style={at(topX - HALF, topY)}
          aria-label={t("handles.addParent", { name })}
          onClick={() => onAdd("parent")}
        >
          <span aria-hidden="true">+</span>
        </button>
      )}
      {besideRoles.length > 0 && sideHandle("start", startAt, rtl ? "Right" : "Left")}
      {besideRoles.length > 0 && sideHandle("end", endAt, rtl ? "Left" : "Right")}
      {roles.has("child") && (
        <button
          ref={(el) => {
            handleRefs.current.union = el;
          }}
          type="button"
          className="quick-add__handle"
          onKeyDown={backToCard}
          style={at(w / 2 - HALF, bottomY)}
          aria-label={t("handles.addChild", { name })}
          aria-haspopup={unionCount >= 2 ? "dialog" : undefined}
          aria-expanded={unionCount >= 2 ? open === "union" : undefined}
          onClick={() => {
            if (unionCount >= 2) setOpen(open === "union" ? null : "union");
            else onAdd("child");
          }}
        >
          <span aria-hidden="true">+</span>
        </button>
      )}

      {(open === "start" || open === "end") && (
        <div
          ref={menuRef}
          className="quick-add__menu"
          style={menuStyle}
          role="menu"
          tabIndex={-1}
          aria-label={t("handles.besideMenu", { name })}
          onKeyDown={onMenuKey(open)}
          onBlur={onMenuBlur}
        >
          {besideRoles.map((role) => (
            <button key={role} type="button" role="menuitem" onClick={() => onAdd(role)}>
              {t(`handles.${role}`)}
            </button>
          ))}
        </div>
      )}

      {open === "union" && (
        <div className="quick-add__popover" style={at(w / 2, bottomY + HANDLE_SIZE + 4, -0.5)}>
          <UnionChooser
            personId={node.personId}
            onChoose={(unionId) => onAdd("child", unionId)}
            onCancel={() => close("union")}
          />
        </div>
      )}
    </div>
  );
}
