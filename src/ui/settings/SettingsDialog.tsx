import "./settings.css";

import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "@/ui/app/Dialog";
import { Segmented } from "@/ui/design/Segmented";
import { LanguageField } from "@/ui/i18n/LanguageField";

import { MOTION_PREFS, useMotionPref } from "./motion";
import {
  COLOR_MODES,
  type ColorMode,
  type Theme,
  THEMES,
  TREE_DIRECTIONS,
  useSettings,
} from "./settings";

/** A theme as a radio card: a mini toolbar and two mini people, drawn in that theme's own colours. */
function ThemeCards({
  value,
  onChange,
  legend,
}: {
  value: Theme;
  onChange: (theme: Theme) => void;
  legend: string;
}) {
  const { t } = useTranslation();
  const legendId = useId();
  return (
    <fieldset className="settings-group" role="radiogroup" aria-labelledby={legendId}>
      <legend id={legendId} className="settings-label">
        {legend}
      </legend>
      <div className="theme-grid">
        {THEMES.map((theme) => {
          const hintId = `${legendId}-${theme}`;
          return (
            <label key={theme} className="theme-card" data-option={theme}>
              <input
                type="radio"
                name="theme"
                value={theme}
                checked={value === theme}
                aria-describedby={hintId}
                onChange={() => onChange(theme)}
                // Picking the option already in use is a choice too (it marks the theme as the
                // user's, which the landing page then follows); radios fire no change for it.
                onClick={() => {
                  if (value === theme) onChange(theme);
                }}
              />
              <span className="theme-preview" data-swatch={theme} aria-hidden="true">
                <span className="theme-preview__bar">
                  <i className="theme-preview__dot" />
                  <i className="theme-preview__line" />
                  <i className="theme-preview__pill" />
                </span>
                <span className="theme-preview__people">
                  <span className="theme-preview__person">
                    <i className="theme-preview__face" />
                    <i className="theme-preview__line" />
                  </span>
                  <span className="theme-preview__person theme-preview__person--alt">
                    <i className="theme-preview__face" />
                    <i className="theme-preview__line" />
                  </span>
                </span>
              </span>
              <span className="theme-card__text">
                <span className="theme-card__name">{t(`settings.themes.${theme}`)}</span>
                {/* Kept out of the option's name (the whole card stays clickable): it is the
                    description instead. */}
                <span id={hintId} className="theme-card__hint" aria-hidden="true">
                  {t(`settings.themeHints.${theme}`)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** How a card colour mode looks, in the current theme's own colours: a strip of tiny cards. */
function ColorStrip({ mode }: { mode: ColorMode }) {
  const hues: Record<ColorMode, (number | "m" | "f")[]> = {
    gender: ["m", "f", "m", "f", "m", "f"],
    branch: [0, 0, 1, 1, 2, 2],
    generation: [0, 1, 2, 3, 4, 5],
  };
  return (
    <span className="color-strip" data-mode={mode} aria-hidden="true">
      {hues[mode].map((h, i) => (
        <i
          key={i}
          className="color-strip__card"
          data-gender={typeof h === "string" ? h : undefined}
          style={
            typeof h === "number"
              ? { background: `var(--hue-${h})`, borderColor: `var(--hue-${h}-deep)` }
              : undefined
          }
        >
          {h === "m" ? "\u2642" : h === "f" ? "\u2640" : ""}
        </i>
      ))}
    </span>
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
  const uid = useId();

  return (
    <Dialog title={t("settings.title")} onClose={onClose}>
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <div className="settings-columns">
          <section className="settings-column" aria-labelledby={`${uid}-appearance`}>
            <h3 id={`${uid}-appearance`} className="settings-heading">
              {t("settings.appearance")}
            </h3>
            <ThemeCards
              legend={t("settings.theme")}
              value={settings.theme}
              onChange={(theme) => update({ theme })}
            />
            <div className="settings-group">
              <span id={`${uid}-color`} className="settings-label">
                {t("settings.colorMode")}
              </span>
              <Segmented
                block
                labelledBy={`${uid}-color`}
                value={settings.colorMode}
                onChange={(colorMode) => update({ colorMode })}
                options={COLOR_MODES.map((mode) => ({
                  value: mode,
                  label: t(`settings.colorModes.${mode}`),
                }))}
              />
              <div className="settings-preview-row">
                <ColorStrip mode={settings.colorMode} />
                <p className="settings-note">
                  {t(`settings.colorModeHints.${settings.colorMode}`)}
                </p>
              </div>
            </div>
          </section>
          <section className="settings-column" aria-labelledby={`${uid}-layout`}>
            <h3 id={`${uid}-layout`} className="settings-heading">
              {t("settings.layout")}
            </h3>
            <LanguageField
              value={settings.language}
              onChange={(language) => update({ language })}
            />
            <div className="settings-group">
              <span id={`${uid}-direction`} className="settings-label">
                {t("settings.direction")}
              </span>
              <Segmented
                block
                labelledBy={`${uid}-direction`}
                value={settings.treeDirection}
                onChange={(treeDirection) => update({ treeDirection })}
                options={TREE_DIRECTIONS.map((direction) => ({
                  value: direction,
                  label: t(`settings.directions.${direction}`),
                }))}
              />
              <p className="settings-note">{t("settings.directionHint")}</p>
            </div>
            <div className="settings-group">
              <span id={`${uid}-motion`} className="settings-label">
                {t("settings.motion")}
              </span>
              <Segmented
                block
                labelledBy={`${uid}-motion`}
                value={motion}
                onChange={setMotion}
                options={MOTION_PREFS.map((pref) => ({
                  value: pref,
                  label: t(`settings.motions.${pref}`),
                }))}
              />
              <p className="settings-note">{t("settings.motionHint")}</p>
            </div>
          </section>
        </div>
        <div className="dialog-actions">
          <button type="submit" className="button button-primary">
            {t("settings.done")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
