import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import type { LayoutNode } from "@/core/layout/types";
import { paletteFor, TEMPLATES } from "@/templates";
import {
  ALIGNS,
  BORDER_PX,
  type CardStyle,
  type LineKey,
  type LineStyle,
  PADDING_PX,
  RADIUS_PX,
  TEXT_PRESETS,
  type TextPreset,
  withCardStyle,
} from "@/templates/cardStyle";
import type { Palette } from "@/templates/types";
import { Icon, type IconName } from "@/ui/app/Icon";
import { Menu, MenuItem, MenuSeparator } from "@/ui/design/Menu";
import { useSettings } from "@/ui/settings/settings";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { applyTo, branchOf, cardEdit, generationOf, patched, without } from "./actions";
import { useStyleGesture } from "./useStyleGesture";

/** The palette the tree is drawn in now: its template's, in the app's light, dark or print. */
function usePalette(): Palette {
  const template = useEditor((s) => TEMPLATES[s.look.template]);
  const [{ theme }] = useSettings();
  return paletteFor(template, theme);
}

const unique = (list: string[]) => [...new Set(list.map((c) => c.toLowerCase()))];

type Panel = "fill" | "border" | "radius" | "padding" | "colour" | "style" | null;

/** A round button with an icon (or a colour swatch) and its label as tooltip and name. */
function ToolButton({
  label,
  icon,
  swatch,
  pressed,
  expanded,
  onClick,
  children,
}: {
  label: string;
  icon?: IconName;
  swatch?: string;
  pressed?: boolean;
  expanded?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="card-tool"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {swatch !== undefined ? (
        <span className="card-tool__swatch" style={{ background: swatch }} />
      ) : icon ? (
        <Icon name={icon} />
      ) : null}
      {children}
    </button>
  );
}

