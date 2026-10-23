import { useEffect } from "react";
import { Trans, useTranslation } from "react-i18next";

import { descendantsOf } from "@/core/model/tree";
import { Dialog } from "@/ui/app/Dialog";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { personLabel } from "./fields";

type DeleteDialogProps = { personId: string; onClose: () => void };

/** FR-P5: delete the person alone, or with everyone below them. Both are one undo step. */
export function DeleteDialog({ personId, onClose }: DeleteDialogProps) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const person = doc?.persons[personId];

  useEffect(() => {
    if (!person) onClose();
  }, [person, onClose]);
  if (!doc || !person) return null;

  const name = personLabel(person, t("panel.unnamed"));
  const descendants = descendantsOf(doc, personId).size;

  function remove(mode: "person" | "withDescendants") {
    store.getState().dispatch({ type: "deletePerson", personId, mode }, "Delete person");
    onClose();
  }

  return (
    <Dialog
      title={<Trans i18nKey="panel.deleteDialog.title" components={{ name: <bdi>{name}</bdi> }} />}
      onClose={onClose}
    >
      <p className="dialog-body">{t("panel.deleteDialog.body")}</p>
      <div className="dialog-actions dialog-actions-stacked">
        {/* Cancel comes first so it has the initial focus: Enter must never delete. */}
        <button type="button" className="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className="button button-danger" onClick={() => remove("person")}>
          {/* The span keeps the text in one inline run; the button itself is a flex box. */}
          <span>
            <Trans i18nKey="panel.deleteDialog.only" components={{ name: <bdi>{name}</bdi> }} />
          </span>
        </button>
        {descendants > 0 && (
          <button
            type="button"
            className="button button-danger"
            onClick={() => remove("withDescendants")}
          >
            <span>
              <Trans
                i18nKey="panel.deleteDialog.withDescendants"
                count={descendants}
                components={{ name: <bdi>{name}</bdi> }}
              />
            </span>
          </button>
        )}
      </div>
    </Dialog>
  );
}
