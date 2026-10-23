import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

function skip(event: MouseEvent<HTMLAnchorElement>) {
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return;
  event.preventDefault();
  if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
  main.focus();
}

/**
 * "Skip to content": the first tab stop on every /app page, hidden until it has the focus. It
 * moves the focus to the page's <main> (the tree list, or the editor's canvas and panel) instead
 * of changing the URL's hash, which the router would treat as a navigation.
 */
export function SkipLink() {
  const { t } = useTranslation();
  return (
    <a className="skip-link" href="#main" onClick={skip}>
      {t("app.skipToContent")}
    </a>
  );
}
