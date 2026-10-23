import "./handles.css";

import { useTranslation } from "react-i18next";

import { EmptyState } from "@/ui/design/EmptyState";
import { useEditorStore } from "@/ui/store/useEditor";

import { startAdd } from "./quickAdd";

/**
 * An empty tree: a warm album page in the middle of the canvas, with one empty photo slot,
 * "Start with a person". It adds the first person at once and the canvas opens the inline editor
 * on them (gender must be chosen).
 */
export function StartCard() {
  const { t } = useTranslation();
  const store = useEditorStore();
  return (
    <div className="start-card-area">
      <EmptyState
        className="start-page"
        title={t("canvas.empty.title")}
        actions={
          <button type="button" className="start-card" onClick={() => startAdd(store, "first")}>
            <span className="start-card__plus" aria-hidden="true">
              +
            </span>
            <span className="start-card__label">{t("handles.start")}</span>
          </button>
        }
      >
        <p>{t("canvas.empty.body")}</p>
      </EmptyState>
      <p className="start-card__hint">{t("handles.startHint")}</p>
    </div>
  );
}
