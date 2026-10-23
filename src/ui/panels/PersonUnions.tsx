import { useTranslation } from "react-i18next";

import { unionsOf } from "@/core/model/tree";
import type { ChildType, Person, Union, UnionStatus } from "@/core/model/types";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { DateField } from "./DateField";
import { personLabel } from "./fields";

const STATUSES: UnionStatus[] = [
  "married",
  "partner",
  "engaged",
  "divorced",
  "separated",
  "widowed",
];
const CHILD_TYPES: ChildType[] = ["biological", "adopted", "step", "foster"];

/** A person's name as a button that selects them. */
function PersonLink({ person }: { person: Person }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  return (
    <button
      type="button"
      className="link-button"
      onClick={() => store.getState().select(person.id)}
    >
      <bdi>{personLabel(person, t("panel.unnamed"))}</bdi>
    </button>
  );
}

function UnionBlock({ union, personId }: { union: Union; personId: string }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const persons = useEditor((s) => s.doc?.persons);
  const partner = union.partners.find((id) => id !== personId);
  const partnerPerson = partner === undefined ? undefined : persons?.[partner];

  function update(patch: Partial<Pick<Union, "status" | "start" | "end">>) {
    store
      .getState()
      .dispatch({ type: "updateUnion", unionId: union.id, patch }, "Edit partnership");
  }

  return (
    <fieldset className="panel-union">
      <legend>
        {t("panel.partner")}{" "}
        {partnerPerson ? <PersonLink person={partnerPerson} /> : t("panel.noPartner")}
      </legend>

      <div className="panel-field">
        <label className="field-label" htmlFor={`status-${union.id}`}>
          {t("panel.status.label")}
        </label>
        <select
          id={`status-${union.id}`}
          className="field"
          value={union.status}
          onChange={(event) => update({ status: event.currentTarget.value as UnionStatus })}
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`panel.status.${status}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="panel-row">
        <DateField
          label={t("panel.startDate")}
          value={union.start}
          onCommit={(start) => update({ start })}
        />
        <DateField
          label={t("panel.endDate")}
          value={union.end}
          onCommit={(end) => update({ end })}
        />
      </div>

      {union.children.length > 0 && (
        <ul className="panel-children" aria-label={t("panel.children")}>
          {union.children.map((child) => {
            const childPerson = persons?.[child.personId];
            if (!childPerson) return null;
            const name = personLabel(childPerson, t("panel.unnamed"));
            return (
              <li key={child.personId}>
                <PersonLink person={childPerson} />
                <select
                  className="field"
                  aria-label={t("panel.childTypeAria", { name })}
                  value={child.type}
                  onChange={(event) =>
                    store.getState().dispatch(
                      {
                        type: "setChildType",
                        unionId: union.id,
                        personId: child.personId,
                        childType: event.currentTarget.value as ChildType,
                      },
                      "Change child type",
                    )
                  }
                >
                  {CHILD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`panel.childType.${type}`)}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

/** The person's partnerships, each with its status, dates and children. */
export function PersonUnions({ personId }: { personId: string }) {
  const doc = useEditor((s) => s.doc);
  if (!doc) return null;
  const unions = unionsOf(doc, personId);
  return (
    <>
      {unions.map((union) => (
        <UnionBlock key={union.id} union={union} personId={personId} />
      ))}
    </>
  );
}
