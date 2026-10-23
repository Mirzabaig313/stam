import type { i18n as I18n, TFunction } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";

import { CARD_H, CARD_W } from "@/core/layout/constants";
import type { LayoutResult } from "@/core/layout/types";
import type { TreeDocument } from "@/core/model/types";
import type { ExportInput, ExportOptions, RenderedSvg } from "@/export/types";
import { Edges } from "@/ui/canvas/Edges";
import { rowsOf, toRoman } from "@/ui/canvas/GenerationRuler";
import { PersonCard } from "@/ui/cards/PersonCard";

import { fontFaceCss, fontsFor } from "./fonts";
import { applyPrivacy, withoutDates } from "./privacy";
import { selectScope } from "./scope";
import { PALETTES, themeCss } from "./theme";

const PAD = 48;
const RULER_W = 40;
const RULER_GAP = 16;
const RULER_TICK = 6;
const TITLE_SIZE = 28;
const SUBTITLE_SIZE = 15;
const HEADER_GAP = 32;
/** Average Archivo advance per em: an estimate, used only to keep a long title on the page. */
const AVG_ADVANCE = 0.6;

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** Rounds to 1/100 px and turns -0 into 0. */
const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

/** XML text and attribute escaping, for the few strings written outside React. */
function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The cards call `useTranslation()`. Exports take a plain `t`, so it is handed to them through a
 * minimal, always-ready i18next stand-in (only what react-i18next's hook reads on the server).
 */
const noop = () => {};

function staticI18n(t: TFunction): I18n {
  return {
    isInitialized: true,
    language: "export",
    languages: ["export"],
    options: { react: { useSuspense: false, bindI18n: "", bindI18nStore: "" } },
    reportNamespaces: { addUsedNamespaces: noop },
    hasLoadedNamespace: () => true,
    getFixedT: () => t,
    on: noop,
    off: noop,
    store: { on: noop, off: noop },
  } as unknown as I18n;
}

/** The layout flipped around x = 0, so the tree reads right to left (as the canvas mirrors it). */
function mirrored(layout: LayoutResult): LayoutResult {
  const b = layout.bounds;
  return {
    ...layout,
    nodes: layout.nodes.map((n) => ({ ...n, x: -(n.x + CARD_W) })),
    edges: layout.edges.map((e) => ({
      ...e,
      points: e.points.map(([x, y]): [number, number] => [-x, y]),
    })),
    bounds: { ...b, x: -(b.x + b.width) },
  };
}

/** The people's data an export may show: privacy and the dates option applied. */
function exportDoc(doc: TreeDocument, opts: ExportOptions): TreeDocument {
  const visible = opts.privacy ? applyPrivacy(doc) : doc;
  return opts.includeDates ? visible : withoutDates(visible);
}

/** Only inline images: an export never points at the network. */
const isDataImage = (url: string | undefined): url is string =>
  url !== undefined && /^data:image\/[a-z0-9.+-]+[;,]/i.test(url);

type Geometry = {
  width: number;
  height: number;
  /** Tree group offset (layout coordinates to drawing). */
  dx: number;
  dy: number;
  treeTop: number;
  treeHeight: number;
  title?: { x: number; y: number };
  subtitle?: { x: number; y: number };
  ruler?: { x: number; edge: number };
};

function geometryOf(
  layout: LayoutResult,
  opts: ExportOptions,
  rtl: boolean,
  title: string,
  subtitle: string,
): Geometry {
  const b = layout.bounds;
  const ruler = opts.showRuler && layout.nodes.length > 0;
  const rulerSpace = ruler ? RULER_W + RULER_GAP : 0;

  let header = 0;
  let titleY: number | undefined;
  let subtitleY: number | undefined;
  if (title) {
    titleY = PAD + TITLE_SIZE;
    header = TITLE_SIZE * 1.25;
  }
  if (subtitle) {
    header += title ? 8 : 0;
    subtitleY = PAD + header + SUBTITLE_SIZE;
    header += SUBTITLE_SIZE * 1.4;
  }
  if (header > 0) header += HEADER_GAP;

  const textWidth = Math.max(
    Array.from(title).length * TITLE_SIZE * AVG_ADVANCE,
    Array.from(subtitle).length * SUBTITLE_SIZE * AVG_ADVANCE,
  );
  const width = Math.ceil(Math.max(b.width + rulerSpace, textWidth) + 2 * PAD);
  const height = Math.ceil(b.height + header + 2 * PAD);
  const treeTop = PAD + header;
  const treeLeft = rtl ? width - PAD - rulerSpace - b.width : PAD + rulerSpace;
  // The root carries direction="rtl", so "start" anchors titles at the right.
  const textX = rtl ? width - PAD : PAD;
  const rulerX = rtl ? width - PAD - RULER_W : PAD;
  return {
    width,
    height,
    dx: r2(treeLeft - b.x),
    dy: r2(treeTop - b.y),
    treeTop,
    treeHeight: b.height,
    title: titleY === undefined ? undefined : { x: textX, y: titleY },
    subtitle: subtitleY === undefined ? undefined : { x: textX, y: subtitleY },
    ruler: ruler ? { x: rulerX, edge: rtl ? rulerX : rulerX + RULER_W } : undefined,
  };
}

type BodyProps = {
  doc: TreeDocument;
  layout: LayoutResult;
  opts: ExportOptions;
  geo: Geometry;
  rtl: boolean;
  title: string;
  subtitle: string;
  photoOf: (personId: string) => string | undefined;
};

function ExportBody({ doc, layout, opts, geo, rtl, title, subtitle, photoOf }: BodyProps) {
  const inward = rtl ? RULER_TICK : -RULER_TICK;
  return (
    <>
      {opts.background === "solid" && (
        <rect
          className="stam-export__ground"
          width={geo.width}
          height={geo.height}
          fill={PALETTES[opts.theme].ground}
        />
      )}
      {geo.title && (
        <text
          className="stam-export__title"
          x={geo.title.x}
          y={geo.title.y}
          textAnchor="start"
          fontSize={TITLE_SIZE}
          fontWeight={600}
          unicodeBidi="isolate"
        >
          {title}
        </text>
      )}
      {geo.subtitle && (
        <text
          className="stam-export__subtitle"
          x={geo.subtitle.x}
          y={geo.subtitle.y}
          textAnchor="start"
          fontSize={SUBTITLE_SIZE}
          unicodeBidi="isolate"
        >
          {subtitle}
        </text>
      )}
      {geo.ruler && (
        <g className="stam-export__ruler">
          <line
            x1={geo.ruler.edge}
            x2={geo.ruler.edge}
            y1={geo.treeTop}
            y2={r2(geo.treeTop + geo.treeHeight)}
          />
          {rowsOf(layout.nodes).map(({ generation, y }) => {
            const cy = r2(y + geo.dy + CARD_H / 2);
            return (
              <g key={generation}>
                <line x1={geo.ruler!.edge + inward} x2={geo.ruler!.edge} y1={cy} y2={cy} />
                <text
                  x={geo.ruler!.x + RULER_W / 2}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight={600}
                >
                  {toRoman(generation + 1)}
                </text>
              </g>
            );
          })}
        </g>
      )}
      <g className="stam-export__tree" transform={`translate(${geo.dx} ${geo.dy})`}>
        <Edges edges={layout.edges} lod="full" />
        <g className="stam-export__nodes">
          {layout.nodes.map((node) => (
            <PersonCard
              key={node.nodeId}
              doc={doc}
              node={node}
              lod="full"
              dir={rtl ? "rtl" : "ltr"}
              photoUrl={photoOf(node.personId)}
              static
            />
          ))}
        </g>
      </g>
    </>
  );
}

/**
 * The family as one standalone SVG string, the source of every export format. Cards, connectors
 * and the ruler are the canvas's own (static cards), drawn at full detail with the theme's colours
 * resolved, Archivo embedded, and photos inline. Privacy and the dates option are applied to the
 * document first; the scope picks the layout. Sizes are CSS px.
 *
 * `dir: "rtl"` mirrors the tree as the canvas does; `visibleRect` stays in layout coordinates.
 */
export function renderTreeSvg(
  input: ExportInput,
  opts: ExportOptions,
  t: TFunction,
  { dir = "ltr" }: { dir?: "ltr" | "rtl" } = {},
): RenderedSvg {
  const rtl = dir === "rtl";
  const doc = exportDoc(input.doc, opts);
  const scoped = selectScope({ ...input, doc }, opts);
  const layout = rtl ? mirrored(scoped) : scoped;

  const title = opts.title?.trim() ?? "";
  const subtitle = opts.subtitle?.trim() ?? "";
  const geo = geometryOf(layout, opts, rtl, title, subtitle);
  const photoOf = (personId: string) => {
    if (!opts.includePhotos) return undefined;
    const photoId = doc.persons[personId]?.photoId;
    const url = photoId ? input.photos[photoId] : undefined;
    return isDataImage(url) ? url : undefined;
  };

  const body = renderToStaticMarkup(
    <I18nextProvider i18n={staticI18n(t)}>
      <ExportBody
        doc={doc}
        layout={layout}
        opts={opts}
        geo={geo}
        rtl={rtl}
        title={title}
        subtitle={subtitle}
        photoOf={photoOf}
      />
    </I18nextProvider>,
    { identifierPrefix: "stam-x-" },
  );

  const css = `${fontFaceCss(fontsFor(doc))}\n${themeCss(opts.theme)}`;
  const label = escapeXml(title || input.doc.name);
  const svg =
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" width="${geo.width}" height="${geo.height}"` +
    ` viewBox="0 0 ${geo.width} ${geo.height}" class="stam-export stam-export--${opts.theme}"` +
    ` role="img" aria-label="${label}"${rtl ? ' direction="rtl"' : ""}>` +
    `<title>${label}</title><style>${css}</style>${body}</svg>`;
  return { svg, width: geo.width, height: geo.height };
}
