import { type ChangeEvent, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { APP_NAME } from "@/config";
import { applyCommand } from "@/core/commands/apply";
import { createTree } from "@/core/model/tree";
import { remapPhotoIds } from "@/io/json/remapPhotos";
import { ImportError, importStamJson } from "@/io/json/stamJson";
import { recoverAllPending } from "@/storage/journal";
import { announceTreeChange } from "@/storage/multitab";
import { requestPersistentStorage } from "@/storage/persist";
import type { TreeMeta } from "@/storage/treeRepo";

import { BackupBanner } from "./BackupBanner";
import { isBackupDue } from "./backupState";
import { ConfirmDialog, NamePrompt } from "./Dialog";
import { downloadBackup } from "./downloadBackup";
import { relativeTime } from "./relativeTime";
import { useRepo } from "./RepoContext";
import { StorageBanner } from "./StorageBanner";

/** Files bigger than this are refused before they are read into memory. */
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

type DialogState =
  { kind: "new" } | { kind: "rename"; tree: TreeMeta } | { kind: "delete"; tree: TreeMeta };

export function TreeListPage() {
  const { t, i18n } = useTranslation();
  const repo = useRepo();
  const navigate = useNavigate();
  const [trees, setTrees] = useState<TreeMeta[] | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [backupDue, setBackupDue] = useState(false);

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
      const imported = await importStamJson(await file.text());
      await askToPersistIfFirst();
      // An import must never overwrite a stored photo or point at one from another tree.
      const { doc, photos } = await remapPhotoIds(
        imported.doc,
        imported.photos,
        async (photoId) => (await repo.getPhoto(photoId)) !== undefined,
      );
      for (const [photoId, blob] of Object.entries(photos)) await repo.putPhoto(photoId, blob);
      await repo.saveTree(doc);
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

  return (
    <main className="page">
      <header className="page-header">
        <p className="brand">{APP_NAME}</p>
        <div className="page-header-actions">
          <label className="button file-button">
            {t("treeList.import")}
            <input
              type="file"
              accept=".json,application/json"
              className="visually-hidden"
              onChange={(event) => void onImport(event)}
            />
          </label>
          <button
            type="button"
            className="button button-primary"
            onClick={() => setDialog({ kind: "new" })}
          >
            {t("treeList.newTree")}
          </button>
        </div>
      </header>

      <StorageBanner />
      {backupDue && <BackupBanner onDismiss={() => setBackupDue(false)} />}
      {message && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}

      <h1 className="page-title">{t("treeList.title")}</h1>

      {trees?.length === 0 && (
        <section className="empty">
          <p className="empty-title">{t("treeList.empty")}</p>
          <p className="muted">{t("treeList.emptyHint")}</p>
        </section>
      )}

      {trees && trees.length > 0 && (
        <ul className="tree-list">
          {trees.map((tree) => (
            <li key={tree.id} className="tree-row">
              <Link to={`/app/t/${tree.id}`} className="tree-link">
                <bdi className="tree-name">{tree.name}</bdi>
                <span className="tree-meta">
                  <span>{t("treeList.people", { count: tree.peopleCount })}</span>
                  <span>
                    {t("treeList.edited", { when: relativeTime(tree.updatedAt, i18n.language) })}
                  </span>
                </span>
              </Link>
              <div className="tree-actions">
                <button
                  type="button"
                  className="button button-quiet"
                  aria-label={t("treeList.renameAria", { name: tree.name })}
                  onClick={() => setDialog({ kind: "rename", tree })}
                >
                  {t("treeList.rename")}
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  aria-label={t("treeList.duplicateAria", { name: tree.name })}
                  onClick={() =>
                    void act(() =>
                      repo.duplicateTree(tree.id, t("treeList.copyName", { name: tree.name })),
                    )
                  }
                >
                  {t("treeList.duplicate")}
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  aria-label={t("treeList.backupAria", { name: tree.name })}
                  onClick={() => void onBackup(tree)}
                >
                  {t("treeList.backup")}
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  aria-label={t("treeList.deleteAria", { name: tree.name })}
                  onClick={() => setDialog({ kind: "delete", tree })}
                >
                  {t("common.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
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
            });
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </main>
  );
}
