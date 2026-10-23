/** Page sizes in portrait millimetres. */
export const PAGE_SIZES_MM = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
  Letter: { w: 215.9, h: 279.4 },
  Tabloid: { w: 279.4, h: 431.8 },
} as const;

export type PageName = keyof typeof PAGE_SIZES_MM;
export type PageSpec = PageName | { w: number; h: number };
export type Orientation = "portrait" | "landscape";

/** One CSS px is 1/96 inch. */
export const PX_TO_MM = 25.4 / 96;

/** The white border around each tile that holds the crop marks and labels. */
export const TILE_MARGIN_MM = 10;

export type PosterOptions = {
  page: PageSpec;
  orientation: "auto" | Orientation;
  marginMm: number;
};

export type PosterLayout = {
  orientation: Orientation;
  pageW: number;
  pageH: number;
  /** Where the drawing goes on the page, in mm. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Printed size relative to the natural size (1 CSS px = 1/96 inch). */
  scale: number;
};

function pageSize(page: PageSpec): { w: number; h: number } {
  const size = typeof page === "string" ? PAGE_SIZES_MM[page] : page;
  if (!size || !(size.w > 0) || !(size.h > 0)) throw new RangeError("Invalid page size");
  return size;
}

function oriented(size: { w: number; h: number }, orientation: Orientation): [number, number] {
  const short = Math.min(size.w, size.h);
  const long = Math.max(size.w, size.h);
  return orientation === "portrait" ? [short, long] : [long, short];
}

function checkDrawing(widthPx: number, heightPx: number): void {
  if (!(widthPx > 0) || !(heightPx > 0)) throw new RangeError("The drawing is empty");
}

/** One page, scaled to fit inside the margins and centred. */
export function posterLayout(widthPx: number, heightPx: number, o: PosterOptions): PosterLayout {
  checkDrawing(widthPx, heightPx);
  const size = pageSize(o.page);
  const natW = widthPx * PX_TO_MM;
  const natH = heightPx * PX_TO_MM;
  const fit = (orientation: Orientation): PosterLayout | null => {
    const [pageW, pageH] = oriented(size, orientation);
    const availW = pageW - 2 * o.marginMm;
    const availH = pageH - 2 * o.marginMm;
    if (!(availW > 0) || !(availH > 0)) return null;
    const scale = Math.min(availW / natW, availH / natH);
    const width = natW * scale;
    const height = natH * scale;
    return {
      orientation,
      pageW,
      pageH,
      x: (pageW - width) / 2,
      y: (pageH - height) / 2,
      width,
      height,
      scale,
    };
  };
  const candidates: (PosterLayout | null)[] =
    o.orientation === "auto" ? [fit("portrait"), fit("landscape")] : [fit(o.orientation)];
  let best: PosterLayout | null = null;
  for (const c of candidates) if (c && (!best || c.scale > best.scale + 1e-9)) best = c;
  if (!best) throw new RangeError("The margins leave no room on the page");
  return best;
}

export type TiledOptions = {
  page: "A4" | "Letter";
  /** Printed size relative to the natural size (1 CSS px = 1/96 inch). */
  scale: number;
  overlapMm: number;
};

export type Tile = {
  row: number;
  col: number;
  /** Top-left of this tile's window into the printed drawing, in mm. */
  sx: number;
  sy: number;
};

export type TileLayout = {
  orientation: Orientation;
  pageW: number;
  pageH: number;
  /** The printed area of each tile (page minus the mark margin), in mm. */
  trimW: number;
  trimH: number;
  /** The whole drawing at the requested scale, in mm. */
  contentW: number;
  contentH: number;
  cols: number;
  rows: number;
  /** Tiles plus the assembly guide. */
  pageCount: number;
  tiles: Tile[];
};

function tilesAlong(content: number, trim: number, overlap: number): number {
  return Math.max(1, Math.ceil((content - overlap) / (trim - overlap) - 1e-9));
}

/** Splits the drawing over pages of one size; the orientation with fewer pages wins. */
export function tileLayout(widthPx: number, heightPx: number, o: TiledOptions): TileLayout {
  checkDrawing(widthPx, heightPx);
  if (!(o.scale > 0)) throw new RangeError("The scale must be positive");
  const size = pageSize(o.page);
  const contentW = widthPx * PX_TO_MM * o.scale;
  const contentH = heightPx * PX_TO_MM * o.scale;
  const plan = (orientation: Orientation) => {
    const [pageW, pageH] = oriented(size, orientation);
    const trimW = pageW - 2 * TILE_MARGIN_MM;
    const trimH = pageH - 2 * TILE_MARGIN_MM;
    if (!(o.overlapMm >= 0) || o.overlapMm >= Math.min(trimW, trimH)) {
      throw new RangeError("The overlap must be smaller than the page");
    }
    const cols = tilesAlong(contentW, trimW, o.overlapMm);
    const rows = tilesAlong(contentH, trimH, o.overlapMm);
    return { orientation, pageW, pageH, trimW, trimH, cols, rows };
  };
  const portrait = plan("portrait");
  const landscape = plan("landscape");
  const best =
    landscape.cols * landscape.rows < portrait.cols * portrait.rows ? landscape : portrait;
  const tiles: Tile[] = [];
  for (let row = 0; row < best.rows; row++) {
    for (let col = 0; col < best.cols; col++) {
      tiles.push({
        row,
        col,
        sx: col * (best.trimW - o.overlapMm),
        sy: row * (best.trimH - o.overlapMm),
      });
    }
  }
  return { ...best, contentW, contentH, pageCount: tiles.length + 1, tiles };
}

/** "A1" for the top-left tile: column letters (A..Z, AA..), row numbers from 1. */
export function cellName(row: number, col: number): string {
  let letters = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return `${letters}${row + 1}`;
}
