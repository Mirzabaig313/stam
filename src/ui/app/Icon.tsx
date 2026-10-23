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
} as const;

export type IconName = keyof typeof PATHS;

/** A 16px stroke icon. Decorative: the button around it carries the label. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
