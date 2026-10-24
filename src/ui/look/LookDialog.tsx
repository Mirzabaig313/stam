import "./look.css";

import { memo, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { layoutFamily } from "@/core/layout/family";
import { growUpward } from "@/core/layout/flip";
import type { LayoutResult } from "@/core/layout/types";
import { childrenOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";
import { loadAllFaces, paletteFor, TEMPLATES } from "@/templates";
import { edgeLookFor, eldestGeneration } from "@/templates/edgeLook";
import {
  CARD_SIZE,
  DEFAULT_LOOK,
  type Look,
  SPACINGS,
  TEMPLATE_IDS,
  TEXT_SIZE,
} from "@/templates/look";
import { faceScale, metricsFor } from "@/templates/metrics";
import { stressFamily } from "@/templates/samples";
import type { Template } from "@/templates/types";
import { Dialog } from "@/ui/app/Dialog";
import { Edges } from "@/ui/canvas/Edges";
import { PersonCard } from "@/ui/cards/PersonCard";
import { Segmented } from "@/ui/design/Segmented";
import { useSettings } from "@/ui/settings/settings";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

/** The few people a thumbnail shows: the root couple and their children, nothing below. */
function previewLayout(doc: TreeDocument, template: Template): LayoutResult | null {
  const source = doc.rootPersonId && doc.persons[doc.rootPersonId] ? doc : stressFamily();
  const rootId = source.rootPersonId!;
  const children = childrenOf(source, rootId);
  const layout = layoutFamily(source, {
    rootId,
    collapsed: new Set(children),
    metrics: metricsFor({ ...DEFAULT_LOOK, template: template.id }),
  });
  if (layout.nodes.length === 0) return null;
  return template.growth === "up" ? growUpward(layout) : layout;
}

/** A small drawing of the tree's top rows in a template, as its picker card shows it. */
const TemplatePreview = memo(function TemplatePreview({
  doc,
  template,
  theme,
}: {
  doc: TreeDocument;
  template: Template;
  theme: string;
}) {
  const layout = useMemo(() => previewLayout(doc, template), [doc, template]);
  if (!layout) return null;
  const palette = paletteFor(template, theme);
  const scale = faceScale({ ...DEFAULT_LOOK, template: template.id });
  const source = doc.rootPersonId && doc.persons[doc.rootPersonId] ? doc : stressFamily();
  const b = layout.bounds;
  const pad = 24;
  const eldest = eldestGeneration(layout);
  return (
    <svg
      className="look-preview"
      viewBox={`${b.x - pad} ${b.y - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ background: palette.ground }}
      aria-hidden="true"
      focusable="false"
    >
      <Edges edges={layout.edges} lod="full" look={edgeLookFor(template, palette, scale, layout)} />
      {layout.nodes.map((node) => (
        <PersonCard
          key={node.nodeId}
          doc={source}
          node={node}
          metrics={layout.metrics}
          template={template}
          palette={palette}
          scale={scale}
          eldest={node.generation === eldest}
          static
        />
      ))}
    </svg>
  );
});

/**
 * The tree's look: one of the six templates and the three size controls (card size, text size,
 * spacing). Every change applies to the canvas at once and is kept for this tree on this device.
 */
export function LookDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const look = useEditor((s) => s.look);
  const doc = useEditor((s) => s.doc);
  const [{ theme }] = useSettings();
  const uid = useId();
  // Each card shows the tree in its template: the faces load with the dialog.
  const [faces, setFaces] = useState(false);
  useEffect(() => {
    let live = true;
    loadAllFaces().then(
      () => live && setFaces(true),
      () => live && setFaces(true),
    );
    return () => {
      live = false;
    };
  }, []);
  const set = (patch: Partial<Look>) => store.getState().setLook(patch);

  return (
    <Dialog title={t("look.title")} onClose={onClose} className="look-dialog">
      <form
        className="look-form"
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <p className="settings-note">{t("look.intro")}</p>
        <fieldset className="settings-group" role="radiogroup" aria-labelledby={`${uid}-template`}>
          <legend id={`${uid}-template`} className="settings-label">
            {t("look.template")}
          </legend>
          <div className="look-grid">
            {TEMPLATE_IDS.map((id) => (
              <label key={id} className="look-card" data-template={id}>
                <input
                  type="radio"
                  name={`${uid}-template`}
                  value={id}
                  checked={look.template === id}
                  aria-describedby={`${uid}-${id}`}
                  onChange={() => set({ template: id })}
                />
                {doc && faces ? (
                  <TemplatePreview doc={doc} template={TEMPLATES[id]} theme={theme} />
                ) : (
                  <span className="look-preview" aria-hidden="true" />
                )}
                <span className="look-card__text">
                  <span className="look-card__name">{t(`look.templates.${id}`)}</span>
                  <span id={`${uid}-${id}`} className="look-card__hint" aria-hidden="true">
                    {t(`look.hints.${id}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="look-sizes">
          <SizeSlider
            id={`${uid}-card`}
            label={t("look.cardSize")}
            value={look.cardSize}
            range={CARD_SIZE}
            onChange={(cardSize) => set({ cardSize })}
          />
          <SizeSlider
            id={`${uid}-text`}
            label={t("look.textSize")}
            value={look.textSize}
            range={TEXT_SIZE}
            onChange={(textSize) => set({ textSize })}
          />
          <div className="settings-group">
            <span id={`${uid}-spacing`} className="settings-label">
              {t("look.spacing")}
            </span>
            <Segmented
              block
              labelledBy={`${uid}-spacing`}
              value={look.spacing}
              onChange={(spacing) => set({ spacing })}
              options={SPACINGS.map((spacing) => ({
                value: spacing,
                label: t(`look.spacings.${spacing}`),
              }))}
            />
          </div>
        </div>
        <p className="settings-note">{t("look.savedHere")}</p>
        <div className="dialog-actions">
          <button
            type="button"
            className="button button-quiet"
            disabled={
              look.cardSize === DEFAULT_LOOK.cardSize &&
              look.textSize === DEFAULT_LOOK.textSize &&
              look.spacing === DEFAULT_LOOK.spacing
            }
            onClick={() =>
              set({
                cardSize: DEFAULT_LOOK.cardSize,
                textSize: DEFAULT_LOOK.textSize,
                spacing: DEFAULT_LOOK.spacing,
              })
            }
          >
            {t("look.reset")}
          </button>
          <button type="submit" className="button button-primary">
            {t("settings.done")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function SizeSlider({
  id,
  label,
  value,
  range,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="settings-group look-slider">
      <label htmlFor={id} className="settings-label">
        {label}
      </label>
      <div className="look-slider__row">
        <input
          id={id}
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          aria-valuetext={t("look.percent", { value })}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output htmlFor={id} className="look-slider__value">
          {t("look.percent", { value })}
        </output>
      </div>
    </div>
  );
}
