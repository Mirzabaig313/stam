import type { ReactNode } from "react";

import { cx } from "./cx";

export type EmptyStateProps = {
  /** An invitation, in the display voice: "Start your family tree". */
  title: ReactNode;
  /** One or two sentences: what will be here and how to begin. */
  children?: ReactNode;
  /** The way forward: usually one primary Button, sometimes a secondary one. */
  actions?: ReactNode;
  /** The album drawing above the title. */
  art?: boolean;
  align?: "center" | "start";
  /** The heading's level in the page outline. */
  level?: 2 | 3;
  className?: string;
};

/** What a page shows before there is anything on it: a welcome and a way to begin. */
export function EmptyState({
  title,
  children,
  actions,
  art = true,
  align = "center",
  level = 2,
  className,
}: EmptyStateProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={cx("empty-state", align === "start" && "empty-state--start", className)}>
      {art && <AlbumArt />}
      <Heading className="display empty-state__title">{title}</Heading>
      {children && <div className="empty-state__body">{children}</div>}
      {actions && <div className="empty-state__actions">{actions}</div>}
    </section>
  );
}

/** Two photo corners, at the top-left and bottom-right of a w × h photo at (x, y). */
function corners(x: number, y: number, w: number, h: number) {
  const s = 7;
  return (
    <>
      <path className="album-art__corner" d={`M${x - 2} ${y - 2}h${s + 2}l-${s + 2} ${s + 2}z`} />
      <path
        className="album-art__corner"
        d={`M${x + w + 2} ${y + h + 2}h-${s + 2}l${s + 2}-${s + 2}z`}
      />
    </>
  );
}

/** Three photographs on an album page, held by their corners. Decorative. */
export function AlbumArt({ className }: { className?: string }) {
  return (
    <svg
      className={cx("empty-state__art album-art", className)}
      viewBox="0 0 132 96"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="rotate(-8 34 52)">
        <rect
          className="album-art__photo album-art__photo--0"
          x="10"
          y="30"
          width="46"
          height="54"
          rx="4"
        />
        <circle className="album-art__figure" cx="33" cy="50" r="8" />
        <path className="album-art__figure" d="M19 78c2-10 8-14 14-14s12 4 14 14z" />
        {corners(10, 30, 46, 54)}
      </g>
      <g transform="rotate(7 98 50)">
        <rect
          className="album-art__photo album-art__photo--1"
          x="76"
          y="24"
          width="46"
          height="54"
          rx="4"
        />
        <circle className="album-art__figure" cx="99" cy="44" r="8" />
        <path className="album-art__figure" d="M85 72c2-10 8-14 14-14s12 4 14 14z" />
        {corners(76, 24, 46, 54)}
      </g>
      <g>
        <rect
          className="album-art__photo album-art__photo--2"
          x="42"
          y="10"
          width="48"
          height="58"
          rx="4"
        />
        <circle className="album-art__figure" cx="66" cy="32" r="9" />
        <path className="album-art__figure" d="M51 62c2-11 9-15 15-15s13 4 15 15z" />
        {corners(42, 10, 48, 58)}
      </g>
    </svg>
  );
}
