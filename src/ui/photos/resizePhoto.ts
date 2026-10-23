/** The size that fits `w` x `h` inside a `max` x `max` box, keeping the ratio; never enlarges. */
export function fitWithin(w: number, h: number, max = 512): [number, number] {
  const scale = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}

/** Downscales an image to at most `max` px on its long side and re-encodes it as WebP. */
export async function resizePhoto(file: Blob, max = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const [width, height] = fitWithin(bitmap.width, bitmap.height, max);
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d canvas unavailable");
      ctx.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode photo"))),
        "image/webp",
        0.85,
      );
    });
  } finally {
    bitmap.close();
  }
}
