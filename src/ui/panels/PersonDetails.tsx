import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { FuzzyDate } from "@/core/dates/fuzzy";
import type { Gender, Person } from "@/core/model/types";
import { formatDate } from "@/i18n/format";
import { Icon } from "@/ui/app/Icon";
import { Segmented } from "@/ui/design/Segmented";

import { DateField } from "./DateField";
import { TextField } from "./fields";

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

type Field =
  "birthDate" | "birthPlace" | "deathDate" | "deathPlace" | "nickname" | "nativeName" | "notes";

/** Which optional fields the person has filled in. */
function filledFields(person: Person): Set<Field> {
  const filled = new Set<Field>();
  if (person.birth?.date !== undefined) filled.add("birthDate");
  if (person.birth?.place) filled.add("birthPlace");
  if (person.death?.date !== undefined) filled.add("deathDate");
  if (person.death?.place) filled.add("deathPlace");
  if (person.nickname) filled.add("nickname");
  if (person.nativeName) filled.add("nativeName");
  if (person.notes) filled.add("notes");
  return filled;
}

type PersonDetailsProps = {
  person: Person;
  readOnly: boolean;
  update: (patch: Partial<Omit<Person, "id">>) => void;
};

/** "+ Birth date": reveals a field that is still empty. */
function AddField({ label, name, onClick }: { label: string; name: string; onClick: () => void }) {
  return (
    <button type="button" className="add-pill" aria-label={label} onClick={onClick}>
      <Icon name="plus" size={14} />
      {name}
    </button>
  );
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="detail-group">
      <legend className="family-group__title">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Read-only details: the filled rows as a description list. */
function DetailList({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="details-list">
      {rows
        .filter(([, value]) => value !== "")
        .map(([label, value]) => (
          <div key={label} className="details-list__row">
            <dt>{label}</dt>
            <dd>
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
    </dl>
  );
}

/** Notes: a short preview that opens to the whole text (and, when editable, the field). */
function Notes({
  value,
  readOnly,
  startOpen,
  onCommit,
}: {
  value: string;
  readOnly: boolean;
  startOpen: boolean;
  onCommit: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="details-notes" data-open={open || undefined}>
      <div className="details-notes__head">
        <p className="family-group__title" aria-hidden={open && !readOnly ? true : undefined}>
          {t("panel.notes")}
        </p>
        {value !== "" && (
          <button
            type="button"
            className="details-notes__toggle"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? t("panel.notesHide") : t("panel.notesShow")}
            <Icon name="chevronDown" size={14} />
          </button>
        )}
      </div>
      {open && !readOnly ? (
        <TextField label={t("panel.notes")} multiline value={value} onCommit={onCommit} />
      ) : (
        <p
          className={
            open ? "details-notes__text" : "details-notes__text details-notes__text--clamped"
          }
        >
          <bdi>{value}</bdi>
        </p>
      )}
    </div>
  );
}

/**
 * The person's details, with progressive disclosure: filled fields only, grouped as Life and
 * Names, and "+" buttons that reveal the rest. Read-only, the filled ones read as text.
 */
export function PersonDetails({ person, readOnly, update }: PersonDetailsProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<Field>>(new Set());
  /** The field just revealed, to focus once it is drawn. */
  const focusNext = useRef<Field | null>(null);

  useEffect(() => {
    const field = focusNext.current;
    if (field === null) return;
    focusNext.current = null;
    root.current
      ?.querySelector<HTMLElement>(`[data-field="${field}"] :is(input, textarea)`)
      ?.focus();
  });

  const filled = filledFields(person);
  const shows = (field: Field) => filled.has(field) || revealed.has(field);
  const reveal = (...fields: Field[]) => {
    focusNext.current = fields[0]!;
    setRevealed((r) => new Set([...r, ...fields]));
  };
  /** An optional text field: blank removes it. */
  const optional = (key: "nickname" | "nativeName" | "notes") => (next: string) =>
    update({ [key]: next === "" ? undefined : next });

  const heading = (
    <h3 id={titleId} className="panel-section__title">
      {t("panel.details.title")}
    </h3>
  );

  if (readOnly) {
    const date = (d: FuzzyDate | undefined) => (d ? formatDate(d, i18n.language, t) : "");
    const life: [string, string][] = [
      [t("panel.birthDate"), date(person.birth?.date)],
      [t("panel.birthPlace"), person.birth?.place ?? ""],
      [t("panel.deathDate"), date(person.death?.date)],
      [t("panel.deathPlace"), person.death?.place ?? ""],
    ];
    const names: [string, string][] = [
      [t("panel.firstName"), person.firstName],
      [t("panel.lastName"), person.lastName],
      [t("panel.nickname"), person.nickname ?? ""],
      [t("panel.nativeName"), person.nativeName ?? ""],
    ];
    const hasLife = life.some(([, v]) => v !== "");
    const hasNames = names.some(([, v]) => v !== "");
    if (!hasLife && !hasNames && !person.notes) return null;
    return (
      <section ref={root} className="panel-section" aria-labelledby={titleId}>
        {heading}
        {hasLife && (
          <DetailGroup title={t("panel.details.life")}>
            <DetailList rows={life} />
          </DetailGroup>
        )}
        {hasNames && (
          <DetailGroup title={t("panel.details.names")}>
            <DetailList rows={names} />
          </DetailGroup>
        )}
        {person.notes && (
          <Notes value={person.notes} readOnly startOpen={false} onCommit={() => {}} />
        )}
      </section>
    );
  }

  const field = (key: Field, node: ReactNode) => (
    <div key={key} data-field={key}>
      {node}
    </div>
  );

  const birthFields = [
    shows("birthDate") &&
      field(
        "birthDate",
        <DateField
          label={t("panel.birthDate")}
          value={person.birth?.date}
          onCommit={(d) => update({ birth: withPart(person.birth, "date", d) })}
        />,
      ),
    shows("birthPlace") &&
      field(
        "birthPlace",
        <TextField
          label={t("panel.birthPlace")}
          value={person.birth?.place ?? ""}
          onCommit={(place) =>
            update({ birth: withPart(person.birth, "place", place === "" ? undefined : place) })
          }
        />,
      ),
  ].filter(Boolean);

  const deathFields = [
    shows("deathDate") &&
      field(
        "deathDate",
        <DateField
          label={t("panel.deathDate")}
          value={person.death?.date}
          onCommit={(d) =>
            // Entering a death date means the person is no longer living.
            update({
              death: withPart(person.death, "date", d),
              ...(d !== undefined && person.isLiving ? { isLiving: false } : {}),
            })
          }
        />,
      ),
    shows("deathPlace") &&
      field(
        "deathPlace",
        <TextField
          label={t("panel.deathPlace")}
          value={person.death?.place ?? ""}
          onCommit={(place) =>
            update({ death: withPart(person.death, "place", place === "" ? undefined : place) })
          }
        />,
      ),
  ].filter(Boolean);

  const lifeAdds = [
    !shows("birthDate") && (
      <AddField
        key="birthDate"
        label={t("panel.add.birthDate")}
        name={t("panel.birthDate")}
        onClick={() => reveal("birthDate")}
      />
    ),
    !shows("birthPlace") && (
      <AddField
        key="birthPlace"
        label={t("panel.add.birthPlace")}
        name={t("panel.birthPlace")}
        onClick={() => reveal("birthPlace")}
      />
    ),
    !shows("deathDate") && !shows("deathPlace") && (
      <AddField
        key="death"
        label={t("panel.add.death")}
        name={t("panel.add.deathLabel")}
        onClick={() => reveal("deathDate", "deathPlace")}
      />
    ),
  ].filter(Boolean);

  const nameAdds = [
    !shows("nickname") && (
      <AddField
        key="nickname"
        label={t("panel.add.nickname")}
        name={t("panel.nickname")}
        onClick={() => reveal("nickname")}
      />
    ),
    !shows("nativeName") && (
      <AddField
        key="nativeName"
        label={t("panel.add.nativeName")}
        name={t("panel.nativeName")}
        onClick={() => reveal("nativeName")}
      />
    ),
    !shows("notes") && (
      <AddField
        key="notes"
        label={t("panel.add.notes")}
        name={t("panel.notes")}
        onClick={() => reveal("notes")}
      />
    ),
  ].filter(Boolean);

  return (
    <section ref={root} className="panel-section" aria-labelledby={titleId}>
      {heading}

      <DetailGroup title={t("panel.details.life")}>
        <div className="details-about">
          <Segmented
            label={t("panel.gender.label")}
            options={GENDERS.map((g) => ({ value: g, label: t(`panel.gender.${g}`) }))}
            value={person.gender}
            onChange={(gender) => {
              if (person.gender !== gender) update({ gender });
            }}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={person.isLiving}
              onChange={(event) => update({ isLiving: event.currentTarget.checked })}
            />
            {t("panel.living")}
          </label>
        </div>
        {birthFields.length > 0 && <div className="details-pair">{birthFields}</div>}
        {deathFields.length > 0 && <div className="details-pair">{deathFields}</div>}
        {lifeAdds.length > 0 && <div className="add-row">{lifeAdds}</div>}
      </DetailGroup>

      <DetailGroup title={t("panel.details.names")}>
        <div className="details-pair">
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
        {shows("nickname") &&
          field(
            "nickname",
            <TextField
              label={t("panel.nickname")}
              value={person.nickname ?? ""}
              onCommit={optional("nickname")}
            />,
          )}
        {shows("nativeName") &&
          field(
            "nativeName",
            <TextField
              label={t("panel.nativeName")}
              dir="auto"
              value={person.nativeName ?? ""}
              onCommit={optional("nativeName")}
            />,
          )}
        {nameAdds.length > 0 && <div className="add-row">{nameAdds}</div>}
      </DetailGroup>

      {shows("notes") &&
        field(
          "notes",
          <Notes
            value={person.notes ?? ""}
            readOnly={false}
            startOpen={!filled.has("notes")}
            onCommit={optional("notes")}
          />,
        )}
    </section>
  );
}
