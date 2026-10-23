import { type KeyboardEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { lifespanLabel } from "@/core/dates/fuzzy";
import { searchPeople } from "@/core/search";
import { Dialog } from "@/ui/app/Dialog";
import { useEditor } from "@/ui/store/useEditor";

import { personLabel } from "./fields";

export type SearchBoxProps = {
  /** `search` finds someone to show; `picker` chooses a person for another action ("Move to…"). */
  mode?: "search" | "picker";
  /** Called with the chosen person. What happens next is the caller's business. */
  onPick: (personId: string) => void;
  onClose: () => void;
  /** People who must not be offered (picker mode: the person being moved and their descendants). */
  exclude?: ReadonlySet<string>;
};

/** A search-as-you-type list of people. Arrow keys move, Enter or a click picks, Esc closes. */
export function SearchBox({ mode = "search", onPick, onClose, exclude }: SearchBoxProps) {
  const { t } = useTranslation();
  const doc = useEditor((s) => s.doc);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    if (!doc) return [];
    // Over-fetch when something is excluded, so a full page of results can still be offered.
    const ids = searchPeople(doc, query, exclude ? 20 + exclude.size : 20);
    return ids.filter((id) => !exclude?.has(id)).slice(0, 20);
  }, [doc, query, exclude]);

  const current = Math.min(active, Math.max(results.length - 1, 0));

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const id = results[current];
      if (id !== undefined) onPick(id);
    }
  }

  const title = mode === "picker" ? t("panel.search.pickerTitle") : t("panel.search.title");

  return (
    <Dialog title={title} onClose={onClose}>
      <input
        type="search"
        className="field"
        aria-label={title}
        placeholder={t("panel.search.placeholder")}
        value={query}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul className="search-results" aria-label={t("panel.search.results")}>
        {results.map((id, index) => {
          const person = doc?.persons[id];
          if (!person) return null;
          const lifespan = lifespanLabel(person.birth?.date, person.death?.date, person.isLiving);
          return (
            <li key={id}>
              <button
                type="button"
                className="search-result"
                // The arrow keys move this mark; Enter in the input picks the marked person.
                aria-current={index === current ? "true" : undefined}
                // Keep the focus in the input; the click still lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(id)}
              >
                <bdi>{personLabel(person, t("panel.unnamed"))}</bdi>
                {lifespan !== "" && <span className="muted">{lifespan}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {query.trim() !== "" && results.length === 0 && (
        <p className="muted search-empty">{t("panel.search.none", { query: query.trim() })}</p>
      )}
    </Dialog>
  );
}
