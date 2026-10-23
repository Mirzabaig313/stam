import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { BirthdaysPanel, useBirthdays } from "@/ui/birthdays/Birthdays";
import { Menu, MenuItem, MenuSeparator } from "@/ui/design/Menu";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { downloadBackup } from "./downloadBackup";
import { Icon } from "./Icon";
import { useRepo } from "./RepoContext";
import { shortcutLabel, Tip } from "./Tip";

export type MoreMenuProps = {
  onOpenExport?: () => void;
  onOpenSettings: () => void;
  /** Opens (or closes) the "How are we related?" panel; without it there is no item. */
  onToggleRelation?: () => void;
  /** Selects and centres a person picked from the birthdays panel; without it there is no item. */
  onShowPerson?: (personId: string) => void;
  today?: () => Date;
};

/** How long "Couldn't create the backup" stays. */
const FAILED_MS = 6000;

/**
 * "⋯ More": the tools used now and then, each with an icon and a label. Focus mode and the
 * relationship panel are toggles (menuitemcheckbox); Birthdays opens its panel under the button;
 * Export, the two backups and Settings act at once. A dot on the button says a birthday is near.
 */
export function MoreMenu({
  onOpenExport,
  onOpenSettings,
  onToggleRelation,
  onShowPerson,
  today,
}: MoreMenuProps) {
  const { t } = useTranslation();
  const repo = useRepo();
  const store = useEditorStore();
  const focusMode = useEditor((s) => s.focusMode);
  const relationOpen = useEditor((s) => s.relation !== null);
  const { soon } = useBirthdays(today);
  const trigger = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<[number, number] | null>(null);
  const [birthdaysOpen, setBirthdaysOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => setFailed(false), FAILED_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  function open() {
    const el = trigger.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === "rtl";
    // The menu opens toward the inline end of the point and is kept in the window, so from the
    // button's inline-start edge it hangs under the button at the window's end.
    setAt([rtl ? box.right : box.left, box.bottom + 6]);
  }

  /** Runs a menu action after the menu has closed (and handed the focus back). */
  const run = (action: () => void) => () => {
    setAt(null);
    action();
  };

  async function backup(includePhotos: boolean) {
    const doc = store.getState().doc;
    if (!doc) return;
    setBusy(true);
    setFailed(false);
    try {
      await downloadBackup(repo, doc, { includePhotos });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const birthdaysLabel =
    soon > 0 ? t("birthdays.openWithCount", { count: soon }) : t("birthdays.open");

  return (
    <div className="menu" data-menu>
      <Tip
        hint={t("toolbar.hint.menu")}
        shortcut={
          onOpenExport ? t("toolbar.hint.exportKeys", { keys: shortcutLabel("E") }) : undefined
        }
        align="end"
      >
        {(tipId) => (
          <button
            ref={trigger}
            type="button"
            className="icon-button toolbar-more"
            aria-label={t("toolbar.menu")}
            aria-describedby={tipId}
            aria-haspopup="menu"
            aria-expanded={at !== null}
            onClick={() => (at ? setAt(null) : open())}
          >
            <Icon name="more" />
            {soon > 0 && <span className="toolbar-more__dot" aria-hidden="true" />}
          </button>
        )}
      </Tip>
      {at && (
        <Menu
          at={at}
          label={t("toolbar.menu")}
          className="more-menu"
          toggle={trigger}
          onClose={() => setAt(null)}
        >
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={focusMode}
            icon="focus"
            onClick={run(() => store.getState().setFocusMode(!focusMode))}
          >
            <span className="menu-item__label">{t("toolbar.focusMode")}</span>
            <Check on={focusMode} />
          </MenuItem>
          {onToggleRelation && (
            <MenuItem
              role="menuitemcheckbox"
              aria-checked={relationOpen}
              icon="relate"
              onClick={run(onToggleRelation)}
            >
              <span className="menu-item__label">{t("kinship.panel.open")}</span>
              <Check on={relationOpen} />
            </MenuItem>
          )}
          {onShowPerson && (
            <MenuItem
              icon="cake"
              aria-haspopup="dialog"
              onClick={run(() => setBirthdaysOpen(true))}
            >
              <span className="menu-item__label">{birthdaysLabel}</span>
              {soon > 0 && (
                <span className="menu-item__count" aria-hidden="true">
                  {soon}
                </span>
              )}
            </MenuItem>
          )}
          <MenuSeparator />
          {onOpenExport && (
            <MenuItem icon="export" onClick={run(onOpenExport)}>
              <span className="menu-item__label">{t("toolbar.export")}</span>
              <kbd className="menu-item__key" aria-hidden="true">
                {shortcutLabel("E")}
              </kbd>
            </MenuItem>
          )}
          <MenuItem icon="backup" disabled={busy} onClick={run(() => void backup(false))}>
            <span className="menu-item__label">{t("toolbar.downloadBackup")}</span>
          </MenuItem>
          <MenuItem icon="photo" disabled={busy} onClick={run(() => void backup(true))}>
            <span className="menu-item__label">{t("toolbar.downloadBackupPhotos")}</span>
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon="settings" onClick={run(onOpenSettings)}>
            <span className="menu-item__label">{t("settings.open")}</span>
          </MenuItem>
        </Menu>
      )}
      {birthdaysOpen && onShowPerson && (
        <BirthdaysPanel
          today={today}
          onShow={onShowPerson}
          onClose={() => {
            setBirthdaysOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
      {failed && (
        <p className="toast toolbar-toast" role="alert">
          {t("toolbar.backupFailed")}
        </p>
      )}
    </div>
  );
}

/** The tick of a checked toggle item. */
function Check({ on }: { on: boolean }) {
  return (
    <span className="menu-item__check" aria-hidden="true">
      {on && <Icon name="check" />}
    </span>
  );
}
