import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import { newId } from "@/core/model/ids";
import type { Person } from "@/core/model/types";
import { Icon } from "@/ui/app/Icon";
import { useRepo } from "@/ui/app/RepoContext";
import { Avatar } from "@/ui/design/Avatar";
import { IconButton } from "@/ui/design/IconButton";
import { resizePhoto } from "@/ui/photos/resizePhoto";
import { usePhotoUrl } from "@/ui/photos/usePhotoUrl";
import { useEditorStore } from "@/ui/store/useEditor";

import { personLabel } from "./fields";

type PersonPhotoProps = {
  person: Person;
  readOnly?: boolean;
  /** A photo that could not be used (true), or a new attempt (false). */
  onFailed: (failed: boolean) => void;
};

/**
 * The portrait in the profile header: the photo, or warm initials, mounted like a print in an
 * album with four paper corners. Tapping it picks a new photo; a small button removes it.
 */
export function PersonPhoto({ person, readOnly = false, onFailed }: PersonPhotoProps) {
  const { t } = useTranslation();
  const repo = useRepo();
  const store = useEditorStore();
  const url = usePhotoUrl(person.photoId);
  const hasPhoto = person.photoId !== undefined;
  const name = personLabel(person, t("panel.unnamed"));
  // A photo whose blob is gone shows the initials rather than a broken image.
  const photoUrl = hasPhoto ? url : undefined;

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // choosing the same file again must fire another change
    if (!file) return;
    onFailed(false);
    try {
      const blob = await resizePhoto(file);
      const photoId = newId();
      await repo.putPhoto(photoId, blob);
      store
        .getState()
        .dispatch({ type: "updatePerson", personId: person.id, patch: { photoId } }, "Add photo");
    } catch {
      onFailed(true);
    }
  }

  const avatar = (
    <Avatar
      name={name}
      size="xl"
      className="portrait__photo"
      {...(photoUrl ? { photoUrl } : {})}
      {...(readOnly && photoUrl ? { label: name } : {})}
    />
  );

  if (readOnly) {
    return (
      <div className="portrait">
        <span className="portrait__mount">{avatar}</span>
      </div>
    );
  }

  const pickLabel = hasPhoto ? t("panel.photoChange") : t("panel.photo.upload");
  return (
    <div className="portrait">
      <label className="portrait__mount portrait__mount--pick" title={pickLabel}>
        {avatar}
        <span className="portrait__badge" aria-hidden="true">
          <Icon name="photo" size={14} />
        </span>
        <input
          type="file"
          accept="image/*"
          className="visually-hidden"
          aria-label={pickLabel}
          onChange={(event) => void upload(event)}
        />
      </label>
      {hasPhoto && (
        <IconButton
          icon="close"
          size="sm"
          className="portrait__remove"
          label={t("panel.photo.remove")}
          title={t("panel.photo.remove")}
          onClick={() =>
            store
              .getState()
              .dispatch(
                { type: "updatePerson", personId: person.id, patch: { photoId: undefined } },
                "Remove photo",
              )
          }
        />
      )}
    </div>
  );
}
