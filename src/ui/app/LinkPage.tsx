import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";

import { type Api, api as defaultApi, ApiError } from "@/cloud/api";
import { openLink } from "@/cloud/linkTrees";
import type { connectRoom } from "@/cloud/transport";

import { useRepo } from "./RepoContext";

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
    openLink(token, { repo, api, ...(connect ? { connect } : {}) })
      .then(({ treeId }) => current && navigate(`/app/t/${treeId}`, { replace: true }))
      .catch((e: unknown) => {
        if (!current) return;
        setProblem(e instanceof ApiError && e.status >= 400 && e.status < 500 ? "off" : "offline");
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
