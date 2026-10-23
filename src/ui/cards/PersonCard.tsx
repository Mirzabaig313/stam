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
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";

import { lifespanLabel } from "@/core/dates/fuzzy";
import { CARD_H, CARD_W } from "@/core/layout/constants";
import type { LayoutNode } from "@/core/layout/types";
import { childrenOf, displayName, parentsOf, topmostAncestor } from "@/core/model/tree";
import type { Person, TreeDocument } from "@/core/model/types";
import type { Lod } from "@/ui/canvas/viewport";
import { avatarHue } from "@/ui/design/avatarHue";
import { generationHue } from "@/ui/settings/colorModes";

import { describePerson, personLabel } from "./describe";
import { lifeLine } from "./years";

// ---- Text fitting -------------------------------------------------------------------------
// SVG text does not ellipsize, so names are measured (canvas 2D, same font as the CSS) and cut
// with "…". Widths are cached; the cache resets when web fonts finish loading.

export type Font = { size: number; weight: number; italic?: boolean };
const FAMILY = '"Archivo Variable", system-ui, sans-serif';
const NAME_FONT: Font = { size: 13, weight: 600 };
const PLACEHOLDER_FONT: Font = { size: 13, weight: 400, italic: true };
const NATIVE_FONT: Font = { size: 12, weight: 400 };
const SMALL_FONT: Font = { size: 11, weight: 400 };
const BADGE_FONT: Font = { size: 11, weight: 600 };
const CHIP_FONT: Font = { size: 11, weight: 500 };
const BIG_NAME_FONT: Font = { size: 26, weight: 600 };
const BIG_PLACEHOLDER_FONT: Font = { size: 26, weight: 400, italic: true };

const cssFont = (f: Font) => `${f.italic ? "italic " : ""}${f.weight} ${f.size}px ${FAMILY}`;

let context: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();
let fontEpoch = 0;
const fontListeners = new Set<() => void>();
let watchingFonts = false;

function subscribeFonts(listener: () => void): () => void {
  fontListeners.add(listener);
  if (!watchingFonts && typeof document !== "undefined" && document.fonts) {
    watchingFonts = true;
    document.fonts.addEventListener?.("loadingdone", () => {
      widths.clear();
      fontEpoch++;
      for (const l of fontListeners) l();
    });
  }
  return () => fontListeners.delete(listener);
}

/** Re-renders the caller when web fonts finish loading, so fitted text uses the real metrics. */
export function useFontEpoch(): number {
  return useSyncExternalStore(
    subscribeFonts,
    () => fontEpoch,
    () => 0,
  );
}

function textWidth(text: string, font: Font): number {
  const key = `${cssFont(font)}|${text}`;
  const cached = widths.get(key);
  if (cached !== undefined) return cached;
  if (context === undefined) {
    try {
      context = document.createElement("canvas").getContext("2d");
    } catch {
      context = null;
    }
  }
  let width: number;
  if (context && typeof context.measureText === "function") {
    context.font = cssFont(font);
    width = context.measureText(text).width;
  } else {
    width = text.length * font.size * 0.56; // No canvas (tests): an average Archivo advance.
  }
  if (widths.size > 20_000) widths.clear();
  widths.set(key, width);
  return width;
}

