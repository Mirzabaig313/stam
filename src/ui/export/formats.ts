import { layoutFamily } from "@/core/layout/family";
import type { TreeDocument } from "@/core/model/types";
import { type PageSpec, tileLayout } from "@/export/pdf/geometry";
import type { ExportInput, ExportOptions, ExportScope, ExportTheme } from "@/export/types";

export type ExportFormat = "svg" | "png" | "jpeg" | "pdf-poster" | "pdf-tiled" | "html" | "json";

export const FORMATS: readonly ExportFormat[] = [
  "svg",
  "png",
  "jpeg",
  "pdf-poster",
  "pdf-tiled",
  "html",
  "json",
];

export const SCOPES: readonly ExportScope[] = ["whole", "view", "branch", "visible"];
export const POSTER_PAGES = ["A4", "A3", "A2", "A1", "A0", "Letter", "Tabloid", "Custom"] as const;
export type PosterPage = (typeof POSTER_PAGES)[number];
export const TILED_PAGES = ["A4", "Letter"] as const;
export type TiledPage = (typeof TILED_PAGES)[number];
export const CUSTOM_PAGE_MIN_MM = 100;
export const CUSTOM_PAGE_MAX_MM = 5000;
/** Above this many tiled pages the dialog asks before exporting; above the max it refuses. */
export const TILED_CONFIRM_PAGES = 100;
export const TILED_MAX_PAGES = 400;
export const TILED_SCALES = [0.5, 1, 1.5, 2, 3, 4] as const;

export type ExportSettings = {
  format: ExportFormat;
  scope: ExportScope;
  title: string;
  subtitle: string;
  includeDates: boolean;
  includePhotos: boolean;
  /** True once the user has touched the photos box: the format then stops choosing for them. */
  photosTouched: boolean;
  showRuler: boolean;
  theme: ExportTheme;
  privacy: boolean;
  /** True once the user has touched the privacy box: the format then stops choosing for them. */
  privacyTouched: boolean;
  background: "transparent" | "solid";
  scale: 1 | 2 | 3 | 4;
  /** JPEG quality, 0.5 to 1. */
  quality: number;
  page: PosterPage;
  /** The "Custom" poster page, in mm. */
  customW: number;
  customH: number;
  orientation: "auto" | "portrait" | "landscape";
  marginMm: number;
  tiledPage: TiledPage;
  tiledScale: number;
};

export function clampPageMm(v: number): number {
  return Math.min(CUSTOM_PAGE_MAX_MM, Math.max(CUSTOM_PAGE_MIN_MM, Number.isFinite(v) ? v : 0));
}

/** The poster page as `toPosterPdf` takes it: a name, or the custom size in mm. */
export function posterPageSpec(s: Pick<ExportSettings, "page" | "customW" | "customH">): PageSpec {
  return s.page === "Custom" ? { w: clampPageMm(s.customW), h: clampPageMm(s.customH) } : s.page;
}

export function tiledPageGuard(count: number): "ok" | "confirm" | "refuse" {
  if (count > TILED_MAX_PAGES) return "refuse";
  return count > TILED_CONFIRM_PAGES ? "confirm" : "ok";
}

/** FR-X10: privacy is on for HTML and image exports, off for SVG and PDF. */
export function privacyDefault(format: ExportFormat): boolean {
  return format === "html" || format === "png" || format === "jpeg";
}

export function defaultSettings(): ExportSettings {
  return {
    format: "svg",
    scope: "view",
    title: "",
    subtitle: "",
    includeDates: true,
    includePhotos: false,
    photosTouched: false,
    showRuler: false,
    theme: "light",
    privacy: privacyDefault("svg"),
    privacyTouched: false,
    background: "solid",
    scale: 2,
    quality: 0.92,
    page: "A3",
    customW: 420,
    customH: 594,
    orientation: "auto",
    marginMm: 10,
    tiledPage: "A4",
    tiledScale: 1,
  };
}

/** Changes the format; the privacy box follows the new format's default unless the user chose. */
export function switchFormat(s: ExportSettings, format: ExportFormat): ExportSettings {
  return {
    ...s,
    format,
    privacy: s.privacyTouched ? s.privacy : privacyDefault(format),
    // FR-X7: the backup is a full one, photos included, unless the user says otherwise.
    includePhotos: s.photosTouched ? s.includePhotos : format === "json",
  };
}

const EXTENSIONS: Record<ExportFormat, string> = {
  svg: "svg",
  png: "png",
  jpeg: "jpg",
  "pdf-poster": "pdf",
  "pdf-tiled": "pdf",
  html: "html",
  json: "stam.json",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "{slug}-{yyyy-mm-dd}.{ext}", using the local calendar day. */
export function exportFileName(
  doc: Pick<TreeDocument, "name">,
  format: ExportFormat,
  now: Date = new Date(),
): string {
  const slug =
    doc.name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "family";
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${slug}-${day}.${EXTENSIONS[format]}`;
}

/** Whether the background choice means anything for this format. */
export function allowsTransparent(format: ExportFormat): boolean {
  return format === "svg" || format === "png";
}

export function toExportOptions(s: ExportSettings): ExportOptions {
  const title = s.title.trim();
  const subtitle = s.subtitle.trim();
  return {
    scope: s.scope,
    theme: s.theme,
    ...(title ? { title } : {}),
    ...(subtitle ? { subtitle } : {}),
    includeDates: s.includeDates,
    includePhotos: s.includePhotos,
    showRuler: s.showRuler,
    privacy: s.privacy,
    background: allowsTransparent(s.format) ? s.background : "solid",
  };
}

export type OutputEstimate =
  { kind: "px"; width: number; height: number } | { kind: "pages"; count: number };

/** The drawing's padding on each side (the renderer's 48 px), twice. */
const PADDING_PX = 96;
const TILE_OVERLAP_MM = 10;

type Size = { width: number; height: number };

function scopeSize(scope: ExportScope, input: Omit<ExportInput, "photos">): Size {
  if (scope === "visible" && input.visibleRect) return input.visibleRect;
  const { doc } = input;
  if (scope === "whole" && doc.rootPersonId) {
    return layoutFamily(doc, { rootId: doc.rootPersonId }).bounds;
  }
  if (scope === "branch" && input.selectedId && doc.persons[input.selectedId]) {
    return layoutFamily(doc, { rootId: input.selectedId }).bounds;
  }
  return input.layout.bounds;
}

/** What the file will roughly be: pixels for images, SVG and HTML, a page count for PDF. */
export function estimateOutput(
  s: ExportSettings,
  input: Omit<ExportInput, "photos">,
): OutputEstimate | null {
  if (s.format === "json") return null;
  const size = scopeSize(s.scope, input);
  const width = Math.ceil(size.width + PADDING_PX);
  const height = Math.ceil(size.height + PADDING_PX);
  switch (s.format) {
    case "png":
    case "jpeg":
      return { kind: "px", width: width * s.scale, height: height * s.scale };
    case "pdf-poster":
      return { kind: "pages", count: 1 };
    case "pdf-tiled": {
      // The real layout (it picks the orientation with fewer pages); the first page is the guide.
      const { pageCount } = tileLayout(width, height, {
        page: s.tiledPage,
        scale: s.tiledScale,
        overlapMm: TILE_OVERLAP_MM,
      });
      return { kind: "pages", count: pageCount };
    }
    default:
      return { kind: "px", width, height };
  }
}
