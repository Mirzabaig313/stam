// SVG has no <button> or <a>: interactive SVG groups need explicit roles.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
import {
  type KeyboardEvent,
  memo,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useId,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";

import { lifespanLabel } from "@/core/dates/fuzzy";
import type { CardMetrics } from "@/core/layout/constants";
import type { LayoutNode } from "@/core/layout/types";
import { childrenOf, displayName, parentsOf, topmostAncestor } from "@/core/model/tree";
import type { Person, TreeDocument } from "@/core/model/types";
import { TEMPLATES } from "@/templates";
import type { CardStyle } from "@/templates/cardStyle";
import { DEFAULT_LOOK } from "@/templates/look";
import { type FaceScale, metricsFor } from "@/templates/metrics";
import { fitText, type Font, textWidth, useFontEpoch } from "@/templates/text";
import type { Palette, Template } from "@/templates/types";
import type { Lod } from "@/ui/canvas/viewport";
import { avatarHue } from "@/ui/design/avatarHue";
import { generationHue } from "@/ui/settings/colorModes";

import { describePerson, personLabel } from "./describe";
import { lifeLine } from "./years";

// Text measuring moved to the templates; the views still take it from here.
export { fitText, type Font, useFontEpoch };

const SMALL_FONT: Font = { size: 11, weight: 400 };
const BADGE_FONT: Font = { size: 11, weight: 600 };
const BIG_NAME_FONT: Font = { size: 26, weight: 600 };
const HIT = 24;

/**
 * Text that must read left to right, wrapped for an RTL drawing in LEFT-TO-RIGHT ISOLATE …
 * POP DIRECTIONAL ISOLATE. The characters are invisible and leave the element's direction (and
 * so its text-anchor) alone, which an LTR child element would not. LTR text is left as it is.
 */
export function isolateLtr(text: string, dir: "ltr" | "rtl"): string {
  return dir === "rtl" ? `⁦${text}⁩` : text;
}

/** The collapse chevron: a small disc in the card's bottom inline-end corner. */
const CHEVRON_R = 10;
/** The "+N" pill of a collapsed branch: in the same corner as the chevron, inside the card. */
const PILL_H = 18;
/** The selection ring sits this far outside the card's outline; the focus ring further out. */
const RING_GAP = 4;
const FOCUS_GAP = 7;

/** "AK" for Ali Khan; "?" for an unnamed placeholder. */
export function initialsOf(person: Person): string {
  if (person.isPlaceholder && !displayName(person)) return "?";
  return [person.firstName, person.lastName]
    .map((part) => Array.from(part.trim())[0] ?? "")
    .join("")
    .toUpperCase();
}

/** Enter and Space activate, like a native button. */
function onActivateKey(action: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    action();
  };
}

export type CardNode = LayoutNode & { opacity?: number };

/**
 * A card's part in a running drag: the dragged person (`source`, faded), or the card under the
 * pointer with something allowed (`target`, outlined) or nothing allowed (`blocked`, struck).
 */
export type DragRole = "source" | "target" | "blocked" | undefined;

/** Shift+F10 and the ContextMenu key open a focused card's context menu. */
function isContextMenuKey(e: KeyboardEvent): boolean {
  return e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);
}

/** The card's outline grown by `by` px on every side: the rings follow the face's own shape. */
function grown(W: number, H: number, by: number): string {
  const sx = (W + 2 * by) / W;
  const sy = (H + 2 * by) / H;
  return `translate(${W / 2} ${H / 2}) scale(${sx} ${sy}) translate(${-W / 2} ${-H / 2})`;
}

