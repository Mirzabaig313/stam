import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ExportInput, ExportScope } from "@/export/types";
import { Dialog } from "@/ui/app/Dialog";
import { downloadBackup } from "@/ui/app/downloadBackup";
import { useRepo } from "@/ui/app/RepoContext";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { downloadBlob } from "./downloadBlob";
import { type Exporter, type ExportResult, runExport } from "./exporters";

/** The rasteriser's limit codes, as the sentence the dialog shows. */
const WARNING_KEY = {
  SIDE_LIMIT: "export.warning.sideLimit",
  AREA_LIMIT: "export.warning.areaLimit",
  SCALE: "export.warning.scale",
} as const;
import {
  allowsTransparent,
  clampPageMm,
  CUSTOM_PAGE_MAX_MM,
  CUSTOM_PAGE_MIN_MM,
  defaultSettings,
  estimateOutput,
  exportFileName,
  type ExportFormat,
  type ExportSettings,
  FORMATS,
  POSTER_PAGES,
  SCOPES,
  switchFormat,
  TILED_PAGES,
  TILED_SCALES,
  tiledPageGuard,
} from "./formats";
import { gatherInput } from "./gatherInput";

export type ExportDialogProps = {
  onClose: () => void;
  /** The part of the world on screen now, in world coordinates; undefined when unknown. */
  getVisibleRect?: () => ExportInput["visibleRect"];
  /** The export boundary; tests pass a fake. */
  exporter?: Exporter;
};

