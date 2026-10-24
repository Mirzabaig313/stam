import { useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { FAN_MAX_GENERATIONS, FAN_MIN_GENERATIONS } from "@/core/layout/fan";
import { displayName } from "@/core/model/tree";
import type { ViewMode } from "@/core/views/types";
import { Menu, MenuItem } from "@/ui/design/Menu";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";
import { isFocusView, resolveFocus, VIEW_MODES } from "@/ui/store/viewLayouts";

import { Icon, type IconName } from "./Icon";
import { Tip } from "./Tip";

const ICONS: Record<ViewMode, IconName> = {
  family: "viewFamily",
  pedigree: "viewPedigree",
  descendants: "viewDescendants",
  hourglass: "viewHourglass",
  fan: "viewFan",
  timeline: "viewTimeline",
};

/** The six views as a segmented control: icon and label, Alt+1 … Alt+6. */
export function ViewSwitcher() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const viewMode = useEditor((s) => s.viewMode);
  return (
    <fieldset className="view-switcher" aria-label={t("views.switcher")}>
      {VIEW_MODES.map((mode, index) => {
        const label = t(`views.mode.${mode}`);
        return (
          <span key={mode} className="view-switcher__item">
            <Tip hint={t(`views.hint.${mode}`)} shortcut={`Alt+${index + 1}`}>
              {(tipId) => (
                <button
                  type="button"
                  className="view-switcher__button"
                  aria-pressed={viewMode === mode}
                  aria-keyshortcuts={`Alt+${index + 1}`}
                  aria-describedby={tipId}
                  onClick={() => store.getState().setViewMode(mode)}
                >
                  <Icon name={ICONS[mode]} />
                  <span className="view-switcher__label">{label}</span>
                </button>
              )}
            </Tip>
          </span>
        );
      })}
    </fieldset>
  );
}

/**
 * The views on a phone, where the dock has no room to name six icons: one button with the
 * current view's icon and name, opening a menu of all six, each with what it shows.
 */
export function ViewPicker() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const viewMode = useEditor((s) => s.viewMode);
  const trigger = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<[number, number] | null>(null);
  const current = t(`views.mode.${viewMode}`);

  function open() {
    const el = trigger.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === "rtl";
    // Up from the dock, its end edge on the button's.
    setAt([rtl ? box.left : box.right, box.top - 8]);
  }

  return (
    <div className="view-picker">
      <button
        ref={trigger}
        type="button"
        className="view-picker__button"
        aria-label={t("views.picker", { view: current })}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={() => (at ? setAt(null) : open())}
      >
        <Icon name={ICONS[viewMode]} />
        <span className="view-picker__current">{current}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {at && (
        <Menu
          at={at}
          opens="start"
          above
          label={t("views.switcher")}
          className="view-picker__menu"
          toggle={trigger}
          onClose={() => setAt(null)}
        >
          {VIEW_MODES.map((mode) => (
            <MenuItem
              key={mode}
              role="menuitemradio"
              aria-checked={viewMode === mode}
              icon={ICONS[mode]}
              onClick={() => {
                setAt(null);
                store.getState().setViewMode(mode);
              }}
            >
              <span className="view-picker__text">
                <span className="view-picker__name">{t(`views.mode.${mode}`)}</span>
                <span className="view-picker__hint">{t(`views.hint.${mode}`)}</span>
              </span>
              <span className="menu-item__check" aria-hidden="true">
                {viewMode === mode && <Icon name="check" />}
              </span>
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}

/** "Focus: Ali": whom the pedigree, descendants, hourglass and fan are drawn around. */
export function FocusControl() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const active = useEditor((s) => isFocusView(s.viewMode));
  const focusId = useEditor((s) => resolveFocus(s.doc, s.focusId, s.viewRootId));
  const focusName = useEditor((s) => {
    const person = focusId === null ? undefined : s.doc?.persons[focusId];
    return (person && displayName(person)) || t("app.unknownPerson");
  });
  const selectedId = useEditor((s) =>
    s.selectedId && s.doc?.persons[s.selectedId] ? s.selectedId : null,
  );
  const selectedName = useEditor((s) => {
    const person = selectedId === null ? undefined : s.doc?.persons[selectedId];
    return (person && displayName(person)) || t("app.unknownPerson");
  });
  if (!active || focusId === null) return null;
  return (
    <div className="focus-control">
      <span className="focus-control__name">
        <Trans i18nKey="views.focus" components={{ name: <bdi>{focusName}</bdi> }} />
      </span>
      {selectedId !== null && selectedId !== focusId && (
        <button
          type="button"
          className="button"
          onClick={() => store.getState().setFocus(selectedId)}
        >
          {t("views.focusOn", { name: selectedName })}
        </button>
      )}
    </div>
  );
}

/** The fan chart's generations (FR-V5): a 2–7 stepper, shown in the fan view only. */
export function FanGenerations() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const fan = useEditor((s) => s.viewMode === "fan");
  const generations = useEditor((s) => s.fanGenerations);
  if (!fan) return null;
  const step = (by: number) => store.getState().setFanGenerations(generations + by);
  return (
    <fieldset className="fan-generations" aria-label={t("views.fan.generations")}>
      <span className="fan-generations__label" aria-hidden="true">
        {t("views.fan.generations")}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label={t("views.fan.fewer")}
        title={t("views.fan.fewer")}
        disabled={generations <= FAN_MIN_GENERATIONS}
        onClick={() => step(-1)}
      >
        <span aria-hidden="true">−</span>
      </button>
      <output className="fan-generations__value" aria-live="polite">
        {generations}
      </output>
      <button
        type="button"
        className="icon-button"
        aria-label={t("views.fan.more")}
        title={t("views.fan.more")}
        disabled={generations >= FAN_MAX_GENERATIONS}
        onClick={() => step(1)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </fieldset>
  );
}
