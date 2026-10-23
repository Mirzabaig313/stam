import "./handles.css";

import { type KeyboardEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { unionsOf } from "@/core/model/tree";
import { useEditor } from "@/ui/store/useEditor";

import { personLabel } from "./describe";

export type UnionChooserProps = {
  personId: string;
  /** The unions to offer, in this order; all of the person's unions when absent. */
  unionIds?: string[];
  onChoose: (unionId: string) => void;
  onCancel: () => void;
};

/**
 * "Child of which family?" (FR-E4, FR-D3): one button per union of `personId`, named by the
 * partner, or "No partner" for a union of one. Esc or Cancel cancels; arrows move between the
 * options, and the first has the focus when it opens.
 */
export function UnionChooser({ personId, unionIds, onChoose, onCancel }: UnionChooserProps) {
  const { t } = useTranslation();
  const doc = useEditor((s) => s.doc);
  const listRef = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    listRef.current?.querySelector("button")?.focus();
  }, []);

  if (!doc) return null;
  const person = doc.persons[personId];
  const unions = unionIds
    ? unionIds.flatMap((id) => (doc.unions[id] ? [doc.unions[id]] : []))
    : unionsOf(doc, personId);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    e.stopPropagation();
    const buttons = [...(listRef.current?.querySelectorAll("button") ?? [])];
    const at = buttons.indexOf(e.currentTarget);
    const step = e.key === "ArrowDown" ? 1 : -1;
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <fieldset
      ref={listRef}
      className="union-chooser"
      aria-label={t("handles.unionChooser.label", { name: person ? personLabel(person, t) : "" })}
    >
      <legend className="union-chooser__title">{t("handles.unionChooser.title")}</legend>
      {unions.map((union) => {
        const partnerId = union.partners.find((id) => id !== personId);
        const partner = partnerId ? doc.persons[partnerId] : undefined;
        return (
          <button
            key={union.id}
            type="button"
            className="union-chooser__option"
            onClick={() => onChoose(union.id)}
            onKeyDown={onKeyDown}
          >
            {partner ? <bdi>{personLabel(partner, t)}</bdi> : t("handles.unionChooser.noPartner")}
          </button>
        );
      })}
      <button
        type="button"
        className="union-chooser__cancel"
        onClick={onCancel}
        onKeyDown={onKeyDown}
      >
        {t("handles.unionChooser.cancel")}
      </button>
    </fieldset>
  );
}