/** `text` cut with "…" so it fits `max` px in `font`. Cuts between code points, not inside one. */
export function fitText(text: string, max: number, font: Font): string {
  if (textWidth(text, font) <= max) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(`${chars.slice(0, mid).join("").trimEnd()}…`, font) <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join("").trimEnd()}…`;
}

/** A life line that is too long drops its age (" · 80 yrs") before it is cut with "…". */
function fitLifeLine(line: string, max: number): string {
  if (textWidth(line, SMALL_FONT) <= max) return line;
  const at = line.lastIndexOf(" · ");
  return fitText(at > 0 ? line.slice(0, at) : line, max, SMALL_FONT);
}

// ---- Card geometry (card-local px, inline-start origin) --------------------------------------

const RADIUS = 6;
const AVATAR_X = 30;
const AVATAR_R = 18;
const TEXT_X = 60;
const TEXT_END = CARD_W - 10;
const GLYPH_SPACE = 16;
const HIT = 24;

/**
 * Text that must read left to right, wrapped for an RTL drawing in LEFT-TO-RIGHT ISOLATE …
 * POP DIRECTIONAL ISOLATE. The characters are invisible and leave the element's direction (and
 * so its text-anchor) alone, which an LTR child element would not. LTR text is left as it is.
 */
export function isolateLtr(text: string, dir: "ltr" | "rtl"): string {
  return dir === "rtl" ? `\u2066${text}\u2069` : text;
}

/** A circle of radius `r` centred on (cx, cy), as a path. */
const ring = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/**
 * ♂ or ♀ drawn as a stroked path centred on `cx`, the size and place of the 12 px glyph whose
 * baseline sits at y 17. The glyphs never mirror, so neither does the arrow.
 */
export function genderMarkPath(gender: Person["gender"], cx: number): string {
  if (gender === "male") {
    const x = cx - 1.2;
    const y = 13;
    return `${ring(x, y, 3.2)}M${x + 2.3} ${y - 2.3}L${cx + 3.6} 7.6M${cx + 0.8} 7.6H${cx + 3.6}V10.4`;
  }
  return `${ring(cx, 9.6, 3.2)}M${cx} 12.8V18.6M${cx - 2.2} 16.2H${cx + 2.2}`;
}
/** The collapse chevron: a small disc on the card's bottom edge, where the "+N" pill goes. */
const CHEVRON_R = 10;
/** The coloured edge at the card's inline start: gender, branch or generation (CSS decides). */
const SPINE_W = 5;
/** The "+N" pill of a collapsed branch: on the card's bottom edge, toward the inline end. */
const PILL_H = 20;
const PILL_END = 12;

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
}: PersonCardProps) {
  const { t } = useTranslation();
  // Re-render when web fonts finish loading, so names are re-fitted with the real metrics.
  useSyncExternalStore(
    subscribeFonts,
    () => fontEpoch,
    () => 0,
  );
  const clipId = useId();
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
      ? lifespanLabel(person.birth?.date, person.death?.date, person.isLiving)
      : lifeLine(person, t, now, dir);

  if (!person) return null;

  const isCollapsed = collapsed ?? hiddenCount > 0;
  const deceased = !person.isLiving || person.death !== undefined;
  /** A deceased person with no years: a quiet "Deceased" chip on the years line. */
  const deceasedChip = !isStatic && !linked && deceased && years === "" && !placeholder;
  const deceasedText = deceasedChip ? t("canvas.deceased") : "";
  const deceasedW = deceasedChip ? Math.ceil(textWidth(deceasedText, CHIP_FONT)) + 12 : 0;
  /** Inline-start x to physical x: the card mirrors in RTL. */
  const sx = (x: number) => (dir === "rtl" ? CARD_W - x : x);

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

  // Text lines: name, then the native name, then the years (or "see original" on a linked copy).
  // Without a last line the block is centred: a lone name sits on the card's middle.
  // A static (export) card has no "see original" link: a linked copy's last line stays empty.
  const hasLastLine = isStatic ? !linked && years !== "" : linked || years !== "" || deceasedChip;
  const loneName = !hasLastLine && !nativeName;
  const nameY = hasLastLine ? (nativeName ? 25 : 31) : nativeName ? 31 : CARD_H / 2;
  const nativeY = hasLastLine ? 41 : 47;
  const lastLineY = nativeName ? 57 : 49;

  // The drawn shapes live inside the card's role=button group. The drawn text is a decorative
  // sibling: the group's aria-label already says all of it, and keeping visible text out of the
  // button's subtree is what lets "label in name" (WCAG 2.5.3) hold for initials, dates and badges.
  let shape: ReactNode = null;
  let texts: ReactNode = null;
  if (lod === "dot") {
    shape = <circle className="stam-card__dot" cx={CARD_W / 2} cy={CARD_H / 2} r={28} />;
  } else if (lod === "name") {
    shape = <rect className="stam-card__bg" width={CARD_W} height={CARD_H} rx={RADIUS} />;
    texts = (
      <>
        <text
          className={
            placeholder ? "stam-card__name stam-card__name--placeholder" : "stam-card__name"
          }
          x={CARD_W / 2}
          y={CARD_H / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={BIG_NAME_FONT.size}
          fontWeight={placeholder ? 400 : BIG_NAME_FONT.weight}
          unicodeBidi="isolate"
        >
          {fitText(name, CARD_W - 16, placeholder ? BIG_PLACEHOLDER_FONT : BIG_NAME_FONT)}
        </text>
      </>
    );
  } else {
    shape = (
      <>
        {!isStatic && (
          <rect className="stam-card__lift" y={2} width={CARD_W} height={CARD_H} rx={RADIUS} />
        )}
        <rect className="stam-card__bg" width={CARD_W} height={CARD_H} rx={RADIUS} />
        {!isStatic && !placeholder && (
          <>
            <clipPath id={`${clipId}-card`}>
              <rect className="stam-card__clip" width={CARD_W} height={CARD_H} rx={RADIUS} />
            </clipPath>
            <rect
              className="stam-card__spine"
              x={dir === "rtl" ? CARD_W - SPINE_W : 0}
              width={SPINE_W}
              height={CARD_H}
              clipPath={`url(#${clipId}-card)`}
            />
          </>
        )}
      </>
    );
    texts = (
      <>
        <g className="stam-card__avatar">
          {photoUrl ? (
            <>
              <clipPath id={clipId}>
                <circle cx={sx(AVATAR_X)} cy={CARD_H / 2} r={AVATAR_R} />
              </clipPath>
              <image
                href={photoUrl}
                x={sx(AVATAR_X) - AVATAR_R}
                y={CARD_H / 2 - AVATAR_R}
                width={AVATAR_R * 2}
                height={AVATAR_R * 2}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#${clipId})`}
              />
              <circle
                className="stam-card__avatar-ring"
                cx={sx(AVATAR_X)}
                cy={CARD_H / 2}
                r={AVATAR_R}
              />
            </>
          ) : (
            <>
              <circle
                className="stam-card__avatar-disc"
                // A warm hue from the name (not in exports: they keep their own plain disc).
                data-hue={isStatic || placeholder ? undefined : avatarHue(name)}
                cx={sx(AVATAR_X)}
                cy={CARD_H / 2}
                r={AVATAR_R}
              />
              <text
                className="stam-card__initials"
                x={sx(AVATAR_X)}
                y={CARD_H / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                fontWeight={600}
              >
                {initialsOf(person)}
              </text>
            </>
          )}
        </g>
        <text
          className={
            placeholder ? "stam-card__name stam-card__name--placeholder" : "stam-card__name"
          }
          x={sx(TEXT_X)}
          y={nameY}
          dominantBaseline={loneName ? "central" : undefined}
          fontSize={NAME_FONT.size}
          fontWeight={placeholder ? 400 : NAME_FONT.weight}
          unicodeBidi="isolate"
        >
          {fitText(
            name,
            TEXT_END - TEXT_X - (nativeName ? GLYPH_SPACE : 0),
            placeholder ? PLACEHOLDER_FONT : NAME_FONT,
          )}
        </text>
        {nativeName && (
          <text
            className="stam-card__native"
            x={sx(TEXT_X)}
            y={nativeY}
            fontSize={NATIVE_FONT.size}
            unicodeBidi="isolate"
          >
            {fitText(nativeName, TEXT_END - TEXT_X, NATIVE_FONT)}
          </text>
        )}
        {deceasedChip && (
          <g className="stam-card__deceased">
            <rect
              x={dir === "rtl" ? CARD_W - TEXT_X - deceasedW + 2 : TEXT_X - 2}
              y={lastLineY - 12}
              width={deceasedW}
              height={16}
              rx={8}
            />
            <text x={sx(TEXT_X + 6)} y={lastLineY} fontSize={CHIP_FONT.size}>
              {deceasedText}
            </text>
          </g>
        )}
        {!linked && years && (
          <text
            className="stam-card__years"
            x={sx(TEXT_X)}
            y={lastLineY}
            fontSize={SMALL_FONT.size}
          >
            {/* Years read left to right in RTL too ("1913 – †1964", never "1964† – 1913"). Not
                with an LTR <tspan>: Chromium and WebKit resolve text-anchor from an only child's
                direction, so the line would start at x and grow right, over the avatar. The
                LRI…PDI isolate keeps the text's own RTL direction, so it ends at x on the right. */}
            {isStatic
              ? isolateLtr(fitText(years, TEXT_END - TEXT_X, SMALL_FONT), dir)
              : // The life line isolates its own year range (it mixes words and years).
                fitLifeLine(years, TEXT_END - TEXT_X)}
          </text>
        )}
        {isStatic ? (
          // Exports draw the mark as a path: no embedded font (and so no PDF) has ♂ or ♀.
          <path
            className="stam-card__gender-mark"
            data-gender={person.gender}
            d={genderMarkPath(person.gender, sx(CARD_W - 14))}
          />
        ) : (
          <text
            className="stam-card__gender"
            x={sx(CARD_W - 9)}
            y={17}
            textAnchor="end"
            fontSize={12}
            aria-hidden="true"
          >
            {person.gender === "male" ? "♂" : "♀"}
          </text>
        )}
      </>
    );
  }

  const full = lod === "full";
  const badge =
    hiddenCount > 0 && isCollapsed ? t("canvas.hiddenBadge", { count: hiddenCount }) : "";
  const badgeW = badge ? Math.max(PILL_H + 8, Math.ceil(textWidth(badge, BADGE_FONT)) + 16) : 0;
  /** The pill's centre, physical px: on the bottom edge, its inline end PILL_END from the card's. */
  const pillX = sx(CARD_W - PILL_END - badgeW / 2);
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
  const physicalX = (start: number, width: number) =>
    dir === "rtl" ? CARD_W - start - width : start;

  if (isStatic) {
    return (
      <g
        className={nodeClass}
        data-node-id={node.nodeId}
        data-person-id={personId}
        transform={`translate(${node.x} ${node.y})`}
        opacity={opacity}
      >
        <g className={cardClass} {...colorData}>
          {shape}
        </g>
        <g className={decorClass}>{texts}</g>
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
        <rect
          className="stam-card__focus"
          x={-3}
          y={-3}
          width={CARD_W + 6}
          height={CARD_H + 6}
          rx={RADIUS + 3}
        />
        {shape}
      </g>
      <g className={decorClass} aria-hidden="true">
        {texts}
        {full && hasChildren && badge && (
          <g className="stam-card__badge">
            <rect x={pillX - badgeW / 2} y={CARD_H - PILL_H / 2} width={badgeW} height={PILL_H} />
            <text
              x={pillX}
              y={CARD_H}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={BADGE_FONT.size}
              fontWeight={BADGE_FONT.weight}
            >
              {badge}
            </text>
          </g>
        )}
        {dragRole === "blocked" && (
          <line className="stam-card__strike" x1={0} y1={CARD_H} x2={CARD_W} y2={0} />
        )}
      </g>

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
          transform={
            badge
              ? `translate(${pillX} ${CARD_H})`
              : `translate(${sx(CARD_W - PILL_END - CHEVRON_R)} ${CARD_H})`
          }
        >
          {badge ? (
            // The "+N" pill (drawn in the decor group, under this hit area) is the expand control.
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
          aria-label={t("canvas.seeOriginalLabel", { name: personLabel(person, t) })}
          onClick={seeOriginal}
          onKeyDown={onActivateKey(seeOriginal)}
        >
          <rect
            className="stam-hit"
            x={physicalX(TEXT_X - 4, seeOriginalW)}
            y={lastLineY - 16}
            width={seeOriginalW}
            height={HIT}
          />
          <text x={sx(TEXT_X)} y={lastLineY} fontSize={SMALL_FONT.size}>
            {seeOriginalText}
          </text>
        </g>
      )}

      {full && familyRoot && (
        <g
          className="stam-card__control stam-card__family"
          role="button"
          tabIndex={sub}
          aria-label={t("canvas.viewFamilyLabel", { name: personLabel(person, t) })}
          onClick={viewFamily}
          onKeyDown={onActivateKey(viewFamily)}
        >
          <rect
            className="stam-card__family-bg"
            x={physicalX(CARD_W - viewFamilyW, viewFamilyW)}
            y={-HIT - 2}
            width={viewFamilyW}
            height={HIT}
          />
          <text x={sx(CARD_W - 4)} y={-10} textAnchor="end" fontSize={SMALL_FONT.size}>
            {viewFamilyText}
          </text>
        </g>
      )}
    </g>
  );
}

/** A person on the canvas: an SVG card, with its collapse, "see original" and family controls. */
export const PersonCard = memo(PersonCardImpl);
