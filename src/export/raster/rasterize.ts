import type { RenderedSvg } from "../types";
import { detectEnv, maxScale } from "./limits";

export type RasterOptions = {
  format: "png" | "jpeg";
  scale: 1 | 2 | 3 | 4;
  quality?: number;
  background: "transparent" | "solid";
  /** Fill colour used for a solid background, and always for JPEG. */
  ground: string;
};

export type RasterResult = { blob: Blob; scale: number; warning?: string };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img), { once: true });
    img.addEventListener(
      "error",
      () => reject(new Error("The drawing could not be decoded as an image.")),
      {
        once: true,
      },
    );
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("The canvas produced no image."))),
      type,
      quality,
    );
  });
}

export async function rasterize(r: RenderedSvg, o: RasterOptions): Promise<RasterResult> {
  const { scale, warning } = maxScale(r.width, r.height, o.scale, detectEnv());
  const pw = Math.max(1, Math.floor(r.width * scale));
  const ph = Math.max(1, Math.floor(r.height * scale));

  const url = URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await loadImage(url);
    const canvas: HTMLCanvasElement | OffscreenCanvas =
      typeof OffscreenCanvas === "undefined"
        ? Object.assign(document.createElement("canvas"), { width: pw, height: ph })
        : new OffscreenCanvas(pw, ph);
    const ctx = canvas.getContext("2d") as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("A 2D canvas is not available.");
    if (o.format === "jpeg" || o.background === "solid") {
      ctx.fillStyle = o.ground;
      ctx.fillRect(0, 0, pw, ph);
    }
    ctx.drawImage(img, 0, 0, pw, ph);
    const type = o.format === "jpeg" ? "image/jpeg" : "image/png";
    const blob = await canvasToBlob(canvas, type, o.quality ?? 0.92);
    return warning ? { blob, scale, warning } : { blob, scale };
  } finally {
    URL.revokeObjectURL(url);
  }
}
