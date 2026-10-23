import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { personLabel } from "@/ui/panels/fields";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

type UnconnectedListProps = {
  /** Called after the view root was set to the chosen person. */
  onPick?: (personId: string) => void;
  onClose: () => void;
};

/**
 * The popover behind the toolbar's "{n} not connected" badge: everyone the family view can't
 * reach from its root. Clicking a person shows their branch instead.
 */
export function UnconnectedList({ onPick, onClose }: UnconnectedListProps) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const unreachable = useEditor((s) => s.layout?.unreachable);
  const root = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // The badge toggles the list itself; closing here too would reopen it on the click.
      if (target?.closest(".badge") || root.current?.contains(target)) return;
      closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <section
      ref={root}
      className="popover unconnected-list"
      aria-label={t("panel.unconnected.title")}
    >
      <h2 className="popover-title">{t("panel.unconnected.title")}</h2>
      {unreachable && unreachable.length > 0 ? (
        <ul className="popover-list">
          {unreachable.map((id) => {
            const person = doc?.persons[id];
            if (!person) return null;
            return (
              <li key={id}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    store.getState().setViewRoot(id);
                    onPick?.(id);
                    onClose();
                  }}
                >
                  <bdi>{personLabel(person, t("panel.unnamed"))}</bdi>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">{t("panel.unconnected.none")}</p>
      )}
    </section>
  );
}