/** Colour swatches, a custom colour, and "the template's own" to clear the choice. */
function Swatches({
  colours,
  value,
  label,
  onPick,
  onClear,
}: {
  colours: string[];
  value: string | undefined;
  label: string;
  onPick: (colour: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="card-panel__swatches">
      <legend className="visually-hidden">{label}</legend>
      <button
        type="button"
        className="card-swatch card-swatch--template"
        aria-label={t("cardEdit.template")}
        title={t("cardEdit.template")}
        aria-pressed={value === undefined}
        onClick={onClear}
      />
      {colours.map((c) => (
        <button
          key={c}
          type="button"
          className="card-swatch"
          style={{ background: c }}
          aria-label={c}
          title={c}
          aria-pressed={value === c}
          onClick={() => onPick(c)}
        />
      ))}
      <label className="card-swatch card-swatch--custom" title={t("cardEdit.custom")}>
        <span className="visually-hidden">{t("cardEdit.custom")}</span>
        <input
          type="color"
          value={value ?? "#888888"}
          onChange={(e) => onPick(e.currentTarget.value.toLowerCase())}
        />
      </label>
    </fieldset>
  );
}

/** A slider that previews while it moves and is one undo step when it is let go. */
function GestureSlider({
  label,
  value,
  range,
  onPreview,
  onCommit,
  onClear,
}: {
  label: string;
  value: number;
  range: { min: number; max: number };
  onPreview: (v: number) => void;
  onCommit: (v: number) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [v, setV] = useState(value);
  return (
    <div className="card-panel__slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={1}
        value={v}
        onChange={(e) => {
          const next = Number(e.currentTarget.value);
          setV(next);
          onPreview(next);
        }}
        onPointerUp={() => onCommit(v)}
        onKeyUp={() => onCommit(v)}
      />
      <output htmlFor={id}>{v}</output>
      <button type="button" className="card-panel__clear" onClick={onClear}>
        {t("cardEdit.template")}
      </button>
    </div>
  );
}

/**
 * The card toolbar: fill, border, corners, padding and ⋯ (copy, paste, apply to the branch or the
 * generation, reset). It edits the selected card only.
 */
export function CardToolbar({ node }: { node: LayoutNode }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const palette = usePalette();
  const gesture = useStyleGesture();
  const style = useEditor((s) => s.cardStyles[node.personId]);
  const clipboard = useStore(cardEdit, (s) => s.clipboard);
  const [panel, setPanel] = useState<Panel>(null);
  const [menuAt, setMenuAt] = useState<[number, number] | null>(null);
  const id = node.personId;
  const toggle = (p: Panel) => setPanel((open) => (open === p ? null : p));
  const styles = () => store.getState().cardStyles;
  const commit = (patch: CardStyle, label: string) =>
    gesture.commit(patched(styles(), id, patch), label);
  const clear = (fields: (keyof CardStyle)[], label: string) =>
    gesture.commit(without(styles(), id, fields), label);

  const fills = unique([
    palette.card,
    palette.cardDeceased,
    palette.soft,
    palette.ground,
    ...palette.hues,
  ]);
  const inks = unique([
    palette.ink,
    palette.muted,
    palette.accent,
    palette.line,
    palette.edge,
    palette.male,
    palette.female,
  ]);

  return (
    <div className="card-toolbar" role="toolbar" aria-label={t("cardEdit.cardToolbar")}>
      <ToolButton
        label={t("cardEdit.fill")}
        swatch={style?.fill ?? palette.card}
        expanded={panel === "fill"}
        onClick={() => toggle("fill")}
      />
      <ToolButton
        label={t("cardEdit.border")}
        icon="border"
        expanded={panel === "border"}
        onClick={() => toggle("border")}
      />
      <span className="card-toolbar__rule" aria-hidden="true" />
      <ToolButton
        label={t("cardEdit.radius")}
        icon="radius"
        expanded={panel === "radius"}
        onClick={() => toggle("radius")}
      />
      <ToolButton
        label={t("cardEdit.padding")}
        icon="padding"
        expanded={panel === "padding"}
        onClick={() => toggle("padding")}
      />
      <span className="card-toolbar__rule" aria-hidden="true" />
      <ToolButton
        label={t("cardEdit.more")}
        icon="more"
        expanded={menuAt !== null}
        onClick={() => {
          const el = document.activeElement as HTMLElement | null;
          const box = el?.getBoundingClientRect();
          setMenuAt(box ? [box.right, box.bottom + 6] : [0, 0]);
        }}
      />

      {panel === "fill" && (
        <div className="card-panel">
          <Swatches
            label={t("cardEdit.fill")}
            colours={fills}
            value={style?.fill}
            onPick={(fill) => commit({ fill }, "Card fill")}
            onClear={() => clear(["fill"], "Card fill")}
          />
        </div>
      )}
      {panel === "border" && (
        <div className="card-panel">
          <Swatches
            label={t("cardEdit.border")}
            colours={inks}
            value={style?.border?.colour}
            onPick={(colour) =>
              commit({ border: { colour, width: style?.border?.width ?? 2 } }, "Card border")
            }
            onClear={() => clear(["border"], "Card border")}
          />
          <GestureSlider
            label={t("cardEdit.borderWidth")}
            value={style?.border?.width ?? 1}
            range={BORDER_PX}
            onPreview={(width) =>
              gesture.preview(
                patched(styles(), id, {
                  border: { colour: style?.border?.colour ?? palette.edge, width },
                }),
              )
            }
            onCommit={(width) =>
              commit(
                { border: { colour: style?.border?.colour ?? palette.edge, width } },
                "Card border",
              )
            }
            onClear={() => clear(["border"], "Card border")}
          />
        </div>
      )}
      {panel === "radius" && (
        <div className="card-panel">
          <GestureSlider
            label={t("cardEdit.radius")}
            value={style?.radius ?? 8}
            range={RADIUS_PX}
            onPreview={(radius) => gesture.preview(patched(styles(), id, { radius }))}
            onCommit={(radius) => commit({ radius }, "Card corners")}
            onClear={() => clear(["radius"], "Card corners")}
          />
        </div>
      )}
      {panel === "padding" && (
        <div className="card-panel">
          <GestureSlider
            label={t("cardEdit.padding")}
            value={style?.padding ?? 12}
            range={PADDING_PX}
            onPreview={(padding) => gesture.preview(patched(styles(), id, { padding }))}
            onCommit={(padding) => commit({ padding }, "Card padding")}
            onClear={() => clear(["padding"], "Card padding")}
          />
        </div>
      )}

      {menuAt && (
        <Menu at={menuAt} label={t("cardEdit.more")} onClose={() => setMenuAt(null)}>
          <MenuItem
            icon="copy"
            onClick={() => {
              cardEdit.setState({ clipboard: style ?? null });
              setMenuAt(null);
            }}
          >
            {t("cardEdit.copy")}
          </MenuItem>
          <MenuItem
            disabled={clipboard === null}
            onClick={() => {
              gesture.commit(applyTo(styles(), [id], clipboard ?? undefined), "Paste card style");
              setMenuAt(null);
            }}
          >
            {t("cardEdit.paste")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon="tree"
            onClick={() => {
              const doc = store.getState().doc;
              if (doc)
                gesture.commit(applyTo(styles(), branchOf(doc, id), style), "Style the branch");
              setMenuAt(null);
            }}
          >
            {t("cardEdit.applyBranch")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              const layout = store.getState().layout;
              if (layout) {
                gesture.commit(
                  applyTo(styles(), generationOf(layout, id), style),
                  "Style the generation",
                );
              }
              setMenuAt(null);
            }}
          >
            {t("cardEdit.applyGeneration")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              gesture.commit(withCardStyle(styles(), id, undefined), "Reset card");
              setMenuAt(null);
            }}
          >
            {t("cardEdit.reset")}
          </MenuItem>
        </Menu>
      )}
    </div>
  );
}

const ALIGN_ICON = { start: "alignStart", center: "alignCenter", end: "alignEnd" } as const;

/**
 * The text toolbar, for one line of the selected card (the name or the years): its style preset,
 * colour, bold, italic, underline and alignment.
 */
export function TextToolbar({ node, line }: { node: LayoutNode; line: LineKey }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const palette = usePalette();
  const gesture = useStyleGesture();
  const lineStyle = useEditor((s) => s.cardStyles[node.personId]?.lines?.[line]);
  const [panel, setPanel] = useState<Panel>(null);
  const id = node.personId;
  const set = (patch: LineStyle, label: string) =>
    gesture.commit(patched(store.getState().cardStyles, id, { lines: { [line]: patch } }), label);
  const align = lineStyle?.align ?? "start";
  const nextAlign = ALIGNS[(ALIGNS.indexOf(align) + 1) % ALIGNS.length]!;
  const inks = unique([
    palette.ink,
    palette.muted,
    palette.accent,
    palette.memorial,
    palette.male,
    palette.female,
    "#3d6a9e",
    "#557a35",
    "#b0552a",
    "#8a6810",
    "#2f7a6b",
    "#a3466f",
  ]);

  return (
    <div className="card-toolbar" role="toolbar" aria-label={t("cardEdit.textToolbar")}>
      <label className="card-tool card-tool--select">
        <span className="visually-hidden">{t("cardEdit.style")}</span>
        <select
          value={lineStyle?.preset ?? "body"}
          onChange={(e) => set({ preset: e.currentTarget.value as TextPreset }, "Text style")}
        >
          {TEXT_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(`cardEdit.presets.${p}`)}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" size={12} />
      </label>
      <ToolButton
        label={t("cardEdit.colour")}
        swatch={lineStyle?.colour ?? palette.ink}
        expanded={panel === "colour"}
        onClick={() => setPanel((p) => (p === "colour" ? null : "colour"))}
      />
      <span className="card-toolbar__rule" aria-hidden="true" />
      <ToolButton
        label={t("cardEdit.bold")}
        icon="bold"
        pressed={lineStyle?.bold ?? false}
        onClick={() => set({ bold: !(lineStyle?.bold ?? false) }, "Bold")}
      />
      <ToolButton
        label={t("cardEdit.italic")}
        icon="italic"
        pressed={lineStyle?.italic ?? false}
        onClick={() => set({ italic: !(lineStyle?.italic ?? false) }, "Italic")}
      />
      <ToolButton
        label={t("cardEdit.underline")}
        icon="underline"
        pressed={lineStyle?.underline ?? false}
        onClick={() => set({ underline: !(lineStyle?.underline ?? false) }, "Underline")}
      />
      <span className="card-toolbar__rule" aria-hidden="true" />
      <ToolButton
        label={t("cardEdit.align", { value: t(`cardEdit.aligns.${align}`) })}
        icon={ALIGN_ICON[align]}
        onClick={() => set({ align: nextAlign }, "Alignment")}
      />
      <ToolButton
        label={t("cardEdit.backToCard")}
        icon="close"
        onClick={() => cardEdit.setState({ line: null })}
      />
      {panel === "colour" && (
        <div className="card-panel">
          <Swatches
            label={t("cardEdit.colour")}
            colours={inks}
            value={lineStyle?.colour}
            onPick={(colour) => set({ colour }, "Text colour")}
            onClear={() => {
              const styles = store.getState().cardStyles;
              const current = styles[id]?.lines?.[line];
              if (!current) return;
              const { colour: _gone, ...rest } = current;
              const lines = { ...styles[id]?.lines, [line]: rest };
              gesture.commit(withCardStyle(styles, id, { ...styles[id], lines }), "Text colour");
            }}
          />
        </div>
      )}
    </div>
  );
}
