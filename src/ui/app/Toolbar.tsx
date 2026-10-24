import "./toolbar.css";

import { type FormEvent, type Ref, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";

import { displayName } from "@/core/model/tree";
import type { Autosaver } from "@/storage/autosave";
import { SettingsDialog } from "@/ui/settings/SettingsDialog";
import { ShareDialog } from "@/ui/share/ShareDialog";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";
import { isReadOnlyView } from "@/ui/store/viewLayouts";

import { AddPersonButton } from "./AddPerson";
import { PresenceAvatars } from "@/ui/share/Presence";

import { CloudStatus } from "./CloudStatus";
import { Icon, type IconName } from "./Icon";
import { MoreMenu } from "./MoreMenu";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Back from Google sign-in with `?share=1`: the share dialog opens again where it was.
  const [sharing, setSharing] = useState<"share" | "account" | null>(() => {
    if (typeof location === "undefined") return null;
    const url = new URL(location.href);
    if (url.searchParams.get("share") !== "1") return null;
    // Once: a reload must not open it again.
    url.searchParams.delete("share");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    return "share";
  });
  // People who opened a view (or comment) link cannot share the tree on.
  const canShare = useEditor((s) => !s.cloud || s.cloud.role === "owner");
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
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

  // One row on a desktop: where the tree is (start), how it is drawn (centre), what to do (end).
  // On a phone the start and end make a top bar and the dock (add, search, views) a bottom bar;
  // the view's own controls (breadcrumb, focus, fan generations) float under the bar.
  return (
    <header className="toolbar">
      <div className="toolbar-group toolbar-start">
        <Link to="/app" className="toolbar-back">
          <Icon name="back" />
          <span className="toolbar-back__label">{t("toolbar.myTrees")}</span>
        </Link>
        <TreeName />
        {unconnected > 0 && (
          <button
            type="button"
            className="chip toolbar-unconnected"
            data-hue="4"
            aria-label={t("toolbar.unconnectedAria", { count: unconnected })}
            onClick={onOpenUnconnected}
          >
            {t("toolbar.unconnected", { count: unconnected })}
          </button>
        )}
        <SaveStatus autosaver={autosaver} />
        <CloudStatus />
        <PresenceAvatars />
      </div>

      <div className="toolbar-dock">
        <div className="toolbar-group toolbar-views">
          <ViewSwitcher />
        </div>
        <div className="toolbar-group toolbar-primary">
          <AddPersonButton />
          <IconButton
            icon="search"
            label={t("toolbar.search")}
            hint={t("toolbar.hint.search")}
            shortcut={shortcutLabel("F")}
            onClick={onOpenSearch}
          />
        </div>
      </div>

      <div className="toolbar-group toolbar-tools">
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a labelled group of buttons */}
        <div className="zoom-cluster" role="group" aria-label={t("toolbar.zoom")}>
          <IconButton
            icon="zoomOut"
            label={t("toolbar.zoomOut")}
            hint={t("toolbar.hint.zoomOut")}
            shortcut={t("toolbar.hint.zoomKeys")}
            onClick={onZoomOut}
          />
          <IconButton
            icon="fit"
            label={t("toolbar.fit")}
            hint={t("toolbar.hint.fit")}
            onClick={onFit}
          />
          <IconButton
            icon="zoomIn"
            label={t("toolbar.zoomIn")}
            hint={t("toolbar.hint.zoomIn")}
            shortcut={t("toolbar.hint.zoomKeys")}
            onClick={onZoomIn}
          />
        </div>
        <div className="toolbar-history">
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
            align="end"
            onClick={() => store.getState().redo()}
          />
        </div>
        {canShare && (
          <IconButton
            icon="share"
            label={t("share.button")}
            hint={t("share.hint")}
            onClick={() => setSharing("share")}
          />
        )}
        <MoreMenu
          onSaveToAccount={canShare ? () => setSharing("account") : undefined}
          onOpenExport={onOpenExport}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleRelation={onToggleRelation}
          onShowPerson={onShowPerson}
          today={today}
        />
      </div>

      <div className="toolbar-context">
        {viewRootId !== null && (
          <button
            type="button"
            className="breadcrumb"
            onClick={() => store.getState().setViewRoot(null)}
          >
            <Trans i18nKey="toolbar.backTo" components={{ name: <bdi>{rootName}</bdi> }} />
          </button>
        )}
        <FocusControl />
        <FanGenerations />
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {sharing && <ShareDialog mode={sharing} onClose={() => setSharing(null)} />}
    </header>
  );
}
