import "./treeList.css";

import { type ChangeEvent, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useStore } from "zustand";

import { type Api, api as defaultApi } from "@/cloud/api";
import { authStore } from "@/cloud/auth";
import { openOwnedTree, uploadAndShare } from "@/cloud/linkTrees";
import { APP_NAME, TUNED_PEOPLE } from "@/config";
import { applyCommand } from "@/core/commands/apply";
import { createTree } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";
import type { GedcomReport } from "@/io/gedcom";
import { remapPhotoIds } from "@/io/json/remapPhotos";
import { ImportError, importStamJson } from "@/io/json/stamJson";
import { recoverAllPending } from "@/storage/journal";
import { announceTreeChange } from "@/storage/multitab";
import { requestPersistentStorage } from "@/storage/persist";
import { cleanUpUnusedPhotos } from "@/storage/photoCleanup";
import type { TreeMeta } from "@/storage/treeRepo";
import { Button, EmptyState, Icon, IconButton } from "@/ui/design";
import { SettingsDialog } from "@/ui/settings/SettingsDialog";

import { BackupBanner } from "./BackupBanner";
import { isBackupDue } from "./backupState";
import { ConfirmDialog, Dialog, NamePrompt } from "./Dialog";
import { downloadBackup } from "./downloadBackup";
import { GedcomReportDialog } from "./GedcomReportDialog";
import { useRepo } from "./RepoContext";
import { StorageBanner } from "./StorageBanner";
import { type TreeAction, TreeCard } from "./TreeCard";

/** Files bigger than this are refused before they are read into memory. */
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** A GEDCOM file starts with its header, whatever it is called. */
const GEDCOM_START = /^\uFEFF?\s*0[ \t]+HEAD\b/i;

type DialogState =
  | { kind: "new" }
  | { kind: "rename"; tree: TreeMeta }
  | { kind: "delete"; tree: TreeMeta }
  | { kind: "removeFromAccount"; tree: TreeMeta };

