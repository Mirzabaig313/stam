import { Trans, useTranslation } from "react-i18next";

import { FAN_MAX_GENERATIONS, FAN_MIN_GENERATIONS } from "@/core/layout/fan";
import { displayName } from "@/core/model/tree";
import type { ViewMode } from "@/core/views/types";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";
import { isFocusView, resolveFocus, VIEW_MODES } from "@/ui/store/viewLayouts";

import { Icon, type IconName } from "./Icon";

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
        const tipId = `view-hint-${mode}`;
        return (
          <span key={mode} className="view-switcher__item">
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
            <span role="tooltip" id={tipId} className="view-switcher__tip">
              <span className="view-switcher__tip-text">{t(`views.hint.${mode}`)}</span>
              <kbd className="view-switcher__tip-key">Alt+{index + 1}</kbd>
            </span>
          </span>
        );
      })}
    </fieldset>
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
