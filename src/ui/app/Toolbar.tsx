import { type FormEvent, type Ref, useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";

import { displayName } from "@/core/model/tree";
import type { Autosaver } from "@/storage/autosave";
import { BirthdaysMenu } from "@/ui/birthdays/BirthdaysMenu";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";
import { isReadOnlyView } from "@/ui/store/viewLayouts";

import { downloadBackup } from "./downloadBackup";
import { Icon, type IconName } from "./Icon";
import { useRepo } from "./RepoContext";
import { SaveStatus } from "./SaveStatus";
import { shortcutLabel, Tip } from "./Tip";
import { FanGenerations, FocusControl, ViewSwitcher } from "./ViewSwitcher";

export type ToolbarProps = {
  autosaver: Autosaver;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onOpenSearch: () => void;
  onOpenUnconnected: () => void;
  onOpenExport?: () => void;
  /** Opens (or closes) the "How are we related?" panel. */
  onToggleRelation?: () => void;
  /** Selects and centres a person picked from the birthdays panel; without it there is no panel. */
  onShowPerson?: (personId: string) => void;
  /** Today, for the birthdays panel; tests pass a fixed date. */
  today?: () => Date;
};

function IconButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  expanded,
  hasMenu,
  ref,
  keepFocus,
  hint,
  shortcut,
  align,
}: {
  icon: IconName;
  label: string;
  /** Short description shown on hover and keyboard focus. */
  hint?: string;
  shortcut?: string;
  align?: "center" | "end";
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** Set on a button that opens a menu: whether the menu is open. */
  expanded?: boolean;
  hasMenu?: boolean;
  ref?: Ref<HTMLButtonElement>;
  /** Keeps the focus where it is on press (Undo/Redo must not blur an open inline editor). */
  keepFocus?: boolean;
}) {
  const button = (tipId?: string) => (
    <button
      ref={ref}
      type="button"
      className="icon-button"
      aria-label={label}
      aria-describedby={tipId}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={hasMenu ? "menu" : undefined}
      disabled={disabled}
      onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
  if (!hint) return button();
  return (
    <Tip hint={hint} shortcut={shortcut} align={align}>
      {button}
    </Tip>
  );
}

function focusAndSelect(input: HTMLInputElement | null) {
  input?.focus();
  input?.select();
}

/** The tree name; click it to rename. Enter confirms, Esc and an empty name change nothing. */
function TreeName() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const name = useEditor((s) => s.doc?.name ?? "");
  const [editing, setEditing] = useState(false);
  /** True once this edit has ended, so Enter followed by a blur cannot end it twice. */
  const settled = useRef(true);

  function begin() {
    settled.current = false;
    setEditing(true);
  }

  function finish(value: string, commit: boolean) {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const next = value.trim();
    if (commit && next !== "" && next !== name) {
      store.getState().dispatch({ type: "renameTree", name: next }, "Rename tree");
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="tree-title"
        aria-label={t("toolbar.renameNamed", { name })}
        onClick={begin}
      >
        <bdi>{name}</bdi>
      </button>
    );
  }
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        finish(new FormData(event.currentTarget).get("name")?.toString() ?? "", true);
      }}
    >
      <input
        name="name"
        className="field tree-title-field"
        aria-label={t("common.treeName")}
        defaultValue={name}
        ref={focusAndSelect}
        autoComplete="off"
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => finish(event.currentTarget.value, true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") finish("", false);
        }}
      />
    </form>
  );
}

