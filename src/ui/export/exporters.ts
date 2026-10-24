import type { TFunction } from "i18next";

import { applyPrivacy } from "@/export/render/privacy";
import type { ExportInput } from "@/export/types";
import { loadFace, paletteFor, TEMPLATES } from "@/templates";
import { loadTemplateFonts } from "@/templates/loadFonts";
import { DEFAULT_LOOK } from "@/templates/look";

import { allowsTransparent, type ExportSettings, posterPageSpec, toExportOptions } from "./formats";
import { buildPeople } from "./people";

/**
 * The one door to the exporters (lanes R, X, P and H). Every heavy module is loaded with
 * `import()` (see `lazyLoaders`) when an export starts, so the editor's first load does not carry them. Tests inject `Loaders`, or
 * the whole `Exporter` into the dialog.
 */
export type ExportRequest = {
  input: ExportInput;
  /** Any format but "json", which is the backup download and does not go through here. */
  settings: ExportSettings;
  t: TFunction;
  lang: string;
  dir: "ltr" | "rtl";
};

/** Which browser limit made the rasteriser draw smaller: the longest side, or the pixel count. */
export type ScaleLimit = "SIDE_LIMIT" | "AREA_LIMIT";

export type ExportResult = {
  blob: Blob;
  /** Set when the image was made smaller than asked: the scale it was actually drawn at. */
  warning?: { scale: number; code?: ScaleLimit };
};

const isScaleLimit = (code: string | undefined): code is ScaleLimit =>
  code === "SIDE_LIMIT" || code === "AREA_LIMIT";

/** The lazy module loads; tests pass fakes, so no module registry is touched. */
export type Loaders = {
  render: () => Promise<typeof import("@/export/render")>;
  raster: () => Promise<typeof import("@/export/raster")>;
  pdf: () => Promise<typeof import("@/export/pdf")>;
  html: () => Promise<typeof import("@/export/html")>;
  gedcom: () => Promise<typeof import("@/io/gedcom")>;
};

export const lazyLoaders: Loaders = {
  render: () => import("@/export/render"),
  raster: () => import("@/export/raster"),
  pdf: () => import("@/export/pdf"),
  html: () => import("@/export/html"),
  gedcom: () => import("@/io/gedcom"),
};

export type Exporter = (req: ExportRequest) => Promise<ExportResult>;

export async function runExport(
  req: ExportRequest,
  load: Loaders = lazyLoaders,
): Promise<ExportResult> {
  const { settings, t } = req;
  if (settings.format === "json") throw new Error("JSON is saved by the backup download");
  if (settings.format === "gedcom") {
    // Data, not a drawing: always the whole tree, never photos, nothing rendered.
    const { writeGedcom } = await load.gedcom();
    const doc = settings.privacy ? applyPrivacy(req.input.doc) : req.input.doc;
    return { blob: new Blob([writeGedcom(doc)], { type: "application/x-gedcom" }) };
  }
  const opts = toExportOptions(settings, req.input.look);
  const templateId = opts.look?.template ?? DEFAULT_LOOK.template;
  await loadFace(templateId);
  const template = TEMPLATES[templateId];
  // Cards are fitted with measured text: the template's fonts must be in before it is measured.
  await loadTemplateFonts(template);
  const render = await load.render();
  const doc = opts.privacy ? render.applyPrivacy(req.input.doc) : req.input.doc;
  const input: ExportInput = { ...req.input, doc };
  const rendered = render.renderTreeSvg(input, opts, t, { dir: req.dir });

  switch (settings.format) {
    case "svg":
      return { blob: new Blob([rendered.svg], { type: "image/svg+xml" }) };
    case "png":
    case "jpeg": {
      const { rasterize } = await load.raster();
      const out = await rasterize(rendered, {
        format: settings.format,
        scale: settings.scale,
        ...(settings.format === "jpeg" ? { quality: settings.quality } : {}),
        background: allowsTransparent(settings.format) ? opts.background : "solid",
        ground: paletteFor(template, settings.theme).ground,
      });
      return {
        blob: out.blob,
        ...(out.scale < settings.scale
          ? {
              warning: {
                scale: out.scale,
                ...(isScaleLimit(out.warning) ? { code: out.warning } : {}),
              },
            }
          : {}),
      };
    }
    case "pdf-poster": {
      const { toPosterPdf } = await load.pdf();
      const blob = await toPosterPdf(rendered, {
        page: posterPageSpec(settings),
        orientation: settings.orientation,
        marginMm: settings.marginMm,
      });
      return { blob };
    }
    case "pdf-tiled": {
      const { toTiledPdf } = await load.pdf();
      const blob = await toTiledPdf(
        rendered,
        {
          page: settings.tiledPage,
          scale: settings.tiledScale,
          overlapMm: 10,
        },
        t,
      );
      return { blob };
    }
    case "html": {
      const { toHtml } = await load.html();
      // Only people drawn in this export get a details entry.
      const drawn = render.selectScope(input, opts).nodes.map((n) => n.personId);
      const html = toHtml(
        rendered,
        buildPeople(doc, drawn, opts, t, req.lang),
        {
          title: opts.title ?? doc.name,
          generatedAt: new Intl.DateTimeFormat(req.lang, { dateStyle: "long" }).format(new Date()),
          lang: req.lang,
          dir: req.dir,
          theme: opts.theme,
        },
        t,
      );
      return { blob: new Blob([html], { type: "text/html" }) };
    }
  }
}
