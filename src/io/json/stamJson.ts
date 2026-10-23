import { newId } from "@/core/model/ids";
import type { TreeDocument } from "@/core/model/types";

import { ImportError } from "./errors";
import { CURRENT_SCHEMA_VERSION } from "./migrations";
import { isSafeId, parseTreeDocument } from "./parseTree";

export { ImportError, type ImportErrorCode } from "./errors";

export type StamFile = {
  format: "stam";
  schemaVersion: 1;
  exportedAt: string;
  tree: TreeDocument;
  /** photoId -> data URL. */
  photos?: Record<string, string>;
};

/** A photo left out of an import. The UI turns the code into a message. */
export type ImportWarning = { code: "PHOTO_DROPPED"; photoId: string };

export const MAX_IMPORT_CHARS = 50 * 1024 * 1024;

const PHOTO_URL = /^data:image\/(webp|png|jpeg);base64,/;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

// ---------------------------------------------------------------- export

export async function exportStamJson(
  doc: TreeDocument,
  photos: Record<string, Blob>,
  opts: { includePhotos: boolean },
): Promise<string> {
  const file: StamFile = {
    format: "stam",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tree: doc,
  };
  if (opts.includePhotos) {
    const encoded: Record<string, string> = {};
    for (const [photoId, blob] of Object.entries(photos)) {
      encoded[photoId] = await blobToDataUrl(blob);
    }
    file.photos = encoded;
  }
  return JSON.stringify(file);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "{slug}-{yyyy-mm-dd}.stam.json", using the local calendar day. */
export function backupFileName(doc: TreeDocument, now: Date = new Date()): string {
  const slug =
    doc.name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "family";
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${slug}-${day}.stam.json`;
}

// ---------------------------------------------------------------- import

export async function importStamJson(
  text: string,
): Promise<{ doc: TreeDocument; photos: Record<string, Blob>; warnings: ImportWarning[] }> {
  if (text.length > MAX_IMPORT_CHARS) {
    throw new ImportError("TOO_LARGE", "This file is larger than 50 MB");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportError("NOT_JSON", "This file is not valid JSON");
  }

  if (!isRecord(parsed) || parsed.format !== "stam") {
    throw new ImportError("NOT_STAM", "This file is not a Stam family tree");
  }
  const version = parsed.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new ImportError("NOT_STAM", "This file has no valid schema version");
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new ImportError(
      "FUTURE_VERSION",
      `This file was made by a newer version of the app (schema ${version})`,
    );
  }
  if (!isRecord(parsed.tree)) throw new ImportError("NOT_STAM", "This file has no tree");
  if (parsed.photos !== undefined && !isRecord(parsed.photos)) {
    throw new ImportError("NOT_STAM", "The photos in this file are malformed");
  }
  if (parsed.tree.schemaVersion !== version) {
    throw new ImportError(
      "INVALID_TREE",
      "The tree and the file disagree about the schema version",
    );
  }

  const tree = parseTreeDocument(parsed.tree);
  const warnings: ImportWarning[] = [];
  const photos = decodePhotos(parsed.photos, warnings);

  // A new tree, made now: it lists as just edited.
  const now = new Date().toISOString();
  const doc: TreeDocument = { ...tree, id: newId(), createdAt: now, updatedAt: now };
  return { doc, photos, warnings };
}

function decodePhotos(
  raw: Record<string, unknown> | undefined,
  warnings: ImportWarning[],
): Record<string, Blob> {
  const decoded: [string, Blob][] = [];
  for (const [photoId, url] of Object.entries(raw ?? {})) {
    const blob = isSafeId(photoId) && typeof url === "string" ? dataUrlToBlob(url) : undefined;
    if (blob) decoded.push([photoId, blob]);
    else warnings.push({ code: "PHOTO_DROPPED", photoId });
  }
  // fromEntries defines own properties, so no key can reach the prototype.
  return Object.fromEntries(decoded);
}

function dataUrlToBlob(url: string): Blob | undefined {
  const match = PHOTO_URL.exec(url);
  if (!match) return undefined;
  const body = url.slice(match[0].length);
  if (!BASE64_BODY.test(body) || body.length % 4 === 1) return undefined;
  try {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: `image/${match[1]}` });
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
