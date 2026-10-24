import "./share.css";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useStore } from "zustand";

import { type Api, api as defaultApi, ApiError, type Link } from "@/cloud/api";
import { authStore as defaultAuth } from "@/cloud/auth";
import { removeFromAccount, retryPhotos, uploadAndShare } from "@/cloud/linkTrees";
import { ConfirmDialog, Dialog } from "@/ui/app/Dialog";
import { useRepo } from "@/ui/app/RepoContext";
import { Button, Chip } from "@/ui/design";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

type Confirm = "reset" | "hide" | "turnOff" | "stop" | null;

/**
 * Sharing a tree (spec §9): sign in, save the tree to the account (upload), then make, copy,
 * reset or turn off its view link, or stop sharing. `mode="account"` only saves to the account.
 */
export function ShareDialog({
  onClose,
  mode = "share",
  api = defaultApi,
  auth = defaultAuth,
}: {
  onClose: () => void;
  mode?: "share" | "account";
  api?: Api;
  auth?: typeof defaultAuth;
}) {
  const { t } = useTranslation();
  const repo = useRepo();
  const store = useEditorStore();
  const navigate = useNavigate();
  const doc = useEditor((s) => s.doc);
  const cloud = useEditor((s) => s.cloud);
  const status = useStore(auth, (s) => s.status);
  const [links, setLinks] = useState<Link[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const [hideLiving, setHideLiving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const treeId = doc?.id;
  const owned = cloud?.role === "owner";
  const view = links?.find((l) => l.role === "view");

  useEffect(() => {
    void auth.getState().refresh();
  }, [auth]);

  // Photos that did not upload last time are remembered with the tree (Retry below).
  useEffect(() => {
    if (!owned || !treeId) return;
    let current = true;
    void repo
      .getMeta(treeId)
      .then((meta) => current && setFailedPhotos(meta?.cloud?.failedPhotos ?? []))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [repo, owned, treeId]);

  const [linksTry, setLinksTry] = useState(0);
  useEffect(() => {
    if (!owned || !treeId || mode !== "share") return;
    let current = true;
    api
      .listLinks(treeId)
      .then((list) => {
        if (!current) return;
        setLinks(list);
        setHideLiving(list.find((l) => l.role === "view")?.hideLiving ?? false);
      })
      .catch(() => current && setFailed(t("share.failed")));
    return () => {
      current = false;
    };
    // `linksTry` is the retry trigger: Retry bumps it to ask for the links again.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [api, owned, treeId, mode, t, linksTry]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  /** Runs a server action with the busy state and one error message for any failure. */
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setFailed(null);
    try {
      await work();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) auth.getState().sessionLost();
      setFailed(t("share.failed"));
    } finally {
      setBusy(false);
    }
  }

  const upload = () =>
    act(async () => {
      if (!doc) return;
      // A save still waiting must not land after the upload (and bring back a re-id'd tree).
      await store.getState().flushSaves();
      const result = await uploadAndShare(doc, { repo, api });
      setFailedPhotos(result.failedPhotos);
      if (result.treeId !== doc.id) navigate(`/app/t/${result.treeId}`, { replace: true });
      else await store.getState().load(result.treeId);
      if (mode === "account" && result.failedPhotos.length === 0) onClose();
    });

  const retry = () =>
    act(async () => {
      if (treeId) setFailedPhotos(await retryPhotos(treeId, failedPhotos, { repo, api }));
    });

  const createLink = (hide: boolean) =>
    act(async () => {
      if (!treeId) return;
      const link = await api.createLink(treeId, { role: "view", hideLiving: hide });
      setLinks((list) => [...(list ?? []).filter((l) => l.role !== "view"), link]);
      setHideLiving(hide);
    });

  const turnOff = () =>
    act(async () => {
      if (!treeId || !view) return;
      await api.deleteLink(treeId, view.id);
      setLinks((list) => (list ?? []).filter((l) => l.id !== view.id));
    });

  const stopSharing = () =>
    act(async () => {
      if (!treeId) return;
      await removeFromAccount(treeId, { repo, api });
      await store.getState().load(treeId);
      onClose();
    });

  async function copy() {
    if (!view?.url) return;
    try {
      await navigator.clipboard.writeText(view.url);
      setCopied(true);
    } catch {
      setFailed(t("share.copyFailed"));
    }
  }

  let body;
  if (status === "unknown") {
    body = <p className="share-lead">{t("share.checking")}</p>;
  } else if (status === "signedOut") {
    body = (
      <>
        <p className="share-lead">{t("share.signInLead")}</p>
        {/* Back from Google, `?share=1` opens this dialog again on the same tree. */}
        <a className="button button-primary" href={api.signInUrl(`${location.pathname}?share=1`)}>
          {t("share.signIn")}
        </a>
      </>
    );
  } else if (!owned) {
    body = (
      <>
        <p className="share-lead">
          {mode === "account" ? t("share.accountLead") : t("share.uploadLead")}
        </p>
        <Button variant="primary" disabled={busy} onClick={() => void upload()}>
          {busy
            ? t("share.uploading")
            : mode === "account"
              ? t("cloud.saveToAccount")
              : t("share.upload")}
        </Button>
      </>
    );
  } else if (mode === "account") {
    body = <p className="share-lead">{t("share.savedLead")}</p>;
  } else {
    body = (
      <>
        <section className="share-row" aria-labelledby="share-view">
          <div className="share-row__head">
            <h3 id="share-view">{t("share.viewRow")}</h3>
            <p>{t("share.viewHint")}</p>
          </div>
          <label className="share-toggle">
            <input
              type="checkbox"
              checked={hideLiving}
              disabled={busy}
              onChange={(e) => (view ? setConfirm("hide") : setHideLiving(e.currentTarget.checked))}
            />
            <span>{t("share.hideLiving")}</span>
          </label>
          <p className="share-note">{t("share.hideLivingHint")}</p>
          {view ? (
            <div className="share-link">
              {view.url ? (
                <input
                  className="field share-link__url"
                  readOnly
                  value={view.url}
                  aria-label={t("share.linkLabel")}
                />
              ) : (
                <p className="share-note">{t("share.noUrl")}</p>
              )}
              <div className="share-actions">
                <Button variant="primary" disabled={busy || !view.url} onClick={() => void copy()}>
                  {t("share.copy")}
                </Button>
                <output>{copied && <Chip>{t("share.copied")}</Chip>}</output>
                <Button disabled={busy} onClick={() => setConfirm("reset")}>
                  {t("share.reset")}
                </Button>
                <Button disabled={busy} onClick={() => setConfirm("turnOff")}>
                  {t("share.turnOff")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="primary"
              disabled={busy || links === null}
              onClick={() => void createLink(hideLiving)}
            >
              {t("share.createLink")}
            </Button>
          )}
        </section>
        {(["commentRow", "editRow"] as const).map((row) => (
          <section key={row} className="share-row share-row--soon">
            <div className="share-row__head">
              <h3>{t(`share.${row}`)}</h3>
              <Chip>{t("share.comingSoon")}</Chip>
            </div>
          </section>
        ))}
        <section className="share-danger">
          <Button variant="danger" disabled={busy} onClick={() => setConfirm("stop")}>
            {t("share.stopSharing")}
          </Button>
        </section>
      </>
    );
  }

  return (
    <Dialog
      title={mode === "account" ? t("cloud.saveToAccount") : t("share.title")}
      onClose={onClose}
      className="share-dialog"
    >
      <div className="share-body">
        {body}
        {failedPhotos.length > 0 && (
          <output className="share-warning">
            <span>{t("share.photosFailed", { count: failedPhotos.length })}</span>
            <Button disabled={busy} onClick={() => void retry()}>
              {t("share.retry")}
            </Button>
          </output>
        )}
        {failed && (
          <p className="share-error" role="alert">
            {failed}{" "}
            {owned && links === null && (
              <Button onClick={() => (setFailed(null), setLinksTry((n) => n + 1))}>
                {t("share.retry")}
              </Button>
            )}
          </p>
        )}
      </div>
      {confirm === "reset" || confirm === "hide" ? (
        <ConfirmDialog
          title={t("share.resetConfirmTitle")}
          message={t("share.resetConfirmBody")}
          confirmLabel={t("share.reset")}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const hide = confirm === "hide" ? !hideLiving : hideLiving;
            setConfirm(null);
            void createLink(hide);
          }}
        />
      ) : null}
      {confirm === "turnOff" && (
        <ConfirmDialog
          title={t("share.turnOffConfirmTitle")}
          message={t("share.turnOffConfirmBody")}
          confirmLabel={t("share.turnOff")}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void turnOff();
          }}
        />
      )}
      {confirm === "stop" && (
        <ConfirmDialog
          title={t("share.stopConfirmTitle")}
          message={t("share.stopConfirmBody")}
          confirmLabel={t("share.stopConfirm")}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void stopSharing();
          }}
        />
      )}
    </Dialog>
  );
}