function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="export-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <select
        id={id}
        className="field"
        value={String(value)}
        onChange={(event) => {
          const picked = options.find((o) => String(o.value) === event.currentTarget.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        {label}
      </label>
      {hint && <p className="export-hint">{hint}</p>}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="export-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        className="field"
        value={value}
        autoComplete="off"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

/** A size in mm: typed freely, clamped to the allowed range when the field is left. */
function MmField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="export-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type="number"
        className="field"
        min={CUSTOM_PAGE_MIN_MM}
        max={CUSTOM_PAGE_MAX_MM}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onBlur={() => onChange(clampPageMm(value))}
      />
    </div>
  );
}

export function ExportDialog({ onClose, getVisibleRect, exporter = runExport }: ExportDialogProps) {
  const { t, i18n } = useTranslation();
  const repo = useRepo();
  const store = useEditorStore();
  const [s, setS] = useState<ExportSettings>(defaultSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [tooMany, setTooMany] = useState<number | null>(null);
  const [warning, setWarning] = useState<ExportResult["warning"] | null>(null);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const set = (patch: Partial<ExportSettings>) => setS((prev) => ({ ...prev, ...patch }));

  const doc = useEditor((e) => e.doc);
  const layout = useEditor((e) => e.layout);
  const viewRootId = useEditor((e) => e.viewRootId);
  const selectedId = useEditor((e) => e.selectedId);
  const visibleRect = getVisibleRect?.();
  const hasSelection = selectedId !== null && !!doc?.persons[selectedId];
  // Only what the estimate reads is a dependency, so typing a title never lays the family out again.
  const { format: fmt, scope: scp, scale: scl, tiledPage: tpg, tiledScale: tsc } = s;
  const { x: rx, y: ry, width: rw, height: rh } = visibleRect ?? {};
  const estimate = useMemo(
    () =>
      doc && layout
        ? estimateOutput(
            {
              ...defaultSettings(),
              format: fmt,
              scope: scp,
              scale: scl,
              tiledPage: tpg,
              tiledScale: tsc,
            },
            {
              doc,
              layout,
              viewRootId,
              selectedId,
              ...(rx !== undefined && ry !== undefined && rw !== undefined && rh !== undefined
                ? { visibleRect: { x: rx, y: ry, width: rw, height: rh } }
                : {}),
            },
          )
        : null,
    [doc, layout, viewRootId, selectedId, rx, ry, rw, rh, fmt, scp, scl, tpg, tsc],
  );
  const isJson = s.format === "json";
  const isImage = s.format === "png" || s.format === "jpeg";

  async function run() {
    const current = store.getState();
    if (!current.doc) return;
    setTooMany(null);
    setBusy(true);
    setError(false);
    setWarning(null);
    setSavedAs(null);
    try {
      if (isJson) {
        await downloadBackup(repo, current.doc, { includePhotos: s.includePhotos });
        onClose();
        return;
      }
      if (!current.layout) throw new Error("EMPTY_TREE");
      if (s.format === "pdf-tiled") {
        const pages = estimateOutput(s, {
          doc: current.doc,
          layout: current.layout,
          viewRootId: current.viewRootId,
          selectedId: current.selectedId,
          ...(visibleRect ? { visibleRect } : {}),
        });
        const count = pages?.kind === "pages" ? pages.count : 0;
        const guard = tiledPageGuard(count);
        if (guard === "refuse") {
          setTooMany(count);
          return;
        }
        if (guard === "confirm" && !window.confirm(t("export.confirmPages", { count }))) return;
      }
      const input = await gatherInput({
        doc: current.doc,
        layout: current.layout,
        viewRootId: current.viewRootId,
        selectedId: current.selectedId,
        ...(s.scope === "visible" && visibleRect ? { visibleRect } : {}),
        scope: s.scope,
        repo,
        includePhotos: s.includePhotos,
        privacy: s.privacy,
      });
      const result = await exporter({
        input,
        settings: s,
        t,
        lang: i18n.language,
        dir: i18n.dir(),
      });
      const name = exportFileName(current.doc, s.format);
      downloadBlob(result.blob, name);
      if (result.warning) {
        setWarning(result.warning);
        setSavedAs(name);
      } else {
        onClose();
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const scopeLabel = (scope: ExportScope) => t(`export.scopes.${scope}`);
  const scopeDisabled = (scope: ExportScope) =>
    (scope === "branch" && !hasSelection) || (scope === "visible" && !visibleRect);

  return (
    <Dialog title={t("export.title")} onClose={onClose}>
      <form
        className="export-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void run();
        }}
      >
        <fieldset className="export-group">
          <legend className="field-label">{t("export.format")}</legend>
          {FORMATS.map((format: ExportFormat) => (
            <label key={format} className="export-radio">
              <input
                type="radio"
                name="format"
                value={format}
                checked={s.format === format}
                onChange={() => setS((prev) => switchFormat(prev, format))}
              />
              <span>
                {t(`export.formats.${format}`)}
                <span className="export-hint">{t(`export.formatHints.${format}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {!isJson && (
          <fieldset className="export-group">
            <legend className="field-label">{t("export.scope")}</legend>
            {SCOPES.map((scope) => (
              <label key={scope} className="export-radio">
                <input
                  type="radio"
                  name="scope"
                  value={scope}
                  checked={s.scope === scope}
                  disabled={scopeDisabled(scope)}
                  onChange={() => set({ scope })}
                />
                <span>{scopeLabel(scope)}</span>
              </label>
            ))}
          </fieldset>
        )}

        <fieldset className="export-group">
          <legend className="field-label">{t("export.options")}</legend>
          {!isJson && (
            <>
              <TextField
                label={t("export.titleField")}
                value={s.title}
                onChange={(title) => set({ title })}
              />
              <TextField
                label={t("export.subtitleField")}
                value={s.subtitle}
                onChange={(subtitle) => set({ subtitle })}
              />
              <Check
                label={t("export.dates")}
                checked={s.includeDates}
                onChange={(includeDates) => set({ includeDates })}
              />
              <Check
                label={t("export.ruler")}
                checked={s.showRuler}
                onChange={(showRuler) => set({ showRuler })}
              />
              <Select
                label={t("export.theme")}
                value={s.theme}
                options={(["light", "print"] as const).map((v) => ({
                  value: v,
                  label: t(`export.themes.${v}`),
                }))}
                onChange={(theme) => set({ theme })}
              />
              {allowsTransparent(s.format) && (
                <Select
                  label={t("export.background")}
                  value={s.background}
                  options={(["solid", "transparent"] as const).map((v) => ({
                    value: v,
                    label: t(`export.backgrounds.${v}`),
                  }))}
                  onChange={(background) => set({ background })}
                />
              )}
              <Check
                label={t("export.privacy")}
                hint={t("export.privacyHint")}
                checked={s.privacy}
                onChange={(privacy) => set({ privacy, privacyTouched: true })}
              />
            </>
          )}
          <Check
            label={t("export.photos")}
            checked={s.includePhotos}
            onChange={(includePhotos) => set({ includePhotos, photosTouched: true })}
          />
        </fieldset>

        {isImage && (
          <fieldset className="export-group">
            <Select
              label={t("export.scale")}
              value={s.scale}
              options={([1, 2, 3, 4] as const).map((v) => ({
                value: v,
                label: t("export.scaleOption", { count: v }),
              }))}
              onChange={(scale) => set({ scale })}
            />
            {s.format === "jpeg" && (
              <div className="export-field">
                <label className="field-label">
                  {t("export.quality", { percent: Math.round(s.quality * 100) })}
                  <input
                    type="range"
                    min={50}
                    max={100}
                    step={1}
                    value={Math.round(s.quality * 100)}
                    onChange={(event) => set({ quality: Number(event.currentTarget.value) / 100 })}
                  />
                </label>
              </div>
            )}
          </fieldset>
        )}

        {s.format === "pdf-poster" && (
          <fieldset className="export-group">
            <Select
              label={t("export.page")}
              value={s.page}
              options={POSTER_PAGES.map((v) => ({
                value: v,
                label: v === "Custom" ? t("export.pageCustom") : v,
              }))}
              onChange={(page) => set({ page })}
            />
            {s.page === "Custom" && (
              <>
                <MmField
                  label={t("export.customWidth")}
                  value={s.customW}
                  onChange={(customW) => set({ customW })}
                />
                <MmField
                  label={t("export.customHeight")}
                  value={s.customH}
                  onChange={(customH) => set({ customH })}
                />
              </>
            )}
            <Select
              label={t("export.orientation")}
              value={s.orientation}
              options={(["auto", "portrait", "landscape"] as const).map((v) => ({
                value: v,
                label: t(`export.orientations.${v}`),
              }))}
              onChange={(orientation) => set({ orientation })}
            />
            <div className="export-field">
              <label className="field-label">
                {t("export.margin")}
                <input
                  type="number"
                  className="field"
                  min={0}
                  max={50}
                  value={s.marginMm}
                  onChange={(event) =>
                    set({
                      marginMm: Math.min(50, Math.max(0, Number(event.currentTarget.value) || 0)),
                    })
                  }
                />
              </label>
            </div>
          </fieldset>
        )}

        {s.format === "pdf-tiled" && (
          <fieldset className="export-group">
            <Select
              label={t("export.tiledPage")}
              value={s.tiledPage}
              options={TILED_PAGES.map((v) => ({ value: v, label: v }))}
              onChange={(tiledPage) => set({ tiledPage })}
            />
            <Select
              label={t("export.tiledScale")}
              value={s.tiledScale}
              options={TILED_SCALES.map((v) => ({
                value: v,
                label: t("export.tiledScaleOption", { percent: v * 100 }),
              }))}
              onChange={(tiledScale) => set({ tiledScale })}
            />
          </fieldset>
        )}

        {estimate && (
          <p className="export-estimate">
            {estimate.kind === "px"
              ? t("export.estimatePx", { width: estimate.width, height: estimate.height })
              : t("export.estimatePages", { count: estimate.count })}
          </p>
        )}
        {warning && (
          <output className="notice">
            {t(WARNING_KEY[warning.code ?? "SCALE"], { scale: warning.scale })}
            {savedAs && <> {t("export.done", { name: savedAs })}</>}
          </output>
        )}
        {tooMany !== null && (
          <p className="notice" role="alert">
            {t("export.tooManyPages", { count: tooMany })}
          </p>
        )}
        {error && (
          <p className="notice" role="alert">
            {t("export.error")}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            {warning ? t("export.close") : t("common.cancel")}
          </button>
          <button type="submit" className="button button-primary" disabled={busy} aria-busy={busy}>
            {busy ? t("export.exporting") : t("export.export")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
