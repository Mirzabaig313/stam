import { useState } from "react";
import { useTranslation } from "react-i18next";

import { parentUnionOf, topmostAncestor } from "@/core/model/tree";
import type { Person } from "@/core/model/types";
import { lifeLine } from "@/ui/cards/years";
import { Button } from "@/ui/design/Button";
import { Chip } from "@/ui/design/Chip";
import { Sheet } from "@/ui/design/Sheet";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { lifeSummary } from "./family";
import { FamilySection } from "./FamilySection";
import { personLabel } from "./fields";
import { PersonDetails } from "./PersonDetails";
import { PersonPhoto } from "./PersonPhoto";

export type PersonPanelProps = {
  personId: string;
  /** Opens the delete dialog; the panel itself never deletes. */
  onRequestDelete: (personId: string) => void;
  /**
   * Shows a relative picked in the Family section: selects them and brings them into view. Without
   * it, picking a relative only selects them.
   */
  onShowPerson?: (personId: string) => void;
  /** The editor is read-only (fan, timeline, a locked tree): the profile reads, nothing edits. */
  readOnly?: boolean;
};

/** Under the name: the years, a place, the native name, and chips for living and gender. */
function ProfileSummary({ person }: { person: Person }) {
  const { t, i18n } = useTranslation();
  // The years are the cards' own life line ("1820 – 1900 · 80 yrs", "b. 1953 · 73 yrs").
  const { place } = lifeSummary(person, i18n.language, t);
  const years = lifeLine(person, t, undefined, i18n.dir(i18n.language));
  const deceased = !person.isLiving || person.death !== undefined;
  return (
    <div className="profile-summary">
      {person.nativeName && (
        <p className="profile-summary__native">
          <bdi>{person.nativeName}</bdi>
        </p>
      )}
      {(years || place) && (
        <p className="profile-summary__life">
          {years && (
            <span className="profile-summary__years years">
              <bdi>{years}</bdi>
            </span>
          )}
          {place && (
            <span className="profile-summary__place">
              <bdi>{place}</bdi>
            </span>
          )}
        </p>
      )}
      <p className="profile-summary__chips">
        <Chip className="profile-chip" {...(deceased ? {} : { hue: 1 })}>
          {deceased ? t("panel.deceased") : t("panel.living")}
        </Chip>
        <Chip className="profile-chip">{t(`panel.gender.${person.gender}`)}</Chip>
      </p>
    </div>
  );
}

/**
 * The selected person's profile: a portrait and the name, their family as chips, and their
 * details, revealed field by field. Each edit is one undo step, committed on blur or Enter. The
 * sheet stays open while the person changes (no slide-in for each relative visited); everything
 * inside is keyed by `personId`, so switching person starts every field afresh.
 */
export function PersonPanel({
  personId,
  onRequestDelete,
  onShowPerson,
  readOnly = false,
}: PersonPanelProps) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const person = useEditor((s) => s.doc?.persons[personId]);
  const doc = useEditor((s) => s.doc);
  const layout = useEditor((s) => s.layout);
  /** Whose photo could not be used: the message belongs to that person only. */
  const [photoFailedFor, setPhotoFailedFor] = useState<string | null>(null);
  if (!person || !doc) return null;

  const isRoot = doc.rootPersonId === personId;
  const primary = layout?.nodes.find((n) => n.nodeId === layout.primaryNode[personId]);
  const showViewFamily = primary?.kind === "spouse" && parentUnionOf(doc, personId) !== undefined;
  const show = onShowPerson ?? ((id: string) => store.getState().select(id));

  function update(patch: Partial<Omit<Person, "id">>) {
    store.getState().dispatch({ type: "updatePerson", personId, patch }, "Edit person");
  }

  const viewFamily = showViewFamily && (
    <Button size="sm" onClick={() => store.getState().setViewRoot(topmostAncestor(doc, personId))}>
      {t("panel.viewFamily")}
    </Button>
  );
  const footer = readOnly ? (
    viewFamily || undefined
  ) : (
    <>
      <Button
        size="sm"
        disabled={isRoot}
        onClick={() => {
          store.getState().dispatch({ type: "setRoot", personId }, "Set as root");
          store.getState().setViewRoot(null);
        }}
      >
        {t("panel.setRoot")}
      </Button>
      {viewFamily}
      <Button
        variant="quiet"
        size="sm"
        className="panel-delete"
        onClick={() => onRequestDelete(personId)}
      >
        {t("panel.deleteButton")}
      </Button>
    </>
  );

  return (
    <Sheet
      className="person-panel"
      label={t("panel.label")}
      title={<bdi>{personLabel(person, t("panel.unnamed"))}</bdi>}
      leading={
        <PersonPhoto
          key={personId}
          person={person}
          readOnly={readOnly}
          onFailed={(failed) => setPhotoFailedFor(failed ? personId : null)}
        />
      }
      subtitle={<ProfileSummary person={person} />}
      onClose={() => store.getState().select(null)}
      closeLabel={t("panel.close")}
      expandable
      expandLabel={t("panel.sheetExpand")}
      collapseLabel={t("panel.sheetCollapse")}
      footer={footer}
    >
      {photoFailedFor === personId && !readOnly && (
        <p className="field-error" role="alert">
          {t("panel.photo.failed")}
        </p>
      )}
      <PersonDetails
        key={`details-${personId}`}
        person={person}
        readOnly={readOnly}
        update={update}
      />
      <FamilySection
        key={`family-${personId}`}
        personId={personId}
        readOnly={readOnly}
        onShow={show}
      />
    </Sheet>
  );
}
