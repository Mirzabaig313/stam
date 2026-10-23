import type { TFunction } from "i18next";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ChildType, Person } from "@/core/model/types";
import { Icon } from "@/ui/app/Icon";
import type { AddRole } from "@/ui/cards/nameEntry";
import { quickAddRoles, startAdd } from "@/ui/cards/quickAdd";
import { UnionChooser } from "@/ui/cards/UnionChooser";
import { Avatar } from "@/ui/design/Avatar";
import { cx } from "@/ui/design/cx";
import { IconButton } from "@/ui/design/IconButton";
import { usePhotoUrl } from "@/ui/photos/usePhotoUrl";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { familyOf } from "./family";
import { personLabel } from "./fields";
import { UnionEditor, unionSummary } from "./PersonUnions";

type FamilySectionProps = {
  personId: string;
  readOnly: boolean;
  /** Shows a relative: selects them and brings them into view. */
  onShow: (personId: string) => void;
};

/** A relative as a chip: their face and name; pressing it shows them. */
function PersonChip({
  person,
  tag,
  onShow,
}: {
  person: Person;
  tag?: string;
  onShow: (personId: string) => void;
}) {
  const { t } = useTranslation();
  const url = usePhotoUrl(person.photoId);
  const name = personLabel(person, t("panel.unnamed"));
  return (
    <button type="button" className="person-chip" onClick={() => onShow(person.id)}>
      <Avatar name={name} size="sm" {...(person.photoId && url ? { photoUrl: url } : {})} />
      <span className="person-chip__name">
        <bdi>{name}</bdi>
      </span>
      {tag && <span className="person-chip__tag">{tag}</span>}
    </button>
  );
}

/** "+ Add": a dashed pill, the album's sign for a place still empty. */
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="add-pill" aria-label={label} onClick={onClick}>
      <Icon name="plus" size={14} />
      {t("panel.family.add")}
    </button>
  );
}

function FamilyGroup({
  title,
  children,
  add,
  className,
}: {
  title: string;
  children?: ReactNode;
  add?: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cx("family-group", className)}>
      <legend className="family-group__title">{title}</legend>
      <div className="family-group__people">
        {children}
        {add}
      </div>
    </fieldset>
  );
}

const childTag = (type: ChildType, t: TFunction) =>
  type === "biological" ? undefined : t(`panel.childType.${type}`);

/**
 * Parents, spouses (with the partnership's status), children and siblings, as chips that show
 * the relative. Each group has "+ Add", which uses the canvas's quick add: the new person's card
 * opens with the inline editor.
 */
export function FamilySection({ personId, readOnly, onShow }: FamilySectionProps) {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const roles = useEditor((s) => {
    const layout = s.layout;
    const node = layout?.nodes.find((n) => n.nodeId === layout.primaryNode[personId]);
    return quickAddRoles(s.viewMode, { generation: node?.generation ?? 0 });
  });
  const [openUnions, setOpenUnions] = useState<ReadonlySet<string>>(new Set());
  const [choosingUnion, setChoosingUnion] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const titleId = useId();
  if (!doc) return null;

  const family = familyOf(doc, personId);
  const can = (role: AddRole) => !readOnly && roles.has(role);
  const biologicalParents = family.parents.filter((p) => p.childType === "biological").length;

  function add(role: AddRole, unionId?: string) {
    setChoosingUnion(false);
    setRefused(null);
    if (startAdd(store, role, personId, unionId)) return;
    setRefused(store.getState().error ?? "INVALID");
  }

  const toggleUnion = (unionId: string) =>
    setOpenUnions((open) => {
      const next = new Set(open);
      if (!next.delete(unionId)) next.add(unionId);
      return next;
    });

  const chip = (id: string, tag?: string) => {
    const person = doc.persons[id];
    return person ? <PersonChip key={id} person={person} tag={tag} onShow={onShow} /> : null;
  };

  const showParents = family.parents.length > 0 || can("parent");
  const showSpouses = family.partnerships.length > 0 || can("spouse");
  const showChildren = family.children.length > 0 || can("child");
  const showSiblings = family.siblings.length > 0 || can("sibling");
  if (!showParents && !showSpouses && !showChildren && !showSiblings) return null;

  return (
    <section className="panel-section" aria-labelledby={titleId}>
      <h3 id={titleId} className="panel-section__title">
        {t("panel.family.title")}
      </h3>

      {showParents && (
        <FamilyGroup
          title={t("panel.family.parents")}
          add={
            can("parent") &&
            // Up is a new generation: with parents there, the new person goes between them and
            // this person (as the card's top "+"); a second parent is a spouse of the first.
            (biologicalParents > 0 ? (
              <AddButton label={t("panel.family.addAbove")} onClick={() => add("between")} />
            ) : (
              <AddButton label={t("panel.family.addParent")} onClick={() => add("parent")} />
            ))
          }
        >
          {family.parents.map((p) => chip(p.personId, childTag(p.childType, t)))}
        </FamilyGroup>
      )}

      {showSpouses && (
        <FamilyGroup
          title={t("panel.family.spouses")}
          className="family-group--spouses"
          add={
            can("spouse") && (
              <AddButton label={t("panel.family.addSpouse")} onClick={() => add("spouse")} />
            )
          }
        >
          {family.partnerships.map(({ union, partnerId }) => {
            const partner = doc.persons[partnerId];
            const partnerName = partner ? personLabel(partner, t("panel.unnamed")) : undefined;
            const open = openUnions.has(union.id);
            return (
              <div key={union.id} className="family-spouse" data-open={open || undefined}>
                <div className="family-spouse__row">
                  {partner && chip(partner.id)}
                  <span className="family-spouse__status">
                    <bdi>{unionSummary(union, i18n.language, t)}</bdi>
                  </span>
                  {!readOnly && (
                    <IconButton
                      icon="chevronDown"
                      size="sm"
                      className="family-spouse__toggle"
                      label={t("panel.union.edit", { name: partnerName ?? "" })}
                      aria-expanded={open}
                      onClick={() => toggleUnion(union.id)}
                    />
                  )}
                </div>
                {open && !readOnly && <UnionEditor union={union} partnerName={partnerName} />}
              </div>
            );
          })}
        </FamilyGroup>
      )}

      {showChildren && (
        <FamilyGroup
          title={t("panel.family.children")}
          add={
            can("child") && (
              <AddButton
                label={t("panel.family.addChild")}
                onClick={() => {
                  if (family.unions.length >= 2) setChoosingUnion((c) => !c);
                  else add("child");
                }}
              />
            )
          }
        >
          {family.children.map((c) => chip(c.personId, childTag(c.childType, t)))}
        </FamilyGroup>
      )}
      {choosingUnion && (
        <div className="family-chooser">
          <UnionChooser
            personId={personId}
            onChoose={(unionId) => add("child", unionId)}
            onCancel={() => setChoosingUnion(false)}
          />
        </div>
      )}

      {showSiblings && (
        <FamilyGroup
          title={t("panel.family.siblings")}
          add={
            can("sibling") && (
              <AddButton label={t("panel.family.addSibling")} onClick={() => add("sibling")} />
            )
          }
        >
          {family.siblings.map((s) =>
            chip(s.personId, s.half ? t("panel.family.half") : undefined),
          )}
        </FamilyGroup>
      )}

      {refused && (
        <p className="field-error" role="alert">
          {t(`handles.error.${refused}`)}
        </p>
      )}
    </section>
  );
}
