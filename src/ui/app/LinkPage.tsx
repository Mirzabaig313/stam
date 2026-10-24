import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";

import { type Api, api as defaultApi, ApiError } from "@/cloud/api";
import { openLink } from "@/cloud/linkTrees";
import type { connectRoom } from "@/cloud/transport";

import { useRepo } from "./RepoContext";

/** One opening per token at a time (React's StrictMode runs effects twice). */
const opening = new Map<string, Promise<{ treeId: string }>>();
function openOnce(token: string, open: () => Promise<{ treeId: string }>) {
  let pending = opening.get(token);
  if (!pending) {
    pending = open().finally(() => opening.delete(token));
    opening.set(token, pending);
  }
  return pending;
}

/**
 * A share link, `/s/<token>`: opens the shared tree on this device (no sign-in needed) and goes to
 * it, replacing the link in history so Back does not open it again.
 */
export function LinkPage({
  api = defaultApi,
  connect,
}: {
  api?: Api;
  connect?: typeof connectRoom;
}) {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const repo = useRepo();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<"off" | "offline" | null>(null);

  useEffect(() => {
    let current = true;
    openOnce(token, () => openLink(token, { repo, api, ...(connect ? { connect } : {}) }))
      .then(({ treeId }) => current && navigate(`/app/t/${treeId}`, { replace: true }))
      .catch(async (e: unknown) => {
        if (!current) return;
        const off = e instanceof ApiError && e.status >= 400 && e.status < 500;
        if (!off) {
          // Offline: a copy this device opened before still shows (read-only, spec §5.4).
          const cached = (await repo.listTrees().catch(() => [])).find(
            (tree) => tree.cloud?.token === token,
          );
          if (cached && current) {
            navigate(`/app/t/${cached.id}`, { replace: true });
            return;
          }
        }
        if (current) setProblem(off ? "off" : "offline");
      });
    return () => {
      current = false;
    };
  }, [token, repo, api, connect, navigate]);

  return (
    <main className="page" id="main">
      {problem === null ? (
        <output>{t("linkPage.opening")}</output>
      ) : (
        <>
          <p role="alert">{problem === "off" ? t("linkPage.off") : t("linkPage.offline")}</p>
          <p>
            <Link to="/app">{t("linkPage.back")}</Link>
          </p>
        </>
      )}
    </main>
  );
}
