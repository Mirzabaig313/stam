import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { ChildType, Union, UnionStatus } from "@/core/model/types";
import { formatDate } from "@/i18n/format";
import { Select } from "@/ui/design/Select";
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

/** "Married", "Married, 1990", "Divorced, 1975 – 1988": a partnership in one short line. */
export function unionSummary(union: Union, language: string, t: TFunction): string {
  const status = t(`panel.status.${union.status}`);
  const year = (d: Union["start"]) =>
    d?.year === undefined
      ? ""
      : formatDate({ ...d, month: undefined, day: undefined }, language, t);
  const start = year(union.start);
  const end = year(union.end);
  if (start && end) return t("panel.union.span", { status, start, end });
  if (start || end) return t("panel.union.since", { status, date: start || end });
  return status;
}

/**
 * A partnership's details, opened from its spouse line: the status, the start and end dates, and
 * how each of its children is linked. Each change is one undo step.
 */
export function UnionEditor({ union, partnerName }: { union: Union; partnerName?: string }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const persons = useEditor((s) => s.doc?.persons);

  function update(patch: Partial<Pick<Union, "status" | "start" | "end">>) {
    store
      .getState()
      .dispatch({ type: "updateUnion", unionId: union.id, patch }, "Edit partnership");
  }

  return (
    <fieldset className="union-editor">
      <legend className="visually-hidden">
        {partnerName ? t("panel.union.with", { name: partnerName }) : t("panel.union.alone")}
      </legend>
      <Select
        label={t("panel.status.label")}
        value={union.status}
        options={STATUSES.map((status) => ({ value: status, label: t(`panel.status.${status}`) }))}
        onChange={(event) => update({ status: event.currentTarget.value as UnionStatus })}
      />
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
        <ul className="union-editor__children" aria-label={t("panel.children")}>
          {union.children.map((child) => {
            const childPerson = persons?.[child.personId];
            if (!childPerson) return null;
            const name = personLabel(childPerson, t("panel.unnamed"));
            return (
              <li key={child.personId}>
                <bdi className="union-editor__child">{name}</bdi>
                <span className="select">
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
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
