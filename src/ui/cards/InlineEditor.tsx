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

import { DEFAULT_METRICS } from "@/core/layout/constants";
import { Icon } from "@/ui/app/Icon";
import type { Rect } from "@/ui/canvas/viewport";
import { focusCard } from "@/ui/keyboard/focusCard";
import type { EditorStore } from "@/ui/store/editorStore";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { personLabel } from "./describe";
import { genderForNewPerson, loadNameGenders } from "./genderFromName";
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
 * Names a person that a quick-add handle just created: one name field and ✓ ✕, drawn over the new
 * card. Everything else about the person is in the side panel. The gender is filled in (the
 * family's, else the first name's, see `genderForNewPerson`), and the new person is selected, so
 * the panel shows them. Enter confirms into the add's own undo step; Esc, or Enter on a blank
 * name, takes the whole add back.
 */
export function InlineEditor({ personId, role, fromId, rect }: InlineEditorProps) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const from = useEditor((s) => (fromId ? s.doc?.persons[fromId] : undefined));
  const { cardW } = useEditor((s) => s.layout?.metrics ?? DEFAULT_METRICS);
  const [name, setName] = useState("");
  // The family's answer, if it has one: a spouse is the opposite of their partner.
  const [fromFamily] = useState(() => {
    const doc = store.getState().doc;
    return doc ? suggestedGender(doc, role, fromId, personId) : null;
  });
  /** The first-name list, once it has loaded (it is fetched when the editor opens). */
  const byName = useRef<Awaited<ReturnType<typeof loadNameGenders>> | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  /** Set once the editor has confirmed or cancelled, so the blur that follows does nothing. */
  const closed = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    let live = true;
    loadNameGenders()
      .then((lookup) => {
        if (live) byName.current = lookup;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  function cancel() {
    closed.current = true;
    const s = store.getState();
    s.cancelLastAdd();
    s.stopEditing();
    focusAfterClose(store, fromId);
  }

  /** Names the person (a blank name takes the add back) and selects them for the panel. */
  function confirm(): void {
    const parsed = parseNameEntry(
      name,
      role === "child" || role === "sibling" || role === "between" ? (from?.lastName ?? "") : "",
    );
    if (!parsed) {
      cancel();
      return;
    }
    closed.current = true;
    const gender = genderForNewPerson(fromFamily, parsed.firstName, byName.current);
    const s = store.getState();
    s.amendLast({ type: "updatePerson", personId, patch: { ...parsed, gender } }, "Name person");
    s.stopEditing();
    s.select(personId);
    focusAfterClose(store, personId);
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    confirm();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Esc belongs to the editor: the page must not also clear the selection.
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };

  // Leaving the editor (a click elsewhere) confirms a typed name and drops a blank one. Losing the
  // window's focus changes nothing.
  const onBlur = (e: FocusEvent) => {
    if (closed.current || formRef.current?.contains(e.relatedTarget as Node | null)) return;
    if (!document.hasFocus()) return;
    confirm();
  };

  const fromName = from ? personLabel(from, t) : "";
  // The editor sits on the card's spot, as wide as the card and one row high, scaled with the zoom
  // but never below 100 %, so the name stays easy to type when zoomed out.
  const scale = Math.min(Math.max(rect.width / cardW, 1), MAX_SCALE);

  return (
    <form
      className="inline-editor"
      aria-label={t(`handles.editor.${role}`, { name: fromName })}
      style={{
        inlineSize: cardW,
        transform: `translate(${rect.x + rect.width / 2}px, ${rect.y + rect.height / 2}px) translate(-50%, -50%) scale(${scale})`,
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
        placeholder={t("handles.namePlaceholder")}
        value={name}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <span className="inline-editor__actions">
        <button
          type="submit"
          className="inline-editor__ok"
          aria-label={t("handles.confirm")}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        >
          <Icon name="check" size={18} />
        </button>
        <button
          type="button"
          className="inline-editor__cancel"
          aria-label={t("handles.cancel")}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          onClick={cancel}
        >
          <Icon name="close" size={18} />
        </button>
      </span>
    </form>
  );
}
