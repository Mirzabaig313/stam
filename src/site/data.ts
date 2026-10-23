// The sample family, computed once per page load with the real engine.

import { applyCommand } from "@/core/commands/apply";

import { buildChapterDocs, type SampleDoc } from "./sample/family";
import { type Frame, frameOf } from "./sample/frames";

export const CHAPTER_DOCS: SampleDoc[] = buildChapterDocs();
export const FRAMES: Frame[] = CHAPTER_DOCS.map((sample) => frameOf(sample));
export const FINAL_DOC: SampleDoc = CHAPTER_DOCS.at(-1)!;
export const FINAL: Frame = FRAMES.at(-1)!;

/** Drag demo: Ada's children (chapter III), then Ines dragged to the front with reorderChild. */
function dragFrames(): [Frame, Frame] {
  const before = CHAPTER_DOCS[2]!;
  const unionId = Object.entries(before.unionKeyOf).find(([, k]) => k === "ada+tomas")![0];
  const { doc } = applyCommand(
    before.doc,
    { type: "reorderChild", unionId, personId: before.ids.ines!, toIndex: 0 },
    new Date("2026-10-23T00:00:00Z"),
  );
  return [frameOf(before), frameOf({ ...before, doc })];
}

export const DRAG_FRAMES = dragFrames();
