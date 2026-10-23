import "./settings.css";

import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "@/ui/app/Dialog";
import { LanguageField } from "@/ui/i18n/LanguageField";

import { MOTION_PREFS, useMotionPref } from "./motion";
import { COLOR_MODES, THEMES, TREE_DIRECTIONS, useSettings } from "./settings";

type Choice<T> = { value: T; label: ReactNode; description?: string };

function Choices<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
}) {
  const legendId = useId();
  return (
    <fieldset className="settings-group" role="radiogroup" aria-labelledby={legendId}>
      <legend id={legendId} className="field-label">
        {legend}
      </legend>
      {options.map(({ value: option, label, description }) => {
        const hintId = `${legendId}-${option}`;
        return (
          <label key={option} className="settings-choice" data-option={option}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              aria-describedby={description ? hintId : undefined}
              onChange={() => onChange(option)}
              // Picking the option already in use is a choice too (it marks the theme as the
              // user's, which the landing page then follows); radios fire no change for it.
              onClick={() => {
                if (value === option) onChange(option);
              }}
            />
            <span className="settings-choice__text">
              <span className="settings-choice__label">{label}</span>
              {/* Kept out of the option's name (the whole row stays clickable): it is the
                  description instead. */}
              {description && (
                <span id={hintId} className="settings-choice__hint" aria-hidden="true">
                  {description}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * Settings (opened from the editor's menu and the tree list): language, theme, card colours, tree
 * direction and reduced motion. Every change applies at once and is saved through the repo.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [settings, update] = useSettings();
  const [motion, setMotion] = useMotionPref();

  return (
    <Dialog title={t("settings.title")} onClose={onClose}>
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <LanguageField value={settings.language} onChange={(language) => update({ language })} />
        <Choices
          legend={t("settings.theme")}
          name="theme"
          value={settings.theme}
          options={THEMES.map((theme) => ({
            value: theme,
            label: (
              <>
                <span className="settings-swatch" data-swatch={theme} aria-hidden="true" />
                {t(`settings.themes.${theme}`)}
              </>
            ),
            description: t(`settings.themeHints.${theme}`),
          }))}
          onChange={(theme) => update({ theme })}
        />
        <Choices
          legend={t("settings.colorMode")}
          name="colorMode"
          value={settings.colorMode}
          options={COLOR_MODES.map((mode) => ({
            value: mode,
            label: t(`settings.colorModes.${mode}`),
            description: t(`settings.colorModeHints.${mode}`),
          }))}
          onChange={(colorMode) => update({ colorMode })}
        />
        <Choices
          legend={t("settings.direction")}
          name="treeDirection"
          value={settings.treeDirection}
          options={TREE_DIRECTIONS.map((direction) => ({
            value: direction,
            label: t(`settings.directions.${direction}`),
          }))}
          onChange={(treeDirection) => update({ treeDirection })}
        />
        <Choices
          legend={t("settings.motion")}
          name="motion"
          value={motion}
          options={MOTION_PREFS.map((pref) => ({
            value: pref,
            label: t(`settings.motions.${pref}`),
            ...(pref === "reduce" ? { description: t("settings.motionHint") } : {}),
          }))}
          onChange={setMotion}
        />
        <div className="dialog-actions">
          <button type="submit" className="button button-primary">
            {t("settings.done")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