export type PersonCardProps = {
  doc: TreeDocument;
  /** The node to draw; `x`, `y` is where its top-left goes in the drawing. */
  node: CardNode;
  lod?: Lod;
  selected?: boolean;
  /** Focus mode: faded because the person is not a direct relative of the selected one. */
  dimmed?: boolean;
  /** The roving tab stop of the canvas. */
  tabbable?: boolean;
  dir?: "ltr" | "rtl";
  /** Whether the branch is collapsed; defaults to "has hidden descendants". */
  collapsed?: boolean;
  photoUrl?: string;
  dragRole?: DragRole;
  /**
   * The card's branch hue (0–5) for the branch colour mode; none for the root couple. The card
   * also carries its gender and generation hue: `data-color-mode` on <html> picks what is shown.
   */
  branch?: number;
  /** Today, for ages on the life line; tests pass a fixed date. */
  now?: Date;
  /** The layout's card size; the default look's when left out. */
  metrics?: CardMetrics;
  /** The tree's template and the palette to draw it in; Warm album, light, when left out. */
  template?: Template;
  palette?: Palette;
  /** The look's card and text size; 100 % when left out. */
  scale?: FaceScale;
  /** The view's top row: the eldest generation (Gallery draws it in its accent). */
  eldest?: boolean;
  /** The card's own style, on top of its template. */
  cardStyle?: CardStyle;
  /**
   * Exports: the drawing only. No roles, focus, handlers or controls, no hover or focus shapes,
   * the drawn text left readable, and `data-person-id` on the card's root group.
   */
  static?: boolean;
  onSelect?: (personId: string) => void;
  onToggleCollapse?: (personId: string) => void;
  /** Gets the topmost biological ancestor of the spouse ("↑ View family"). */
  onViewFamily?: (personId: string) => void;
  /** From a linked copy: go to the person's primary card. */
  onSeeOriginal?: (personId: string) => void;
  onPointerDown?: (node: CardNode, event: PointerEvent<SVGGElement>) => void;
  onContextMenu?: (
    node: CardNode,
    event: MouseEvent<SVGGElement> | KeyboardEvent<SVGGElement>,
  ) => void;
};

const NO_SCALE: FaceScale = { card: 1, text: 1 };
const DEFAULT_CARD = metricsFor(DEFAULT_LOOK);

