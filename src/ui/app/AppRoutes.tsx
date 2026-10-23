import { useTranslation } from "react-i18next";
import { Link, Route, Routes } from "react-router";

import { EditorPage } from "./EditorPage";
import { SkipLink } from "./SkipLink";
import { TreeListPage } from "./TreeListPage";

function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="page">
      <h1 className="page-title">{t("app.notFound.title")}</h1>
      <p>
        <Link to="/app">{t("app.notFound.link")}</Link>
      </p>
    </main>
  );
}

export function AppRoutes() {
  return (
    <>
      <SkipLink />
      <Routes>
        <Route path="/app" element={<TreeListPage />} />
        <Route path="/app/t/:treeId" element={<EditorPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
