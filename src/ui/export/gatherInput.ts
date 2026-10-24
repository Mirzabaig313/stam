import type { LayoutResult } from "@/core/layout/types";
import type { TreeDocument } from "@/core/model/types";
import { isLivingPerson } from "@/export/render/privacy";
import { selectScope } from "@/export/render/scope";
import type { ExportInput, ExportOptions, ExportScope } from "@/export/types";
import type { TreeRepo } from "@/storage/treeRepo";
import type { CardStyles } from "@/templates/cardStyle";
import type { Look } from "@/templates/look";
import type { CanvasHandle } from "@/ui/canvas/Canvas";

type Rect = NonNullable<ExportInput["visibleRect"]>;

/** The part of the world the canvas shows now: its two screen corners, in world coordinates. */
export function visibleWorldRect(
  canvas: Pick<CanvasHandle, "screenToWorld"> | null,
  size: { width: number; height: number } | null,
): Rect | undefined {
  if (!canvas || !size) return undefined;
  const [x1, y1] = canvas.screenToWorld([0, 0]);
  const [x2, y2] = canvas.screenToWorld([size.width, size.height]);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("PHOTO_READ")));
    reader.readAsDataURL(blob);
  });
}

export type GatherArgs = {
  doc: TreeDocument;
  layout: LayoutResult;
  viewRootId: string | null;
  selectedId: string | null;
  visibleRect?: Rect;
  repo: Pick<TreeRepo, "getPhoto">;
  /** Whose photos are read; without it, everyone's. */
  scope?: ExportScope;
  includePhotos: boolean;
  /** With privacy on, photos of living people are not read at all. */
  privacy: boolean;
  /** The tree's look: `layout` was built with it. */
  look?: Look;
  /** Cards styled on their own, by person. */
  cardStyles?: CardStyles;
};

/** Builds the exporters' input from the editor's state; photos become data URLs. */
export async function gatherInput(args: GatherArgs): Promise<ExportInput> {
  const photos: Record<string, string> = {};
  if (args.includePhotos) {
    const input: ExportInput = {
      doc: args.doc,
      layout: args.layout,
      viewRootId: args.viewRootId,
      selectedId: args.selectedId,
      ...(args.visibleRect ? { visibleRect: args.visibleRect } : {}),
      photos,
    };
    const inScope = args.scope
      ? new Set(
          selectScope(input, { scope: args.scope } as ExportOptions).nodes.map((n) => n.personId),
        )
      : null;
    for (const person of Object.values(args.doc.persons)) {
      const id = person.photoId;
      if (!id || photos[id] !== undefined) continue;
      if (inScope && !inScope.has(person.id)) continue;
      if (args.privacy && isLivingPerson(person)) continue;
      const blob = await args.repo.getPhoto(id);
      if (blob) photos[id] = await blobToDataUrl(blob);
    }
  }
  return {
    doc: args.doc,
    layout: args.layout,
    viewRootId: args.viewRootId,
    selectedId: args.selectedId,
    ...(args.visibleRect ? { visibleRect: args.visibleRect } : {}),
    photos,
    ...(args.look ? { look: args.look } : {}),
    ...(args.cardStyles ? { cardStyles: args.cardStyles } : {}),
  };
}
