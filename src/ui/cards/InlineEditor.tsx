import "./handles.css";

import {
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { CARD_W } from "@/core/layout/constants";
import type { Gender } from "@/core/model/types";
import { Icon } from "@/ui/app/Icon";
import type { Rect } from "@/ui/canvas/viewport";
import { focusCard } from "@/ui/keyboard/focusCard";
import type { EditorStore } from "@/ui/store/editorStore";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { personLabel } from "./describe";
import { type AddRole, parseNameEntry } from "./nameEntry";
import { suggestedGender } from "./quickAdd";

/** The editor grows with the zoom up to this, and never shrinks below the card's own size. */
const MAX_SCALE = 1.5;

export type InlineEditorProps = {
  /** The person the add created, still unnamed. */
  personId: string;
  role: AddRole;
  /** The person whose handle was used; absent for the first person of a tree. */
  fromId?: string;
  /** The new card's box on screen, in px from the canvas's top-left corner. */
  rect: Rect;
};

/** After the editor closes, the keyboard lands on a card, or on the start card of an empty tree. */
function focusAfterClose(store: EditorStore, personId: string | undefined): void {
  const nodeId = personId && (store.getState().layout?.primaryNode[personId] ?? personId);
  if (nodeId && focusCard(nodeId)) return;
  requestAnimationFrame(() => {
    if (nodeId && focusCard(nodeId)) return;
    document.querySelector<HTMLElement>(".start-card")?.focus();
  });
}

/**
 * Names a person that a quick-add handle just created (clarifications 5–7): one "Name" field and
 * ♂/♀ toggles, drawn over the new card. Enter confirms into the add's own undo step; Esc, or
 * Enter on a blank name, takes the whole add back.
 */
export function InlineEditor({ personId, role, fromId, rect }: InlineEditorProps) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const from = useEditor((s) => (fromId ? s.doc?.persons[fromId] : undefined));
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender | null>(() => {
    const doc = store.getState().doc;
    return doc ? suggestedGender(doc, role, fromId, personId) : null;
  });
  const [needGender, setNeedGender] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  /** Set once the editor has confirmed or cancelled, so the blur that follows does nothing. */
  const closed = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function cancel() {
    closed.current = true;
    const s = store.getState();
    s.cancelLastAdd();
    s.stopEditing();
    focusAfterClose(store, fromId);
  }

  /** Confirms when the entry is complete; `false` when a gender is still missing. */
  function confirm(): boolean {
    const parsed = parseNameEntry(
      name,
      role === "child" || role === "sibling" || role === "between" ? (from?.lastName ?? "") : "",
    );
    if (!parsed) {
      cancel();
      return true;
    }
    if (!gender) {
      setNeedGender(true);
      return false;
    }
    closed.current = true;
    const s = store.getState();
    s.amendLast({ type: "updatePerson", personId, patch: { ...parsed, gender } }, "Name person");
    s.stopEditing();
    focusAfterClose(store, personId);
    return true;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!confirm()) inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Esc belongs to the editor: the page must not also clear the selection.
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };

  // Leaving the editor (a click elsewhere) confirms a complete entry and drops a blank one. With a
  // name but no gender it stays open and says why. Losing the window's focus changes nothing.
  const onBlur = (e: FocusEvent) => {
    if (closed.current || formRef.current?.contains(e.relatedTarget as Node | null)) return;
    if (!document.hasFocus()) return;
    confirm();
  };

  const choose = (g: Gender) => {
    setGender(g);
    setNeedGender(false);
    inputRef.current?.focus();
  };

  const fromName = from ? personLabel(from, t) : "";
  const messageId = `inline-editor-msg-${personId}`;
  // The editor takes the card's place: the card's own size and spot, scaled with the zoom but
  // never below 100 %, so the name stays easy to type when zoomed out.
  const scale = Math.min(Math.max(rect.width / CARD_W, 1), MAX_SCALE);

  return (
    <form
      className="inline-editor"
      aria-label={t(`handles.editor.${role}`, { name: fromName })}
      style={{
        transform: `translate(${rect.x + rect.width / 2}px, ${rect.y + rect.height / 2}px) translate(-50%, -50%) scale(${scale})`,
      }}
      ref={formRef}
      onSubmit={onSubmit}
      data-editing-for={personId}
    >
      <span className="inline-editor__avatar" aria-hidden="true">
        <Icon name="person" size={18} />
      </span>
      <input
        ref={inputRef}
        className="inline-editor__name"
        type="text"
        dir="auto"
        autoComplete="off"
        spellCheck={false}
        aria-label={t("handles.name")}
        aria-describedby={needGender ? messageId : undefined}
        placeholder={t("handles.name")}
        value={name}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <div className="inline-editor__row">
        {/* ♂ | ♀ in the design system's segmented pill; toggle buttons, so a missing choice
            stays visibly unpressed rather than a radio group with nothing checked. */}
        <div
          className={
            needGender
              ? "segmented inline-editor__gender inline-editor__gender--missing"
              : "segmented inline-editor__gender"
          }
        >
          {(["male", "female"] as const).map((g) => (
            <button
              key={g}
              type="button"
              className="segmented__option inline-editor__toggle"
              aria-label={t(`handles.${g}`)}
              aria-pressed={gender === g}
              onClick={() => choose(g)}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
            >
              <span aria-hidden="true">{g === "male" ? "♂" : "♀"}</span>
            </button>
          ))}
        </div>
        <span className="inline-editor__actions">
          <button
            type="submit"
            className="icon-button icon-button--sm inline-editor__ok"
            aria-label={t("handles.confirm")}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
          >
            <Icon name="check" />
          </button>
          <button
            type="button"
            className="icon-button icon-button--sm inline-editor__cancel"
            aria-label={t("handles.cancel")}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
            onClick={cancel}
          >
            <Icon name="close" />
          </button>
        </span>
      </div>
      {needGender && (
        <p id={messageId} className="chip inline-editor__hint" role="alert">
          {t("handles.chooseGender")}
        </p>
      )}
    </form>
  );
}
