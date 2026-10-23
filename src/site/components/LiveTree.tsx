// Markup for a tree that JavaScript moves between engine frames. Cards sit in layout pixels
// inside a "world"; the driver sets their transforms and the world's camera. The first render
// already shows `initial`, so the server HTML and the first client frame agree.

import type { CSSProperties, ReactNode } from "react";

import { type Blend, type Frame } from "@/site/sample/frames";

import { CardBody, cardClass, edgeClass, edgePath } from "./Tree";

export function LiveTree({
  all,
  initial,
  className = "",
  rows = 0,
  children,
}: {
  /** Every card and edge that will ever appear (the last frame). */
  all: Frame;
  initial: Blend;
  className?: string;
  /** How many ruler numerals to prepare (0 for none). */
  rows?: number;
  /** Extra world-space elements, such as the drag demo's drop marker. */
  children?: ReactNode;
}) {
  const shown = new Map(initial.cards.map((c) => [c.key, c]));
  const drawn = new Map(initial.edges.map((e) => [e.id, e]));
  return (
    <div className={`live ${className}`} dir="ltr">
      {rows > 0 && (
        <ol className="live__ruler" aria-hidden="true">
          {Array.from({ length: rows }, (_, row) => (
            <li key={row} className="ruler__mark" data-row={row} style={{ opacity: 0 }}>
              {["I", "II", "III", "IV", "V", "VI"][row]}
            </li>
          ))}
        </ol>
      )}
      <div className="live__view" data-view>
        <div className="live__world" data-world>
          <svg
            className="tree__edges"
            // A 1 px box drawn with overflow visible: the paths live in world pixels, and the
            // box never pokes out of the clipped view.
            width={1}
            height={1}
            aria-hidden="true"
            focusable="false"
          >
            {all.edges.map((edge) => {
              const now = drawn.get(edge.id);
              return (
                <path
                  key={edge.id}
                  data-edge={edge.id}
                  className={edgeClass(now ?? edge)}
                  d={now ? edgePath(now.points, now.kind, now.status) : ""}
                  style={{ opacity: now ? now.draw : 0 }}
                />
              );
            })}
          </svg>
          {all.cards.map((card) => {
            const now = shown.get(card.key);
            const style: CSSProperties = now
              ? { transform: `translate(${now.x}px, ${now.y}px)`, opacity: now.opacity }
              : { opacity: 0, visibility: "hidden" };
            return (
              <div
                key={card.key}
                data-card={card.key}
                className={cardClass(card.key, "card--live")}
                style={style}
                aria-hidden="true"
              >
                <CardBody personKey={card.key} />
              </div>
            );
          })}
          {children}
        </div>
      </div>
    </div>
  );
}
