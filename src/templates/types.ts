import type { ReactNode } from "react";

import type { Gender } from "@/core/model/types";

import type { CardStyle } from "./cardStyle";
import type { TemplateId } from "./look";
import type { Font } from "./text";

/**
 * A template's colours, as literals: faces draw them as inline styles, so the canvas and every
 * export (SVG, PNG, PDF) show the same thing and no stylesheet can change them.
 */
export type Palette = {
  /** The page or canvas behind the tree. */
  ground: string;
  /** A card's fill, and a deceased person's. */
  card: string;
  cardDeceased: string;
  /** Names; secondary text (native names, years); a card's edge; connectors. */
  ink: string;
  muted: string;
  edge: string;
  line: string;
  /** The template's own accent: gold, vermilion, mulberry, bark... */
  accent: string;
  /** Text and marks drawn on the accent. */
  onAccent: string;
  /** A softer second colour: the photo slot's well, married-in leaves, inner frames. */
  soft: string;
  /** Deceased people's edge or mark where the template uses one (autumn leaf, mourning ribbon). */
  memorial: string;
  /** Avatar fills for initials: the six album hues, light or dark. */
  hues: readonly [string, string, string, string, string, string];
  /** The gender marker (the photo slot's ring), PRD FR-L5's default colour key. */
  male: string;
  female: string;
};

export type TemplateFonts = {
  name: Font;
  native: Font;
  years: Font;
  /** The poster's title. */
  title: Font;
};

/** How a template draws the engine's connector routes. */
export type ConnectorStyle = {
  /** At 100 % card size; scaled with it. */
  width: number;
  /** Rounded corners (0: square). */
  radius: number;
  /** A hand-drawn offset per segment, in px at 100 %. */
  wobble: number;
  /** Botanical: lines thin out from the eldest row down (or up). */
  taper?: boolean;
  /** Couples: a mark on the middle of the couple line. */
  coupleMark?: "diamond" | "none";
  /**
   * Gallery: couple lines run into the cards up to a disc of this radius (at 100 %) on each card's
   * centre line, so they meet the medallions instead of stopping at the cards' empty edges.
   */
  coupleMeets?: number;
  /** Dash of an adopted, step or foster child's own drop. */
  adoptedDash: string;
};

/** What a face needs to draw one card. Lengths are card px; `s` and `ts` are the size scales. */
export type FaceInput = {
  W: number;
  H: number;
  /** Card size scale and text scale (card size × text size). */
  s: number;
  ts: number;
  dir: "ltr" | "rtl";
  /** An export: no canvas-only marks, room for nothing in the corner. */
  isStatic: boolean;
  palette: Palette;
  fonts: TemplateFonts;
  name: string;
  nativeName: string;
  /** The years line, already in its export or canvas form; "" for none (privacy, no dates). */
  years: string;
  /** "Deceased", shown in place of years for a deceased person with none. */
  deceasedWord: string;
  initials: string;
  hue: number;
  gender: Gender;
  deceased: boolean;
  placeholder: boolean;
  linked: boolean;
  /** Married into the family (a spouse card). */
  marriedIn: boolean;
  /** The view's top row (the eldest people). */
  eldest: boolean;
  photoUrl?: string;
  /** A unique id prefix for clip paths. */
  uid: string;
  /** Width kept free at the bottom inline-end corner for the collapse control or "+N" pill. */
  cornerReserve: number;
  /** The card's own style, on top of the template (fill, border, corners, padding, text). */
  style?: CardStyle;
};

export type FaceDrawing = {
  /** Drawn inside the card's button group (fills, edges, the photo slot, the colour key). */
  shape: ReactNode;
  /** The decorative text beside it (aria-hidden; the group's label says all of it). */
  texts: ReactNode;
  /** The card's outline as a path: the selection ring and focus ring follow it. */
  outline: string;
  /** A slight tilt in degrees (Album prints); the rings tilt with it. */
  tilt?: number;
  /** Where the text starts, inline-start px, and the last line's baseline: "see original". */
  textX: number;
  lastLineY: number;
  /** Centre of the corner controls (collapse, "+N"), inline-start px. */
  corner: { x: number; y: number };
};

export type Template = {
  id: TemplateId;
  palettes: { light: Palette; dark: Palette; paper: Palette };
  fonts: TemplateFonts;
  /** "up": the eldest row at the bottom (Botanical). */
  growth: "down" | "up";
  /** The direction the template reads best in (Shajara: rtl). */
  preferredDirection?: "ltr" | "rtl";
  connectors: ConnectorStyle;
  face: (input: FaceInput) => FaceDrawing;
};
