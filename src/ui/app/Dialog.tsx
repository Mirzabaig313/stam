import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { IconButton } from "@/ui/design/IconButton";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled])";
/** The first control to focus on open: anything but the close button, which is the fallback. */
const FIRST_FOCUS = `:is(${FOCUSABLE}):not(.dialog-close)`;

/**
 * A modal on the native `<dialog>`: the browser traps Tab and inerts the page behind it.
 * Esc closes it, and focus goes back to whatever opened it.
 *
 * The shell (DESIGN-APP.md, "Dialog"): a header with the title and a visible close button, and
 * the content below it, which scrolls when the dialog is taller than the window; `.dialog-actions`
 * inside the content stick to its bottom. A dialog whose own actions already end with a button
 * named "Close" may leave the header's out (`closeButton={false}`), so there are never two.
 */
export function Dialog({
  title,
  onClose,
  children,
  closeButton = true,
  className,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  closeButton?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement as HTMLElement | null;
    element.showModal();
    // Browsers focus the first control themselves; do it explicitly so it is the same everywhere.
    (
      element.querySelector<HTMLElement>(FIRST_FOCUS) ??
      element.querySelector<HTMLElement>(FOCUSABLE)
    )?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); // the dialog is unmounted by `onClose`, not closed by the browser
      closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (element.open) element.close();
      opener?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={className ? `dialog ${className}` : "dialog"}
      aria-labelledby={titleId}
    >
      <div className="dialog-header">
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        {closeButton && (
          <IconButton
            className="dialog-close"
            icon="close"
            label={t("common.close")}
            onClick={() => closeRef.current()}
          />
        )}
      </div>
      <div className="dialog-content">{children}</div>
    </dialog>
  );
}

/** Asks for a tree name. An empty answer falls back to `initial`. */
export function NamePrompt({
  title,
  initial,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  initial: string;
  confirmLabel: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("name");
          onConfirm((typeof value === "string" ? value.trim() : "") || initial);
        }}
      >
        <label htmlFor={inputId} className="field-label">
          {t("common.treeName")}
        </label>
        <input
          id={inputId}
          name="name"
          className="field"
          defaultValue={initial}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="button button-primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="dialog-body">{message}</p>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className="button button-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
