import { useTranslation } from "react-i18next";

import { personLabel } from "@/ui/cards/describe";
import { useEditor } from "@/ui/store/useEditor";

import { PopupMenu } from "./PopupMenu";

type Point = [number, number];

export type CardMenuProps = {
  personId: string;
  /** Client px where the menu opens. */
  at: Point;
  /** "Move to…": choose the person to link to with the search picker (FR-D7). */
  onMoveTo: (personId: string) => void;
  onClose: () => void;
};

/** A card's context menu (right-click, touch long-press, Shift+F10). */
export function CardMenu({ personId, at, onMoveTo, onClose }: CardMenuProps) {
  const { t } = useTranslation();
  const person = useEditor((s) => s.doc?.persons[personId]);
  if (!person) return null;
  return (
    <PopupMenu
      at={at}
      label={t("dnd.cardMenu", { name: personLabel(person, t) })}
      onClose={onClose}
    >
      <button
        type="button"
        role="menuitem"
        className="dnd-menu__item"
        onClick={() => onMoveTo(personId)}
      >
        {t("dnd.moveTo")}
      </button>
    </PopupMenu>
  );
}
