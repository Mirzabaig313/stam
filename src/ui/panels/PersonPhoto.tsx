import { type ChangeEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { newId } from "@/core/model/ids";
import type { Person } from "@/core/model/types";
import { useRepo } from "@/ui/app/RepoContext";
import { resizePhoto } from "@/ui/photos/resizePhoto";
import { usePhotoUrl } from "@/ui/photos/usePhotoUrl";
import { useEditorStore } from "@/ui/store/useEditor";

import { personLabel } from "./fields";

/** The photo with its upload and remove buttons. */
export function PersonPhoto({ person }: { person: Person }) {
  const { t } = useTranslation();
  const repo = useRepo();
  const store = useEditorStore();
  const url = usePhotoUrl(person.photoId);
  const [failed, setFailed] = useState(false);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // choosing the same file again must fire another change
    if (!file) return;
    setFailed(false);
    try {
      const blob = await resizePhoto(file);
      const photoId = newId();
      await repo.putPhoto(photoId, blob);
      store
        .getState()
        .dispatch({ type: "updatePerson", personId: person.id, patch: { photoId } }, "Add photo");
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="panel-photo">
      {person.photoId !== undefined && url !== undefined ? (
        <img
          className="panel-photo-image"
          src={url}
          alt={personLabel(person, t("panel.unnamed"))}
        />
      ) : (
        <div className="panel-photo-image panel-photo-empty" aria-hidden="true" />
      )}
      <div className="panel-photo-actions">
        <label className="button file-button">
          {person.photoId === undefined ? t("panel.photo.upload") : t("panel.photo.replace")}
          <input
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={(event) => void upload(event)}
          />
        </label>
        {person.photoId !== undefined && (
          <button
            type="button"
            className="button button-quiet"
            onClick={() =>
              store
                .getState()
                .dispatch(
                  { type: "updatePerson", personId: person.id, patch: { photoId: undefined } },
                  "Remove photo",
                )
            }
          >
            {t("panel.photo.remove")}
          </button>
        )}
        {failed && (
          <p className="field-error" role="alert">
            {t("panel.photo.failed")}
          </p>
        )}
      </div>
    </div>
  );
}
