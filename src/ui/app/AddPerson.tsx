import { Fragment, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { parentsOf, unionsOf } from "@/core/model/tree";
import { personLabel } from "@/ui/cards/describe";
import type { AddRole } from "@/ui/cards/nameEntry";
import { quickAddRoles, startAdd } from "@/ui/cards/quickAdd";
import { Menu, MenuItem } from "@/ui/design/Menu";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";
import { isReadOnlyView } from "@/ui/store/viewLayouts";

import { Icon, type IconName } from "./Icon";
import { Tip } from "./Tip";

/** The order the chooser offers relatives in: up, beside, down, beside. */
const ROLES = ["parent", "spouse", "child", "sibling"] as const;
const ROLE_ICONS: Record<(typeof ROLES)[number], IconName> = {
  parent: "viewPedigree",
  spouse: "relate",
  child: "viewFamily",
  sibling: "person",
};

/** How long a refused add's message stays. */
const REFUSED_MS = 4000;

/** Small screens open the chooser upward: the button sits in the bottom bar there. */
const inBottomBar = (el: HTMLElement) => el.getBoundingClientRect().top > window.innerHeight / 2;

/**
 * The toolbar's "+ Add person". An empty tree starts its first person at once. Otherwise a small
 * chooser adds a parent, spouse, child or sibling to the selected person, through the same
 * commands and inline editor as the "+" handles on the cards. With nobody selected it says so,
 * and offers a person who is not connected to anyone yet.
 */
export function AddPersonButton() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ point: [number, number]; above: boolean } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const empty = useEditor((s) => !s.doc || Object.keys(s.doc.persons).length === 0);
  const disabled = useEditor((s) => s.locked !== null || isReadOnlyView(s.viewMode));
  const doc = useEditor((s) => s.doc);
  const layout = useEditor((s) => s.layout);
  const viewMode = useEditor((s) => s.viewMode);
  const selectedId = useEditor((s) =>
    s.selectedId !== null && s.doc?.persons[s.selectedId] ? s.selectedId : null,
  );
  const person = selectedId === null ? undefined : doc?.persons[selectedId];
  const selected =
    person && selectedId !== null ? { id: selectedId, name: personLabel(person, t) } : null;
  const primary = selectedId === null ? undefined : layout?.primaryNode[selectedId];
  const node = primary === undefined ? undefined : layout?.nodes.find((n) => n.nodeId === primary);
  // Only adds the current view can draw, as on the card's handles.
  const roles: ReadonlySet<AddRole> = node ? quickAddRoles(viewMode, node) : new Set();
  const unions = selected && doc ? unionsOf(doc, selected.id) : [];
  const parentCount = selected && doc ? parentsOf(doc, selected.id).length : 0;

  useEffect(() => {
    if (!refused) return;
    const timer = setTimeout(() => setRefused(null), REFUSED_MS);
    return () => clearTimeout(timer);
  }, [refused]);

  function add(role: AddRole, fromId?: string, unionId?: string) {
    setAt(null);
    setRefused(null);
    if (startAdd(store, role, fromId, unionId)) return;
    setRefused(store.getState().error ?? "INVALID");
  }

  function open() {
    if (empty) {
      add("first");
      return;
    }
    const el = button.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === "rtl";
    const above = inBottomBar(el);
    setAt({
      point: [rtl ? box.right : box.left, above ? box.top - 6 : box.bottom + 6],
      above,
    });
  }

  /** "Parent" adds a person above: between the selected person and any parents they have. */
  const parentItems = () => {
    if (!selected || !roles.has("parent")) return null;
    return (
      <MenuItem
        icon={ROLE_ICONS.parent}
        onClick={() => add(parentCount > 0 ? "between" : "parent", selected.id)}
      >
        {t("toolbar.add.parent")}
      </MenuItem>
    );
  };

  const childItems = () => {
    if (!selected || !roles.has("child")) return null;
    // Several families: one "Child with …" per union, as the card's handle asks.
    if (unions.length >= 2) {
      return unions.map((union) => {
        const partnerId = union.partners.find((id) => id !== selected.id);
        const partner = partnerId ? doc?.persons[partnerId] : undefined;
        return (
          <MenuItem
            key={union.id}
            icon={ROLE_ICONS.child}
            onClick={() => add("child", selected.id, union.id)}
          >
            {partner ? (
              <span>{t("toolbar.add.childWith", { name: personLabel(partner, t) })}</span>
            ) : (
              t("toolbar.add.childAlone")
            )}
          </MenuItem>
        );
      });
    }
    return (
      <MenuItem icon={ROLE_ICONS.child} onClick={() => add("child", selected.id)}>
        {t("toolbar.add.child")}
      </MenuItem>
    );
  };

  return (
    <>
      <Tip hint={t("toolbar.hint.addPerson")}>
        {(tipId) => (
          <button
            ref={button}
            type="button"
            className="button button-primary toolbar-add"
            aria-label={t("toolbar.addPerson")}
            aria-describedby={tipId}
            aria-haspopup={empty ? undefined : "menu"}
            aria-expanded={empty ? undefined : at !== null}
            disabled={disabled}
            onClick={() => (at ? setAt(null) : open())}
          >
            <Icon name="plus" />
            <span className="toolbar-add__long" aria-hidden="true">
              {t("toolbar.addPerson")}
            </span>
            <span className="toolbar-add__short" aria-hidden="true">
              {t("toolbar.addShort")}
            </span>
          </button>
        )}
      </Tip>
      {at && (
        <Menu
          at={at.point}
          above={at.above}
          className="add-chooser"
          toggle={button}
          label={
            selected ? t("toolbar.add.to", { name: selected.name }) : t("toolbar.add.selectFirst")
          }
          onClose={() => setAt(null)}
        >
          {selected ? (
            <>
              <p className="menu-heading">
                <Trans
                  i18nKey="toolbar.add.heading"
                  components={{ name: <bdi>{selected.name}</bdi> }}
                />
              </p>
              {ROLES.map((role) =>
                role === "child" ? (
                  <Fragment key={role}>{childItems()}</Fragment>
                ) : role === "parent" ? (
                  <Fragment key={role}>{parentItems()}</Fragment>
                ) : roles.has(role) ? (
                  <MenuItem
                    key={role}
                    icon={ROLE_ICONS[role]}
                    onClick={() => add(role, selected.id)}
                  >
                    {t(`toolbar.add.${role}`)}
                  </MenuItem>
                ) : null,
              )}
              {roles.size === 0 && <p className="menu-note">{t("toolbar.add.noneHere")}</p>}
            </>
          ) : (
            <>
              <p className="menu-heading">{t("toolbar.add.selectFirst")}</p>
              <p className="menu-note">{t("toolbar.add.selectFirstHint")}</p>
              <MenuItem icon="person" onClick={() => add("first")}>
                {t("toolbar.add.unconnected")}
              </MenuItem>
            </>
          )}
        </Menu>
      )}
      {refused && (
        <p className="toast toolbar-toast" role="alert">
          {t(`handles.error.${refused}`, { defaultValue: t("handles.error.INVALID") })}
        </p>
      )}
    </>
  );
}
