import type { LayoutResult } from "@/core/layout/types";
import type { TreeDocument } from "@/core/model/types";

export type ExportScope = "whole" | "view" | "branch" | "visible";
export type ExportTheme = "light" | "print";
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
};
export type ExportInput = {
  doc: TreeDocument;
  layout: LayoutResult; // current family-view layout
  viewRootId: string | null;
  selectedId: string | null; // "branch" = the selected person and their descendants
  visibleRect?: { x: number; y: number; width: number; height: number }; // world coordinates, for "visible"
  photos: Record<string, string>; // photoId -> data URL (only when includePhotos)
};
export type RenderedSvg = { svg: string; width: number; height: number }; // CSS px
export type ExportPerson = {
  id: string;
  name: string;
  nativeName?: string;
  lifespan: string;
  details: { label: string; value: string }[];
};
