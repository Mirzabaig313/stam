import { useTranslation } from "react-i18next";

import type { FuzzyDate } from "@/core/dates/fuzzy";
import { parentUnionOf, topmostAncestor } from "@/core/model/tree";
import type { Gender, Person } from "@/core/model/types";
import { Icon } from "@/ui/app/Icon";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { DateField } from "./DateField";
import { personLabel, TextField } from "./fields";
import { PersonPhoto } from "./PersonPhoto";
import { PersonUnions } from "./PersonUnions";

type Event = { date?: FuzzyDate; place?: string };

/** `event` with one part replaced; undefined when nothing is left (so the person has no such event). */
function withPart<K extends keyof Event>(
  event: Event | undefined,
  key: K,
  value: Event[K],
): Event | undefined {
  const next: Event = { ...event, [key]: value };
  if (next.date === undefined) delete next.date;
  if (next.place === undefined) delete next.place;
  return next.date === undefined && next.place === undefined ? undefined : next;
}

const GENDERS: Gender[] = ["male", "female"];

export type PersonPanelProps = {
  personId: string;
  /** Opens the delete dialog; the panel itself never deletes. */
  onRequestDelete: (personId: string) => void;
  /** The editor is read-only: every field and action in the body is inert. */
  readOnly?: boolean;
};

/**
 * Everything about the selected person. Each field is one undo step, committed on blur or
 * Enter. The parent keys it by `personId`, so switching person starts every field afresh.
 */
export function PersonPanel({ personId, onRequestDelete, readOnly = false }: PersonPanelProps) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const person = useEditor((s) => s.doc?.persons[personId]);
  const doc = useEditor((s) => s.doc);
  const layout = useEditor((s) => s.layout);
  if (!person || !doc) return null;

  const isRoot = doc.rootPersonId === personId;
  const primary = layout?.nodes.find((n) => n.nodeId === layout.primaryNode[personId]);
  const showViewFamily = primary?.kind === "spouse" && parentUnionOf(doc, personId) !== undefined;

  function update(patch: Partial<Omit<Person, "id">>, label = "Edit person") {
    store.getState().dispatch({ type: "updatePerson", personId, patch }, label);
  }

  /** An optional text field: blank removes it. */
  const optional = (key: "nickname" | "nativeName" | "notes") => (next: string) =>
    update({ [key]: next === "" ? undefined : next });

  return (
    <aside className="person-panel" aria-label={t("panel.label")}>
      <header className="panel-header">
        <h2 className="panel-title">
          <bdi>{personLabel(person, t("panel.unnamed"))}</bdi>
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t("panel.close")}
          title={t("panel.close")}
          onClick={() => store.getState().select(null)}
        >
          <Icon name="close" />
        </button>
      </header>

      {/* Read-only (the tree changed in another tab): the details can be read, not changed. */}
      <div className="panel-body" inert={readOnly}>
        <PersonPhoto person={person} />

        <div className="panel-row">
          <TextField
            label={t("panel.firstName")}
            value={person.firstName}
            onCommit={(firstName) => update({ firstName })}
          />
          <TextField
            label={t("panel.lastName")}
            value={person.lastName}
            onCommit={(lastName) => update({ lastName })}
          />
        </div>
        <TextField
          label={t("panel.nickname")}
          value={person.nickname ?? ""}
          onCommit={optional("nickname")}
        />
        <TextField
          label={t("panel.nativeName")}
          dir="auto"
          value={person.nativeName ?? ""}
          onCommit={optional("nativeName")}
        />

        <fieldset className="panel-field toggle-set">
          <legend className="field-label">{t("panel.gender.label")}</legend>
          <div className="toggle">
            {GENDERS.map((gender) => (
              <button
                key={gender}
                type="button"
                className="button"
                aria-pressed={person.gender === gender}
                onClick={() => {
                  if (person.gender !== gender) update({ gender });
                }}
              >
                {t(`panel.gender.${gender}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="check">
          <input
            type="checkbox"
            checked={person.isLiving}
            onChange={(event) => update({ isLiving: event.currentTarget.checked })}
          />
          {t("panel.living")}
        </label>

        <div className="panel-row">
          <DateField
            label={t("panel.birthDate")}
            value={person.birth?.date}
            onCommit={(date) => update({ birth: withPart(person.birth, "date", date) })}
          />
          <TextField
            label={t("panel.birthPlace")}
            value={person.birth?.place ?? ""}
            onCommit={(place) =>
              update({ birth: withPart(person.birth, "place", place === "" ? undefined : place) })
            }
          />
        </div>
        <div className="panel-row">
          <DateField
            label={t("panel.deathDate")}
            value={person.death?.date}
            onCommit={(date) =>
              // Entering a death date means the person is no longer living.
              update({
                death: withPart(person.death, "date", date),
                ...(date !== undefined && person.isLiving ? { isLiving: false } : {}),
              })
            }
          />
          <TextField
            label={t("panel.deathPlace")}
            value={person.death?.place ?? ""}
            onCommit={(place) =>
              update({ death: withPart(person.death, "place", place === "" ? undefined : place) })
            }
          />
        </div>

        <TextField
          label={t("panel.notes")}
          multiline
          value={person.notes ?? ""}
          onCommit={optional("notes")}
        />

        <PersonUnions personId={personId} />
      </div>

      <footer className="panel-actions">
        <button
          type="button"
          className="button"
          disabled={isRoot || readOnly}
          onClick={() => {
            store.getState().dispatch({ type: "setRoot", personId }, "Set as root");
            store.getState().setViewRoot(null);
          }}
        >
          {t("panel.setRoot")}
        </button>
        {showViewFamily && (
          <button
            type="button"
            className="button"
            onClick={() => store.getState().setViewRoot(topmostAncestor(doc, personId))}
          >
            {t("panel.viewFamily")}
          </button>
        )}
        <button
          type="button"
          className="button button-danger"
          disabled={readOnly}
          onClick={() => onRequestDelete(personId)}
        >
          {t("panel.deleteButton")}
        </button>
      </footer>
    </aside>
  );
}
