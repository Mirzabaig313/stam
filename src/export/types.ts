import type { LayoutResult } from "@/core/layout/types";
import type { TreeDocument } from "@/core/model/types";
import type { CardStyles } from "@/templates/cardStyle";
import type { Look } from "@/templates/look";

export type ExportScope = "whole" | "view" | "branch" | "visible";
export type ExportTheme = "light" | "dark" | "print";
export type ExportOptions = {
  scope: ExportScope;
  theme: ExportTheme;
  title?: string;
  subtitle?: string;
  includeDates: boolean;
  includePhotos: boolean;
  showRuler: boolean;
  privacy: boolean;
  background: "transparent" | "solid";
  /** The template and sizes to draw with; the tree's own look (`ExportInput.look`) when left out. */
  look?: Look;
  /** The template's page: border, title block, numerals and legend around the tree. */
  frame?: boolean;
  /** The small "Made with Stam" line in the legend band (with the frame). */
  madeWith?: boolean;
};
export type ExportInput = {
  doc: TreeDocument;
  layout: LayoutResult; // current family-view layout
  viewRootId: string | null;
  selectedId: string | null; // "branch" = the selected person and their descendants
  visibleRect?: { x: number; y: number; width: number; height: number }; // world coordinates, for "visible"
  photos: Record<string, string>; // photoId -> data URL (only when includePhotos)
  /** The tree's look: `layout` was built with it. The default look when left out. */
  look?: Look;
  /** Cards styled on their own, by person: their sizes are in `layout`, their looks drawn. */
  cardStyles?: CardStyles;
};
export type RenderedSvg = { svg: string; width: number; height: number }; // CSS px
export type ExportPerson = {
  id: string;
  name: string;
  nativeName?: string;
  lifespan: string;
  details: { label: string; value: string }[];
};
