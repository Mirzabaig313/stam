import "./dnd.css";

import { useTranslation } from "react-i18next";

import { personLabel } from "@/ui/cards/describe";
import { lifeLine } from "@/ui/cards/years";
import { useEditor } from "@/ui/store/useEditor";

import type { DragSession } from "./useDrag";

/**
 * The card under the pointer while dragging: a lighter copy at the canvas zoom, held where it was
 * grabbed. Over a target where nothing is allowed it says so.
 */
export function DragGhost({ session, scale }: { session: DragSession; scale: number }) {
  const { t } = useTranslation();
  const person = useEditor((s) => s.doc?.persons[session.node.personId]);
  if (!person) return null;
  const { target, pointer, grab } = session;
  const blocked = target.kind === "person" && target.actions.length === 0;
  const years = lifeLine(person, t);
  const x = pointer[0] - grab[0];
  const y = pointer[1] - grab[1];
  return (
    <div
      className="dnd-ghost"
      data-blocked={blocked ? "true" : undefined}
      aria-hidden="true"
      // Pointer positions are physical px: placed with a transform from the physical top-left.
      style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}
    >
      <bdi className="dnd-ghost__name">{personLabel(person, t)}</bdi>
      {years && <span className="dnd-ghost__years">{years}</span>}
      {blocked && <span className="dnd-ghost__blocked">{t("dnd.notAllowed")}</span>}
    </div>
  );
}
