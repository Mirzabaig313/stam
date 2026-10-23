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

import type { Gender } from "@/core/model/types";
import type { Rect } from "@/ui/canvas/viewport";
import { focusCard } from "@/ui/keyboard/focusCard";
import type { EditorStore } from "@/ui/store/editorStore";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { personLabel } from "./describe";
import { type AddRole, parseNameEntry } from "./nameEntry";
import { suggestedGender } from "./quickAdd";

/** The editor covers the card, but stays usable when zoomed far out or in (screen px). */
const MIN_WIDTH = 200;
const MAX_WIDTH = 320;

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
      role === "child" || role === "sibling" ? (from?.lastName ?? "") : "",
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
  const required = gender === null;
  const messageId = `inline-editor-msg-${personId}`;

  return (
    <form
      className="inline-editor"
      aria-label={t(`handles.editor.${role}`, { name: fromName })}
      style={{
        transform: `translate(${rect.x}px, ${rect.y + rect.height / 2}px) translateY(-50%)`,
        inlineSize: Math.min(Math.max(rect.width, MIN_WIDTH), MAX_WIDTH),
      }}
      ref={formRef}
      onSubmit={onSubmit}
      data-editing-for={personId}
    >
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
      <div
        className={
          required
            ? "inline-editor__gender inline-editor__gender--required"
            : "inline-editor__gender"
        }
      >
        {(["male", "female"] as const).map((g) => (
          <button
            key={g}
            type="button"
            className="inline-editor__toggle"
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
      {needGender && (
        <p id={messageId} className="inline-editor__message" role="alert">
          {t("handles.chooseGender")}
        </p>
      )}
    </form>
  );
}
