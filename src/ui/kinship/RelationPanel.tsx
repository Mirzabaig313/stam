import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/ui/app/Icon";
import { personLabel } from "@/ui/panels/fields";
import { SearchBox } from "@/ui/panels/SearchBox";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import type { SentencePart } from "./explain";
import type { RelationState } from "./useRelation";

type Slot = "aId" | "bId";

/** The closest relationships shown at once; the rest wait behind "N more distant…". */
export const SHOWN_RESULTS = 3;

/**
 * "How are we related?": two people, and every way the first is related to the second, with the
 * Urdu term where there is one. A side panel, not a dialog: the path stays visible on the canvas.
 */
export function RelationPanel({ relation }: { relation: RelationState }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const [picking, setPicking] = useState<Slot | null>(null);
  /** The pair whose distant relationships are unfolded; another pair folds them again. */
  const [unfolded, setUnfolded] = useState<string | null>(null);
  const { pair, explanation, failed } = relation;
  if (!pair || !doc) return null;

  const nameOf = (id: string | null) => {
    const person = id === null ? undefined : doc.persons[id];
    return person ? personLabel(person, t("panel.unnamed")) : null;
  };
  const row = (slot: Slot, label: string) => {
    const name = nameOf(pair[slot]);
    return (
      <div className="relation-row">
        <span className="field-label">{label}</span>
        <button
          type="button"
          className="button relation-pick"
          onClick={() => setPicking(slot)}
          aria-label={
            name === null ? `${label}: ${t("kinship.panel.choose")}` : `${label}: ${name}`
          }
        >
          {name === null ? t("kinship.panel.choose") : <bdi>{name}</bdi>}
        </button>
      </div>
    );
  };

  const sameOrEmpty = pair.aId !== null && pair.aId === pair.bId;
  const pairKey = explanation ? `${explanation.aId}|${explanation.bId}` : null;
  const results = explanation?.results ?? [];
  const showAll = unfolded !== null && unfolded === pairKey;
  const shown = showAll ? results : results.slice(0, SHOWN_RESULTS);
  const hidden = results.length - shown.length;
  const sentence = (parts: SentencePart[]) =>
    parts.map((part, i) =>
      typeof part === "string" ? (
        part
      ) : (
        // oxlint-disable-next-line react/no-array-index-key
        <bdi key={i}>{nameOf(part.name === "a" ? explanation!.aId : explanation!.bId)}</bdi>
      ),
    );
  return (
    <aside className="person-panel relation-panel" aria-label={t("kinship.panel.title")}>
      <div className="panel-header">
        <h2 className="panel-title">{t("kinship.panel.title")}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t("kinship.panel.close")}
          onClick={() => store.getState().closeRelation()}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="panel-body">
        {row("aId", t("kinship.panel.personA"))}
        {row("bId", t("kinship.panel.personB"))}
        <button
          type="button"
          className="button"
          disabled={pair.aId === null && pair.bId === null}
          onClick={() => {
            store.getState().openRelation(pair.bId, pair.aId);
          }}
        >
          {t("kinship.panel.swap")}
        </button>

        {explanation === null && !failed && (
          <p className="muted">{t(sameOrEmpty ? "kinship.panel.same" : "kinship.panel.pickTwo")}</p>
        )}
        {failed && (
          <p className="notice" role="alert">
            {t("kinship.panel.error")}
          </p>
        )}
        <div className="relation-answer" aria-live="polite">
          {explanation !== null && explanation.results.length === 0 && (
            <output className="relation-none">
              {t("kinship.panel.none", {
                a: nameOf(explanation.aId),
                b: nameOf(explanation.bId),
              })}
            </output>
          )}
          {explanation !== null && explanation.results.length > 0 && (
            <ul className="relation-results" aria-label={t("kinship.panel.results")}>
              {shown.map((result, index) => (
                <li key={`${index}:${result.text}`} className="relation-result">
                  <p className="relation-sentence">{sentence(result.parts)}</p>
                  {result.urdu !== null && (
                    <p className="muted relation-urdu">
                      {t("kinship.panel.urdu")}:{" "}
                      <bdi lang="ur" dir="rtl" className="relation-urdu-term">
                        {result.urdu}
                      </bdi>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {hidden > 0 && (
            <button type="button" className="button" onClick={() => setUnfolded(pairKey)}>
              {t("kinship.panel.more", { count: hidden })}
            </button>
          )}
        </div>
      </div>
      {picking !== null && (
        <SearchBox
          mode="picker"
          onPick={(id) => {
            store.getState().setRelation({ [picking]: id });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </aside>
  );
}
