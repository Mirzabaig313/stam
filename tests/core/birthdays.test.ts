import { describe, expect, test } from "bun:test";

import { onThisDay, presumedLiving, upcomingBirthdays } from "@/core/birthdays";

import { docOf, person, union } from "../fixtures/families";

const local = (y: number, m: number, d: number, hour = 15) => new Date(y, m - 1, d, hour);

function withBirths(
  ...births: [string, { year?: number; month?: number; day?: number }, boolean?][]
) {
  return docOf(
    births.map(([id, date, living = true]) =>
      person(id, id, "X", "male", { isLiving: living, birth: { date } }),
    ),
    [],
    births[0]?.[0],
  );
}

describe("upcomingBirthdays", () => {
  test("lists living people with a month and day, soonest first, with age and distance", () => {
    const doc = withBirths(
      ["later", { year: 1960, month: 11, day: 12 }],
      ["today", { year: 2000, month: 10, day: 23 }],
      ["soon", { year: 1960, month: 10, day: 26 }],
    );
    const out = upcomingBirthdays(doc, local(2026, 10, 23));
    expect(out.map((o) => [o.personId, o.inDays, o.turning])).toEqual([
      ["today", 0, 26],
      ["soon", 3, 66],
      ["later", 20, 66],
    ]);
    expect(out[1]?.date).toEqual({ month: 10, day: 26 });
  });

  test("skips the dead, people without a month or day, and anything past the window", () => {
    const doc = withBirths(
      ["dead", { year: 1950, month: 10, day: 24 }, false],
      ["yearOnly", { year: 1950 }],
      ["noDay", { year: 1950, month: 10 }],
      ["far", { year: 1950, month: 12, day: 30 }],
      ["ok", { year: 1950, month: 10, day: 24 }],
    );
    expect(upcomingBirthdays(doc, local(2026, 10, 23)).map((o) => o.personId)).toEqual(["ok"]);
    expect(upcomingBirthdays(doc, local(2026, 10, 23), 90).map((o) => o.personId)).toEqual([
      "ok",
      "far",
    ]);
  });

  test("turning is null without a birth year", () => {
    const doc = withBirths(["a", { month: 10, day: 25 }]);
    expect(upcomingBirthdays(doc, local(2026, 10, 23))[0]?.turning).toBeNull();
  });

  test("wraps over the new year", () => {
    const doc = withBirths(["ny", { year: 1990, month: 1, day: 2 }]);
    const [first] = upcomingBirthdays(doc, local(2026, 12, 30));
    expect(first).toMatchObject({ inDays: 3, turning: 37 });
  });

  test("Feb 29 falls on Mar 1 in a non-leap year and on Feb 29 in a leap year", () => {
    const doc = withBirths(["leap", { year: 2000, month: 2, day: 29 }]);
    expect(upcomingBirthdays(doc, local(2027, 2, 27))[0]).toMatchObject({
      date: { month: 3, day: 1 },
      inDays: 2,
      turning: 27,
    });
    expect(upcomingBirthdays(doc, local(2028, 2, 27))[0]).toMatchObject({
      date: { month: 2, day: 29 },
      inDays: 2,
      turning: 28,
    });
  });

  test("the time of day does not move the day count", () => {
    const doc = withBirths(["a", { year: 1990, month: 10, day: 24 }]);
    expect(upcomingBirthdays(doc, local(2026, 10, 23, 0))[0]?.inDays).toBe(1);
    expect(upcomingBirthdays(doc, local(2026, 10, 23, 23))[0]?.inDays).toBe(1);
  });

  test("ignores impossible dates", () => {
    const doc = withBirths(
      ["bad", { year: 1990, month: 2, day: 30 }],
      ["bad2", { month: 13, day: 1 }],
    );
    expect(upcomingBirthdays(doc, local(2026, 2, 1), 400)).toEqual([]);
  });

  test("ties are ordered by person id", () => {
    const doc = withBirths(
      ["b", { year: 1990, month: 10, day: 24 }],
      ["a", { year: 1991, month: 10, day: 24 }],
    );
    expect(upcomingBirthdays(doc, local(2026, 10, 23)).map((o) => o.personId)).toEqual(["a", "b"]);
  });
});

describe("onThisDay", () => {
  test("finds births, deaths and union starts on today's month and day", () => {
    const doc = docOf(
      [
        person("a", "A", "X", "male", { birth: { date: { year: 1950, month: 10, day: 23 } } }),
        person("b", "B", "X", "female", {
          isLiving: false,
          death: { date: { year: 1999, month: 10, day: 23 } },
        }),
        person("c", "C", "X", "male", { birth: { date: { year: 1950, month: 10, day: 22 } } }),
        person("d", "D", "X", "female", { birth: { date: { month: 10, day: 23 } } }),
      ],
      [union("u", ["a", "b"], [], "married", { start: { year: 1975, month: 10, day: 23 } })],
      "a",
    );
    expect(onThisDay(doc, local(2026, 10, 23))).toEqual([
      { personId: "a", kind: "birth", year: 1950 },
      { personId: "a", kind: "union", year: 1975, unionId: "u" },
      { personId: "b", kind: "death", year: 1999 },
    ]);
  });

  test("nothing on a quiet day", () => {
    expect(
      onThisDay(withBirths(["a", { year: 1950, month: 1, day: 1 }]), local(2026, 5, 5)),
    ).toEqual([]);
  });

  test("Feb 29 events land on Mar 1 in a non-leap year", () => {
    const doc = withBirths(["leap", { year: 2000, month: 2, day: 29 }]);
    expect(onThisDay(doc, local(2027, 3, 1))).toHaveLength(1);
    expect(onThisDay(doc, local(2027, 2, 28))).toHaveLength(0);
    expect(onThisDay(doc, local(2028, 2, 29))).toHaveLength(1);
  });
});

const born = (year: number | undefined, extra = {}) =>
  person("p", "P", "X", "male", { birth: { date: { year } }, ...extra });

describe("presumedLiving", () => {
  const now = local(2026, 10, 23);

  test("someone marked living is, unless born more than 110 years ago", () => {
    expect(presumedLiving(born(1950), now)).toBe(true);
    expect(presumedLiving(born(1916), now)).toBe(true);
    expect(presumedLiving(born(1915), now)).toBe(false);
    expect(presumedLiving(born(1820), now)).toBe(false);
    expect(presumedLiving(born(undefined), now)).toBe(true);
  });

  test("someone marked dead, or with a death date, is not", () => {
    expect(presumedLiving(born(1990, { isLiving: false }), now)).toBe(false);
    expect(presumedLiving(born(1990, { death: { date: { year: 2020 } } }), now)).toBe(false);
  });

  test("no birthday reminders for someone born 120 years ago with no death recorded", () => {
    const doc = withBirths(
      ["old", { year: 1906, month: 10, day: 25 }],
      ["young", { year: 1990, month: 10, day: 25 }],
    );
    expect(upcomingBirthdays(doc, now).map((b) => b.personId)).toEqual(["young"]);
  });
});
