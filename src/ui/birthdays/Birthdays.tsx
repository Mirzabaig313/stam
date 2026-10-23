import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { onThisDay, upcomingBirthdays } from "@/core/birthdays";
import { Icon } from "@/ui/app/Icon";
import { personLabel } from "@/ui/panels/fields";
import { useEditor } from "@/ui/store/useEditor";

/** The badge counts birthdays in this many days; the panel lists up to `LIST_DAYS`. */
export const BADGE_DAYS = 7;
export const LIST_DAYS = 30;

export type BirthdaysMenuProps = {
  /** Today, as the page sees it; tests pass a fixed date. */
  today?: () => Date;
  /** Select and centre this person. */
  onShow: (personId: string) => void;
};

/** "23 Oct": month and day, in the page's language. 2000 is a leap year, so Feb 29 exists. */
function dayLabel(language: string, date: { month: number; day: number }): string {
  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric" }).format(
    new Date(2000, date.month - 1, date.day),
  );
}

/** Upcoming birthdays (30 days), today's anniversaries, and how many fall in the next 7 days. */
export function useBirthdays(today: () => Date = () => new Date()) {
  const doc = useEditor((s) => s.doc);
  const now = today();
  const day = now.toDateString();
  // The list changes with the tree or the calendar day, not with every render.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const upcoming = useMemo(() => (doc ? upcomingBirthdays(doc, now, LIST_DAYS) : []), [doc, day]);
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const events = useMemo(() => (doc ? onThisDay(doc, now) : []), [doc, day]);
  const soon = upcoming.filter((b) => b.inDays <= BADGE_DAYS).length;
  return { upcoming, events, soon };
}

export type BirthdaysPanelProps = BirthdaysMenuProps & {
  /** Closes the panel (Esc, a press outside it, or a person picked). */
  onClose: () => void;
};

/**
 * The birthdays panel: upcoming birthdays and "On this day". It opens from the toolbar's More
 * menu and sits under it; Esc or a press outside closes it.
 */
export function BirthdaysPanel({ today = () => new Date(), onShow, onClose }: BirthdaysPanelProps) {
  const { t, i18n } = useTranslation();
  const doc = useEditor((s) => s.doc);
  const { upcoming, events } = useBirthdays(today);
  const root = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    root.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) closeRef.current();
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

  if (!doc) return null;
  const nameOf = (id: string) => {
    const person = doc.persons[id];
    return person ? personLabel(person, t("panel.unnamed")) : "";
  };
  const show = (id: string) => {
    onClose();
    onShow(id);
  };
  const when = (inDays: number) =>
    inDays === 0
      ? t("birthdays.today")
      : inDays === 1
        ? t("birthdays.tomorrow")
        : t("birthdays.inDays", { count: inDays });

  return (
    <section
      ref={root}
      tabIndex={-1}
      className="menu-panel birthdays-panel"
      aria-label={t("birthdays.title")}
    >
      <h2 className="birthdays-heading">
        <Icon name="cake" />
        {t("birthdays.title")}
      </h2>
      {upcoming.length === 0 ? (
        <p className="muted">{t("birthdays.none")}</p>
      ) : (
        <ul className="birthdays-list">
          {upcoming.map((b) => {
            const details = [
              dayLabel(i18n.language, b.date),
              ...(b.turning === null ? [] : [t("birthdays.turns", { count: b.turning })]),
              when(b.inDays),
            ].join(", ");
            return (
              <li key={b.personId}>
                <button
                  type="button"
                  className="birthdays-row"
                  aria-label={t("birthdays.showRow", { name: nameOf(b.personId), details })}
                  onClick={() => show(b.personId)}
                >
                  <bdi className="birthdays-name">{nameOf(b.personId)}</bdi>
                  {/* A space, so the visible text reads as words inside the label. */}{" "}
                  <span className="muted">{details}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {events.length > 0 && (
        <>
          <h2 className="birthdays-heading">{t("birthdays.onThisDay")}</h2>
          <ul className="birthdays-list">
            {events.map((e) => (
              <li key={`${e.kind}:${e.unionId ?? e.personId}`}>
                <button type="button" className="birthdays-row" onClick={() => show(e.personId)}>
                  <span>
                    {t(`birthdays.${e.kind}`, { name: nameOf(e.personId), year: e.year })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