function PersonCardImpl({
  doc,
  node,
  lod = "full",
  selected = false,
  dimmed = false,
  tabbable = false,
  dir = "ltr",
  collapsed,
  photoUrl,
  dragRole,
  branch,
  static: isStatic = false,
  now,
  onSelect,
  onToggleCollapse,
  onViewFamily,
  onSeeOriginal,
  onPointerDown,
  onContextMenu,
  metrics = DEFAULT_CARD,
  template = TEMPLATES.album,
  palette = template.palettes.light,
  scale = NO_SCALE,
  eldest = false,
  cardStyle,
}: PersonCardProps) {
  const { t } = useTranslation();
  // A card resized on its own carries its size; every other card is the layout's.
  const W = node.width ?? metrics.cardW;
  const H = node.height ?? metrics.cardH;
  // Its contents grow and shrink with it: by the smaller stretch, so the text still fits.
  const own = Math.min(W / metrics.cardW, H / metrics.cardH);
  // Re-render when web fonts finish loading, so names are re-fitted with the real metrics.
  useFontEpoch();
  const uid = useId().replaceAll(":", "");
  const { personId, kind, hiddenCount } = node;
  const linked = kind === "linked";
  const person = doc.persons[personId];

  const label = useMemo(
    () => describePerson(doc, personId, t, { linked, hiddenCount }),
    [doc, personId, t, linked, hiddenCount],
  );
  const hasChildren = useMemo(
    () => kind === "blood" && childrenOf(doc, personId).length > 0,
    [doc, personId, kind],
  );
  const familyRoot = useMemo(
    () =>
      kind === "spouse" && parentsOf(doc, personId).length > 0
        ? topmostAncestor(doc, personId)
        : null,
    [doc, personId, kind],
  );

  const name = person
    ? displayName(person) || (person.isPlaceholder ? personLabel(person, t) : "")
    : "";
  const placeholder = person?.isPlaceholder === true && displayName(person) === "";
  const nativeName = person?.nativeName?.trim() ?? "";
  // Exports keep their own years line ("1913 – †1964"); the canvas reads "1913–1964".
  const years = !person
    ? ""
    : isStatic
      ? isolateLtr(lifespanLabel(person.birth?.date, person.death?.date, person.isLiving), dir)
      : lifeLine(person, t, now, dir);

  if (!person) return null;

  const isCollapsed = collapsed ?? hiddenCount > 0;
  const deceased = !person.isLiving || person.death !== undefined;
  /** Inline-start x to physical x: the card mirrors in RTL. */
  const sx = (x: number) => (dir === "rtl" ? W - x : x);

  const full = lod === "full";
  const badge =
    hiddenCount > 0 && isCollapsed ? t("canvas.hiddenBadge", { count: hiddenCount }) : "";
  const badgeW = badge ? Math.max(PILL_H + 8, Math.ceil(textWidth(badge, BADGE_FONT)) + 16) : 0;
  /** The corner control (chevron or "+N" pill) sits in the bottom inline-end corner, inside. */
  const cornerReserve = !isStatic && full && hasChildren ? (badge ? badgeW : CHEVRON_R * 2) : 0;

  const nodeClass = [
    "stam-node",
    selected && "stam-node--selected",
    dimmed && "stam-node--dimmed",
    dragRole === "source" && "stam-node--drag-source",
  ]
    .filter(Boolean)
    .join(" ");
  const cardClass = [
    "stam-card",
    `stam-card--${template.id}`,
    deceased && "stam-card--deceased",
    placeholder && "stam-card--placeholder",
    linked && "stam-card--linked",
    selected && "stam-card--selected",
    dragRole === "target" && "stam-card--drop-target",
    dragRole === "blocked" && "stam-card--drop-blocked",
    `stam-card--${lod}`,
  ]
    .filter(Boolean)
    .join(" ");
  const decorClass = placeholder ? "stam-card__decor stam-card--placeholder" : "stam-card__decor";
  const opacity = node.opacity !== undefined && node.opacity < 1 ? node.opacity : undefined;
  const sub = tabbable ? 0 : -1;
  const colorData = {
    "data-gender": person.gender,
    "data-generation": generationHue(node.generation),
    "data-branch": branch,
  };

  const face = template.face({
    W,
    H,
    s: scale.card * own,
    ts: scale.card * scale.text * own,
    dir,
    isStatic,
    palette,
    fonts: template.fonts,
    name,
    nativeName,
    years,
    deceasedWord: t("canvas.deceased"),
    initials: initialsOf(person),
    hue: avatarHue(name),
    gender: person.gender,
    deceased,
    placeholder,
    linked,
    marriedIn: kind === "spouse",
    eldest,
    photoUrl,
    uid,
    cornerReserve,
    ...(cardStyle ? { style: cardStyle } : {}),
  });
  const tilt = face.tilt
    ? `rotate(${dir === "rtl" ? -face.tilt : face.tilt} ${W / 2} ${H / 2})`
    : undefined;
  const corner = { x: sx(face.corner.x), y: face.corner.y };

  // The drawn shapes live inside the card's role=button group. The drawn text is a decorative
  // sibling: the group's aria-label already says all of it, and keeping visible text out of the
  // button's subtree is what lets "label in name" (WCAG 2.5.3) hold for initials, dates and badges.
  let shape: ReactNode = face.shape;
  let texts: ReactNode = face.texts;
  if (lod === "dot") {
    shape = <circle className="stam-card__dot" cx={W / 2} cy={H / 2} r={Math.min(W, H) * 0.39} />;
    texts = null;
  } else if (lod === "name") {
    const big = { ...BIG_NAME_FONT, family: template.fonts.name.family };
    shape = (
      <path
        className="stam-face__outline"
        d={face.outline}
        style={{
          fill: placeholder ? palette.ground : deceased ? palette.cardDeceased : palette.card,
          stroke: placeholder ? palette.muted : palette.edge,
          strokeWidth: 1.5,
        }}
      />
    );
    texts = (
      <text
        className={placeholder ? "stam-card__name stam-card__name--placeholder" : "stam-card__name"}
        x={W / 2}
        y={H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily={big.family}
        fontSize={big.size}
        fontWeight={placeholder ? 400 : big.weight}
        unicodeBidi="isolate"
        style={{ fill: placeholder ? palette.muted : palette.ink }}
      >
        {fitText(name, W - 16, big)}
      </text>
    );
  }

  const select = () => onSelect?.(personId);
  const toggle = () => onToggleCollapse?.(personId);
  const seeOriginal = () => onSeeOriginal?.(personId);
  const viewFamily = () => {
    if (familyRoot) onViewFamily?.(familyRoot);
  };
  const viewFamilyText = t("canvas.viewFamily");
  const viewFamilyW = Math.ceil(textWidth(viewFamilyText, SMALL_FONT)) + 8;
  const seeOriginalText = t("canvas.seeOriginal");
  const seeOriginalW = Math.ceil(textWidth(seeOriginalText, SMALL_FONT)) + 8;
  const physicalX = (start: number, width: number) => (dir === "rtl" ? W - start - width : start);
  const linkY = linked ? Math.min(face.lastLineY + 16, H - 8) : face.lastLineY;

  if (isStatic) {
    return (
      <g
        className={nodeClass}
        data-node-id={node.nodeId}
        data-person-id={personId}
        transform={`translate(${node.x} ${node.y})`}
        opacity={opacity}
      >
        <g className={cardClass} {...colorData} transform={tilt}>
          {shape}
        </g>
        <g className={decorClass} transform={tilt}>
          {texts}
        </g>
      </g>
    );
  }

  return (
    <g
      className={nodeClass}
      data-node-id={node.nodeId}
      transform={`translate(${node.x} ${node.y})`}
      opacity={opacity}
    >
      <g
        className={cardClass}
        {...colorData}
        transform={tilt}
        role="button"
        tabIndex={sub}
        aria-label={label}
        aria-current={selected ? "true" : undefined}
        onClick={select}
        onKeyDown={(e) => {
          if (onContextMenu && isContextMenuKey(e)) {
            e.preventDefault();
            onContextMenu(node, e);
            return;
          }
          onActivateKey(select)(e);
        }}
        onPointerDown={onPointerDown && ((e) => onPointerDown(node, e))}
        onContextMenu={onContextMenu && ((e) => onContextMenu(node, e))}
      >
        <path
          className="stam-card__ring"
          d={face.outline}
          transform={grown(W, H, RING_GAP)}
          vectorEffect="non-scaling-stroke"
        />
        <path
          className="stam-card__focus"
          d={face.outline}
          transform={grown(W, H, FOCUS_GAP)}
          vectorEffect="non-scaling-stroke"
        />
        {shape}
      </g>
      <g className={decorClass} aria-hidden="true" transform={tilt}>
        {texts}
        {dragRole === "blocked" && (
          <line className="stam-card__strike" x1={0} y1={H} x2={W} y2={0} />
        )}
      </g>
      {full && hasChildren && badge && (
        <g className="stam-card__decor stam-card__badge" aria-hidden="true">
          <rect
            x={corner.x - badgeW / 2}
            y={corner.y - PILL_H / 2}
            width={badgeW}
            height={PILL_H}
          />
          <text
            x={corner.x}
            y={corner.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={BADGE_FONT.size}
            fontWeight={BADGE_FONT.weight}
          >
            {badge}
          </text>
        </g>
      )}

      {full && hasChildren && (
        <g
          className="stam-card__control stam-card__chevron"
          role="button"
          tabIndex={sub}
          aria-label={t(isCollapsed ? "canvas.expand" : "canvas.collapse", {
            name: personLabel(person, t),
          })}
          aria-expanded={!isCollapsed}
          onClick={toggle}
          onKeyDown={onActivateKey(toggle)}
          transform={`translate(${corner.x} ${corner.y})`}
        >
          {badge ? (
            // The "+N" pill (drawn beside this group, under its hit area) is the expand control.
            <rect
              className="stam-hit stam-card__pill-hit"
              x={-badgeW / 2 - 2}
              y={-HIT / 2}
              width={badgeW + 4}
              height={HIT}
              rx={HIT / 2}
            />
          ) : (
            <>
              <rect className="stam-hit" x={-HIT / 2} y={-HIT / 2} width={HIT} height={HIT} />
              <circle className="stam-card__chevron-disc" r={CHEVRON_R} />
              <path
                d={isCollapsed ? "M-2 -4L2 0L-2 4" : "M-4 -2L0 2L4 -2"}
                transform={dir === "rtl" && isCollapsed ? "scale(-1 1)" : undefined}
              />
            </>
          )}
        </g>
      )}

      {full && linked && (
        <g
          className="stam-card__control stam-card__link"
          role="link"
          tabIndex={sub}
          aria-label={t("canvas.seeOriginalLabel", {
            name: personLabel(person, t),
          })}
          onClick={seeOriginal}
          onKeyDown={onActivateKey(seeOriginal)}
        >
          <rect
            className="stam-hit"
            x={physicalX(face.textX - 4, seeOriginalW)}
            y={linkY - 16}
            width={seeOriginalW}
            height={HIT}
          />
          <text x={sx(face.textX)} y={linkY} fontSize={SMALL_FONT.size}>
            {seeOriginalText}
          </text>
        </g>
      )}

      {full && familyRoot && (
        <g
          className="stam-card__control stam-card__family"
          role="button"
          tabIndex={sub}
          aria-label={t("canvas.viewFamilyLabel", {
            name: personLabel(person, t),
          })}
          onClick={viewFamily}
          onKeyDown={onActivateKey(viewFamily)}
        >
          <rect
            className="stam-card__family-bg"
            x={physicalX(W - viewFamilyW, viewFamilyW)}
            y={-HIT - 2}
            width={viewFamilyW}
            height={HIT}
          />
          <text x={sx(W - 4)} y={-10} textAnchor="end" fontSize={SMALL_FONT.size}>
            {viewFamilyText}
          </text>
        </g>
      )}
    </g>
  );
}

/** A person on the canvas: an SVG card, with its collapse, "see original" and family controls. */
export const PersonCard = memo(PersonCardImpl);