export function TreeListPage({
  afterImport: afterImportProp,
  api = defaultApi,
  auth = authStore,
}: {
  /** Runs after an imported GEDCOM tree is saved; by default, the unused-photo clean-up. */
  afterImport?: () => Promise<void>;
  api?: Api;
  auth?: typeof authStore;
} = {}) {
  const { t } = useTranslation();
  const repo = useRepo();
  // Like the JSON import and delete paths: photos no tree, snapshot or unsaved edit uses go.
  const afterImport = afterImportProp ?? (() => cleanUpUnusedPhotos(repo));
  const navigate = useNavigate();
  const [trees, setTrees] = useState<TreeMeta[] | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [backupDue, setBackupDue] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [largeGedcom, setLargeGedcom] = useState<{
    doc: TreeDocument;
    report: GedcomReport;
    people: number;
  } | null>(null);
  const [gedcomImport, setGedcomImport] = useState<{ treeId: string; report: GedcomReport } | null>(
    null,
  );

  const me = useStore(auth, (s) => s.me);
  // Asks the server only when this browser has signed in before (spec D14).
  useEffect(() => {
    void auth.getState().refresh();
  }, [auth]);

  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  useEffect(() => {
    let current = true;
    void (async () => {
      // Edits a closed tab never got into IndexedDB are restored before the list is read.
      await recoverAllPending(repo).catch(() => {});
      const list = await repo.listTrees().catch(() => null);
      const due = await isBackupDue(repo).catch(() => false);
      if (!current) return;
      setTrees(list ?? []);
      if (list === null) setMessage(t("treeList.loadFailed"));
      setBackupDue(due);
    })();
    return () => {
      current = false;
    };
    // `version` is the reload trigger: `refresh` bumps it to read the repo again.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [repo, t, version]);

  /** Runs a repo action, then reloads the list. A failure shows a message instead. */
  async function act(action: () => Promise<unknown>) {
    setMessage(null);
    try {
      await action();
    } catch {
      setMessage(t("treeList.actionFailed"));
    }
    refresh();
  }

  /** The first tree is the moment to ask the browser to keep our data (FR-S3). */
  async function askToPersistIfFirst() {
    if ((await repo.listTrees()).length === 0) await requestPersistentStorage();
  }

  async function onCreate(name: string) {
    setDialog(null);
    await act(async () => {
      await askToPersistIfFirst();
      await repo.saveTree(createTree(name));
    });
  }

  /** GEDCOM: decoded from bytes (it may be ANSEL or Latin-1), saved, then its report is shown. */
  async function importGedcomFile(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { importGedcom } = await import("@/io/gedcom");
    const name = file.name.replace(/\.[^.]*$/, "").trim() || t("treeList.defaultName");
    const imported = importGedcom(bytes, { name });
    const people = Object.keys(imported.doc.persons).length;
    if (people > TUNED_PEOPLE) setLargeGedcom({ ...imported, people });
    else await saveGedcom(imported);
  }

  async function saveGedcom({ doc, report }: { doc: TreeDocument; report: GedcomReport }) {
    await askToPersistIfFirst();
    await repo.saveTree(doc);
    // Housekeeping only: the tree is saved, so a failure here must not fail the import.
    await afterImport().catch(() => {});
    setGedcomImport({ treeId: doc.id, report });
    refresh();
  }

  async function onImport(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // so choosing the same file again still fires
    if (!file) return;
    setMessage(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setMessage(t("app.import.error.TOO_LARGE"));
      return;
    }
    try {
      if (/\.ged$/i.test(file.name)) {
        await importGedcomFile(file);
        return;
      }
      const text = await file.text();
      if (GEDCOM_START.test(text)) {
        await importGedcomFile(file);
        return;
      }
      const imported = await importStamJson(text);
      await askToPersistIfFirst();
      // An import must never overwrite a stored photo or point at one from another tree.
      const { doc, photos } = await remapPhotoIds(
        imported.doc,
        imported.photos,
        async (photoId) => (await repo.getPhoto(photoId)) !== undefined,
      );
      for (const [photoId, blob] of Object.entries(photos)) await repo.putPhoto(photoId, blob);
      await repo.saveTree(doc);
      // Photos of deleted trees, or of an import that failed half way, have nothing to show.
      await cleanUpUnusedPhotos(repo).catch(() => {});
      // The editor opens next, so a skipped-photo notice rides along as navigation state.
      await navigate(`/app/t/${doc.id}`, {
        state: {
          skippedPhotos: imported.warnings.filter((w) => w.code === "PHOTO_DROPPED").length,
        },
      });
    } catch (e) {
      setMessage(
        t(e instanceof ImportError ? `app.import.error.${e.code}` : "app.import.error.UNKNOWN"),
      );
    }
  }

  async function onBackup(tree: TreeMeta) {
    await act(async () => {
      const found = await repo.getTree(tree.id);
      if (!found) throw new Error("tree is gone");
      await downloadBackup(repo, found.doc, { includePhotos: true });
    });
    // `act` reloads the list, and with it the backup reminder.
  }

  const defaultName = t("treeList.defaultName");

  /** Saves a local tree to the account; signs in first when nobody is (back to the list). */
  function saveToAccount(tree: TreeMeta) {
    if (auth.getState().status !== "signedIn") {
      location.assign(api.signInUrl("/app"));
      return;
    }
    void act(async () => {
      const found = await repo.getTree(tree.id);
      if (!found) throw new Error("tree is gone");
      const { failedPhotos } = await uploadAndShare(found.doc, { repo, api });
      if (failedPhotos.length > 0)
        setMessage(t("share.photosFailed", { count: failedPhotos.length }));
    });
  }

  function onAction(action: TreeAction, tree: TreeMeta) {
    if (action === "saveToAccount") saveToAccount(tree);
    else if (action === "rename" || action === "delete" || action === "removeFromAccount")
      setDialog({ kind: action, tree });
    else if (action === "backup") void onBackup(tree);
    else void act(() => repo.duplicateTree(tree.id, t("treeList.copyName", { name: tree.name })));
  }

  const hasTrees = trees !== null && trees.length > 0;
  // Mine (local, or saved to my account) apart from trees others shared with me by a link, and
  // account trees this browser does not have yet.
  const mine = (trees ?? []).filter((tree) => !tree.cloud || tree.cloud.role === "owner");
  const shared = (trees ?? []).filter((tree) => tree.cloud && tree.cloud.role !== "owner");
  const inAccount = (me?.trees ?? []).filter(
    (tree) => !trees?.some((local) => local.id === tree.id),
  );
  const newTree = (
    <Button variant="primary" icon="plus" onClick={() => setDialog({ kind: "new" })}>
      {t("treeList.newTree")}
    </Button>
  );
  const importButton = (
    <label className="button file-button">
      <Icon name="upload" />
      {t("treeList.import")}
      <input
        type="file"
        accept=".json,application/json,.ged"
        className="visually-hidden"
        onChange={(event) => void onImport(event)}
      />
    </label>
  );

  return (
    <main className="page tree-list-page" id="main">
      <header className="page-header tree-list-header">
        {/* The landing page is another document: a full navigation, not a router link. */}
        <a href="/" className="brand" aria-label={t("app.home", { app: APP_NAME })}>
          {APP_NAME}
        </a>
        <div className="page-header-actions">
          <IconButton
            icon="settings"
            label={t("settings.open")}
            showLabel
            className="tree-list-header__settings"
            onClick={() => setSettingsOpen(true)}
          />
          {hasTrees && importButton}
          {hasTrees && newTree}
          {me && (
            <span className="tree-list-account">
              <Trans i18nKey="cloud.signedInAs" components={{ name: <bdi>{me.user.name}</bdi> }} />{" "}
              <button
                type="button"
                className="button button-quiet"
                onClick={() => void auth.getState().signOut()}
              >
                {t("cloud.signOut")}
              </button>
            </span>
          )}
        </div>
      </header>

      <div className="tree-list-notices">
        <StorageBanner />
        {backupDue && <BackupBanner onDismiss={() => setBackupDue(false)} />}
        {message && (
          <p className="notice" role="alert">
            {message}
          </p>
        )}
      </div>

      <h1 className="page-title">{t("treeList.title")}</h1>

      {trees?.length === 0 && (
        <EmptyState
          className="tree-list-empty"
          title={t("treeList.empty")}
          actions={
            <>
              {newTree}
              {importButton}
            </>
          }
        >
          <p>{t("treeList.emptyHint")}</p>
        </EmptyState>
      )}

      {hasTrees && mine.length > 0 && (
        <ul className="tree-grid">
          {mine.map((tree) => (
            <TreeCard key={tree.id} tree={tree} onAction={onAction} />
          ))}
        </ul>
      )}

      {shared.length > 0 && (
        <section aria-labelledby="shared-with-me">
          <h2 className="page-subtitle" id="shared-with-me">
            {t("treeList.sharedWithMe")}
          </h2>
          <ul className="tree-grid">
            {shared.map((tree) => (
              <TreeCard key={tree.id} tree={tree} onAction={onAction} />
            ))}
          </ul>
        </section>
      )}

      {inAccount.length > 0 && (
        <section aria-labelledby="in-your-account">
          <h2 className="page-subtitle" id="in-your-account">
            {t("treeList.inAccount")}
          </h2>
          <ul className="tree-account-list">
            {inAccount.map((tree) => (
              <li key={tree.id}>
                <bdi>{tree.name}</bdi>{" "}
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    void act(async () => {
                      await openOwnedTree(tree.id, { repo });
                      void navigate(`/app/t/${tree.id}`);
                    })
                  }
                >
                  {t("treeList.open")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {largeGedcom && (
        <Dialog title={t("app.import.gedcom.largeTitle")} onClose={() => setLargeGedcom(null)}>
          <p className="dialog-body">
            {t("app.import.gedcom.large", {
              count: largeGedcom.people,
              app: APP_NAME,
              max: TUNED_PEOPLE,
            })}
          </p>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => setLargeGedcom(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                const imported = largeGedcom;
                setLargeGedcom(null);
                void saveGedcom(imported).catch(() => setMessage(t("app.import.error.UNKNOWN")));
              }}
            >
              {t("app.import.gedcom.continue")}
            </button>
          </div>
        </Dialog>
      )}
      {gedcomImport && (
        <GedcomReportDialog
          report={gedcomImport.report}
          onOpen={() => void navigate(`/app/t/${gedcomImport.treeId}`)}
          onClose={() => setGedcomImport(null)}
        />
      )}
      {dialog?.kind === "new" && (
        <NamePrompt
          title={t("treeList.newDialogTitle")}
          initial={defaultName}
          confirmLabel={t("common.create")}
          onConfirm={(name) => void onCreate(name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename" && (
        <NamePrompt
          title={t("treeList.renameDialogTitle")}
          initial={dialog.tree.name}
          confirmLabel={t("common.save")}
          onConfirm={(name) => {
            const { tree } = dialog;
            setDialog(null);
            void act(async () => {
              const found = await repo.getTree(tree.id);
              if (!found) throw new Error("tree is gone");
              const { doc } = applyCommand(found.doc, { type: "renameTree", name }, new Date());
              // Guarded: a tab that saved in between is not overwritten (the rename fails).
              await repo.saveTree(doc, { ifSavedAt: found.savedAt });
              // An editor open on this tree in another tab now holds a stale copy.
              announceTreeChange(tree.id, "renamed");
            });
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={t("treeList.deleteDialogTitle")}
          message={
            <Trans
              i18nKey="treeList.deleteDialogBody"
              components={{ name: <bdi>{dialog.tree.name}</bdi> }}
            />
          }
          confirmLabel={t("common.delete")}
          onConfirm={() => {
            const { tree } = dialog;
            setDialog(null);
            void act(async () => {
              await repo.deleteTree(tree.id);
              announceTreeChange(tree.id, "deleted");
              // Its photos go too, unless another tree uses them. A failure here is harmless.
              await cleanUpUnusedPhotos(repo).catch(() => {});
            });
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "removeFromAccount" && (
        <ConfirmDialog
          title={t("cloud.removeConfirmTitle")}
          message={t("cloud.removeConfirmBody")}
          confirmLabel={t("cloud.removeFromAccount")}
          onConfirm={() => {
            const { tree } = dialog;
            setDialog(null);
            void act(async () => {
              await api.deleteCloudTree(tree.id);
              await repo.setCloud(tree.id, null);
            });
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </main>
  );
}