/** The backup menu (FR-X7): an "Include photos" box and the download itself. */
function BackupMenu({ onOpenExport }: { onOpenExport?: () => void }) {
  const { t } = useTranslation();
  const repo = useRepo();
  const store = useEditorStore();
  const [open, setOpen] = useState(false);
  const [includePhotos, setIncludePhotos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  /** Closes the panel and returns focus to its button, which the panel was holding. */
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  async function download() {
    const doc = store.getState().doc;
    if (!doc) return;
    setBusy(true);
    setFailed(false);
    try {
      await downloadBackup(repo, doc, { includePhotos });
      close();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="menu" ref={root} data-menu>
      <IconButton
        ref={trigger}
        icon="menu"
        label={t("toolbar.menu")}
        hint={t("toolbar.hint.menu")}
        shortcut={
          onOpenExport ? t("toolbar.hint.exportKeys", { keys: shortcutLabel("E") }) : undefined
        }
        align="end"
        expanded={open}
        hasMenu
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="menu-panel">
          {onOpenExport && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setOpen(false);
                onOpenExport();
              }}
            >
              {t("toolbar.export")}
            </button>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={includePhotos}
              onChange={(event) => setIncludePhotos(event.currentTarget.checked)}
            />
            {t("toolbar.includePhotos")}
          </label>
          <button type="button" className="button" disabled={busy} onClick={() => void download()}>
            {t("toolbar.downloadBackup")}
          </button>
          {failed && (
            <p className="notice" role="alert">
              {t("toolbar.backupFailed")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function Toolbar({
  autosaver,
  onZoomIn,
  onZoomOut,
  onFit,
  onOpenSearch,
  onOpenUnconnected,
  onOpenExport,
  onToggleRelation,
  onShowPerson,
  today,
}: ToolbarProps) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const focusMode = useEditor((s) => s.focusMode);
  const relationOpen = useEditor((s) => s.relation !== null);
  // Fan and timeline are read-only: nothing to undo. They zoom and fit through their own handle.
  const readOnlyView = useEditor((s) => isReadOnlyView(s.viewMode));
  // A view root that is the tree root itself has nothing to go back to.
  const viewRootId = useEditor((s) =>
    s.viewRootId !== null && s.viewRootId !== s.doc?.rootPersonId ? s.viewRootId : null,
  );
  // About the family view, also while a focus view (which draws far fewer people) is shown.
  const unconnected = useEditor((s) => s.familyUnreachable.length);
  const rootName = useEditor((s) => {
    const rootId = s.doc?.rootPersonId;
    const root = rootId === undefined ? undefined : s.doc?.persons[rootId];
    return (root && displayName(root)) || t("app.unknownPerson");
  });

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <Link to="/app" className="toolbar-link">
          {t("toolbar.myTrees")}
        </Link>
        <TreeName />
        <SaveStatus autosaver={autosaver} />
      </div>

      <div className="toolbar-group toolbar-views">
        <ViewSwitcher />
        <FocusControl />
        <FanGenerations />
      </div>

      {viewRootId !== null && (
        <button
          type="button"
          className="breadcrumb"
          onClick={() => store.getState().setViewRoot(null)}
        >
          <Trans i18nKey="toolbar.backTo" components={{ name: <bdi>{rootName}</bdi> }} />
        </button>
      )}

      <div className="toolbar-group toolbar-tools">
        {unconnected > 0 && (
          <button
            type="button"
            className="badge"
            aria-label={t("toolbar.unconnectedAria", { count: unconnected })}
            onClick={onOpenUnconnected}
          >
            {t("toolbar.unconnected", { count: unconnected })}
          </button>
        )}
        <IconButton
          icon="undo"
          label={t("toolbar.undo")}
          hint={t("toolbar.hint.undo")}
          shortcut={shortcutLabel("Z")}
          disabled={!canUndo || readOnlyView}
          keepFocus
          onClick={() => store.getState().undo()}
        />
        <IconButton
          icon="redo"
          label={t("toolbar.redo")}
          hint={t("toolbar.hint.redo")}
          shortcut={shortcutLabel("Z", { shift: true })}
          disabled={!canRedo || readOnlyView}
          keepFocus
          onClick={() => store.getState().redo()}
        />
        <IconButton
          icon="zoomOut"
          label={t("toolbar.zoomOut")}
          hint={t("toolbar.hint.zoomOut")}
          shortcut={t("toolbar.hint.zoomKeys")}
          onClick={onZoomOut}
        />
        <IconButton
          icon="zoomIn"
          label={t("toolbar.zoomIn")}
          hint={t("toolbar.hint.zoomIn")}
          shortcut={t("toolbar.hint.zoomKeys")}
          onClick={onZoomIn}
        />
        <IconButton
          icon="fit"
          label={t("toolbar.fit")}
          hint={t("toolbar.hint.fit")}
          onClick={onFit}
        />
        <IconButton
          icon="search"
          label={t("toolbar.search")}
          hint={t("toolbar.hint.search")}
          shortcut={shortcutLabel("F")}
          onClick={onOpenSearch}
        />
        <IconButton
          icon="focus"
          label={t("toolbar.focusMode")}
          hint={t("toolbar.hint.focusMode")}
          align="end"
          pressed={focusMode}
          onClick={() => store.getState().setFocusMode(!focusMode)}
        />
        {onToggleRelation && (
          <IconButton
            icon="relate"
            label={t("kinship.panel.open")}
            hint={t("toolbar.hint.relate")}
            shortcut={t("toolbar.hint.relateKeys")}
            align="end"
            pressed={relationOpen}
            onClick={onToggleRelation}
          />
        )}
        {onShowPerson && <BirthdaysMenu today={today} onShow={onShowPerson} />}
        <BackupMenu onOpenExport={onOpenExport} />
      </div>
    </header>
  );
}
