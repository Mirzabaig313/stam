const PATHS = {
  undo: "M6 3 2.5 6.5 6 10M3 6.5h6.5a3.5 3.5 0 0 1 0 7H6",
  redo: "m10 3 3.5 3.5L10 10M13 6.5H6.5a3.5 3.5 0 0 0 0 7H10",
  zoomIn: "M8 3v10M3 8h10",
  zoomOut: "M3 8h10",
  fit: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10",
  search: "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM10.5 10.5l3.5 3.5",
  focus:
    "M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z",
  menu: "M3 4.5h10M3 8h10M3 11.5h10",
  close: "M3.5 3.5l9 9M12.5 3.5l-9 9",
  viewFamily: "M6 2.5h4v3H6zM1.5 10.5h4v3h-4zM10.5 10.5h4v3h-4zM8 5.5V8M3.5 10.5V8h9v2.5",
  viewPedigree: "M1.5 2.5h4v3h-4zM10.5 2.5h4v3h-4zM6 10.5h4v3H6zM3.5 5.5V8h9V5.5M8 8v2.5",
  viewDescendants: "M2 2.5h4v3H2zM4 5.5V13M4 8.5h4M4 13h4M8 7h6v3H8zM8 11.5h6v3H8z",
  viewHourglass:
    "M3 2.5h10M3 13.5h10M4 2.5c0 3 4 4 4 5.5s-4 2.5-4 5.5M12 2.5c0 3-4 4-4 5.5s4 2.5 4 5.5",
  viewFan: "M1.5 13.5a6.5 6.5 0 0 1 13 0zM8 13.5V7M4 9.5l2.5 4M12 9.5l-2.5 4",
  viewTimeline: "M2 4h6M5 8h8M3 12h7",
  relate: "M4.5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM11.5 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 6.5l4 3.5",
  cake: "M2.5 8h11v5.5h-11zM2.5 11h11M8 8V5M8 2.5V4",
  plus: "M8 3v10M3 8h10",
  person:
    "M8 7.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM2.5 14c0-3 2.5-4.75 5.5-4.75S13.5 11 13.5 14",
  chevronDown: "m4 6 4 4 4-4",
  check: "m3 8.5 3.25 3.25L13 5",
  trash: "M2.5 4.5h11M6 4.5V2.5h4v2M4 4.5l.75 9h6.5l.75-9M6.75 7v4M9.25 7v4",
  // A gear: the toolbar's menu of tools and settings.
  settings:
    "M12.85 6.79L14.54 7.12L14.54 8.88L12.85 9.21L12.28 10.58L13.25 12L12 13.25L10.58 12.28L9.21 12.85L8.88 14.54L7.12 14.54L6.79 12.85L5.42 12.28L4 13.25L2.75 12L3.72 10.58L3.15 9.21L1.46 8.88L1.46 7.12L3.15 6.79L3.72 5.42L2.75 4L4 2.75L5.42 3.72L6.79 3.15L7.12 1.46L8.88 1.46L9.21 3.15L10.58 3.72L12 2.75L13.25 4L12.28 5.42ZM8 10.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z",
  // Two sliders: the app's preferences.
  sliders: "M2.5 4.5h11M2.5 11.5h11M5.5 2.5v4M10.5 9.5v4",
  // Three swatches fanned out: the tree's look (template and sizes).
  look: "M2.5 2.5h4v11h-4zM6.5 5.2l3.4-2 4 6.9-7.4 4.3M6.5 13.5h7v-4h-2.4M4.5 11.5h.01",
  // Card and text toolbars.
  fill: "M8 2.5c2.5 3 4 5.1 4 7a4 4 0 0 1-8 0c0-1.9 1.5-4 4-7Z",
  border: "M2.5 2.5h11v11h-11zM5 5h6v6H5z",
  radius: "M3 13.5V8.5A5.5 5.5 0 0 1 8.5 3h5",
  padding: "M2.5 2.5h11v11h-11zM5.5 5.5h5v5h-5z",
  bold: "M4.5 3h4.25a2.5 2.5 0 0 1 0 5H4.5zM4.5 8h5a2.5 2.5 0 0 1 0 5h-5z",
  italic: "M7 3h5M4 13h5M10 3 6.5 13",
  underline: "M4.5 2.5V8a3.5 3.5 0 0 0 7 0V2.5M3.5 14h9",
  alignStart: "M2.5 4h11M2.5 7h7M2.5 10h11M2.5 13h7",
  alignCenter: "M2.5 4h11M4.5 7h7M2.5 10h11M4.5 13h7",
  alignEnd: "M2.5 4h11M6.5 7h7M2.5 10h11M6.5 13h7",
  photo: "M2 4h12v9H2zM2 11l3.5-3.5 3 3 2-2L14 12M10.5 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  export: "M8 2.5v7.5M4.75 7 8 10.25 11.25 7M2.5 11v2.5h11V11",
  backup: "M2.5 3h11v3.5h-11zM3.5 6.5v6.5h9V6.5M6.5 9h3",
  back: "M10 3.5 5.5 8l4.5 4.5",
  tree: "M5.5 2.5h5v3h-5zM1.5 10.5h5v3h-5zM9.5 10.5h5v3h-5zM8 5.5V8M4 10.5V8h8v2.5",
  // The tree list's card menu and Import.
  pencil: "M10.5 2.5l3 3-8 8h-3v-3zM9 4l3 3",
  copy: "M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3",
  download: "M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11",
  upload: "M8 10.5v-8M4.5 6 8 2.5 11.5 6M2.5 13.5h11",
  // Sharing and the account.
  share:
    "M11.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM4.5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM11.5 14.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6.3 7l3.4-2M6.3 9l3.4 2",
  cloud: "M4.5 12.5h7a3 3 0 0 0 .4-6 4 4 0 0 0-7.7.9A2.6 2.6 0 0 0 4.5 12.5Z",
  sync: "M13 5.5A5.5 5.5 0 0 0 3.2 5M3 2.5V5h2.5M3 10.5a5.5 5.5 0 0 0 9.8.5M13 13.5V11h-2.5",
  account: "M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4",
  signOut: "M6.5 2.5h-4v11h4M10 5l3 3-3 3M13 8H6",
} as const;

export type IconName = keyof typeof PATHS;

/**
 * Icons that point along the reading direction flip in RTL (undo turns back toward the start;
 * the descendants and timeline views run from the right). Zoom, fit, search and the rest don't.
 */
const MIRRORED: ReadonlySet<IconName> = new Set([
  "alignStart",
  "alignEnd",
  "undo",
  "redo",
  "viewDescendants",
  "viewTimeline",
  "back",
]);

/** Icons whose dots must render as dots: round caps on a zero-length segment. */
const ROUND: ReadonlySet<IconName> = new Set([
  "more",
  "settings",
  "chevronDown",
  "check",
  "person",
  "back",
  "export",
]);

/** A 16px stroke icon (or `size` px). Decorative: the button around it carries the label. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className={MIRRORED.has(name) ? "icon icon--mirror" : "icon"}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 2.5 : 1.5}
      strokeLinecap={ROUND.has(name) ? "round" : "square"}
      strokeLinejoin={ROUND.has(name) ? "round" : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
