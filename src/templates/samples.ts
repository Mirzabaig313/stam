import type { Person, TreeDocument, Union } from "@/core/model/types";

// Families for looking at templates: the stress family has every mark a template must draw
// (deceased elders, a divorce and remarriage, an adopted son, an unknown husband, native names);
// the big one is 40 people over five generations. Used by the template tests and by
// `scripts/render-templates.ts`.

type P = Partial<Person> & { id: string; firstName: string; gender: Person["gender"] };

const person = (p: P): Person => ({ lastName: "", isLiving: true, ...p });

const union = (
  id: string,
  partners: [string] | [string, string],
  children: (string | [string, Union["children"][number]["type"]])[] = [],
  status: Union["status"] = "married",
): Union => ({
  id,
  partners,
  status,
  children: children.map((c) =>
    typeof c === "string" ? { personId: c, type: "biological" } : { personId: c[0], type: c[1] },
  ),
});

function treeOf(
  name: string,
  persons: Person[],
  unions: Union[],
  rootPersonId: string,
): TreeDocument {
  const unionOrder: Record<string, string[]> = {};
  for (const u of unions) for (const p of u.partners) (unionOrder[p] ??= []).push(u.id);
  return {
    id: `sample-${name.toLowerCase().replaceAll(" ", "-")}`,
    name,
    schemaVersion: 1,
    rootPersonId,
    persons: Object.fromEntries(persons.map((p) => [p.id, p])),
    unions: Object.fromEntries(unions.map((u) => [u.id, u])),
    unionOrder,
    settings: { theme: "default", colorMode: "light", direction: "ltr" },
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
  };
}

export function stressFamily(): TreeDocument {
  const dead = (birth: number, death: number, place?: string) => ({
    isLiving: false,
    birth: { date: { year: birth }, ...(place ? { place } : {}) },
    death: { date: { year: death } },
  });
  const born = (year: number) => ({ birth: { date: { year } } });
  return treeOf(
    "The Baig Family",
    [
      person({
        id: "ismail",
        firstName: "Ismail",
        lastName: "Baig",
        nativeName: "اسماعیل بیگ",
        gender: "male",
        ...dead(1921, 1994, "Lahore, Punjab"),
      }),
      person({
        id: "raje",
        firstName: "Raje",
        lastName: "Baig",
        nativeName: "راجے بیگ",
        gender: "female",
        ...dead(1926, 2009),
      }),
      person({
        id: "nasreen",
        firstName: "Nasreen",
        lastName: "Khan",
        nativeName: "نسرین خان",
        gender: "female",
        ...born(1950),
      }),
      person({
        id: "haider",
        firstName: "Haider",
        lastName: "Baig",
        nativeName: "حیدر بیگ",
        gender: "male",
        ...dead(1948, 2016),
      }),
      person({
        id: "sharifa",
        firstName: "Sharifa",
        lastName: "Baig",
        nativeName: "شریفہ بیگ",
        gender: "female",
        ...born(1952),
      }),
      person({
        id: "masum",
        firstName: "Masum",
        lastName: "Baig",
        nativeName: "معصوم بیگ",
        gender: "female",
        ...born(1955),
      }),
      person({ id: "unknown", firstName: "", gender: "male", isPlaceholder: true }),
      person({
        id: "ibrahim",
        firstName: "Ibrahim",
        lastName: "Baig",
        nativeName: "ابراہیم بیگ",
        gender: "male",
        ...born(1975),
      }),
      person({
        id: "yaqoob",
        firstName: "Yaqoob",
        lastName: "Baig",
        nativeName: "یعقوب بیگ",
        gender: "male",
        ...born(1978),
      }),
      person({
        id: "isaac",
        firstName: "Isaac",
        lastName: "Baig",
        nativeName: "اسحاق بیگ",
        gender: "male",
        ...born(1983),
      }),
      person({ id: "zara", firstName: "Zara", lastName: "Baig", gender: "female", ...born(1981) }),
    ],
    [
      union("u-elders", ["ismail", "raje"], ["haider", "masum"]),
      union("u-first", ["nasreen", "haider"], ["ibrahim"], "divorced"),
      union("u-second", ["haider", "sharifa"], ["yaqoob", ["isaac", "adopted"]]),
      union("u-masum", ["masum", "unknown"], ["zara"]),
    ],
    "ismail",
  );
}

/** Forty people over five generations: two children per couple, partners for most. */
export function bigFamily(): TreeDocument {
  const persons: Person[] = [];
  const unions: Union[] = [];
  const first = ["Ali", "Sara", "Omar", "Hina", "Bilal", "Noor", "Zaid", "Amna", "Faris", "Laila"];
  let n = 0;
  const add = (gender: Person["gender"], year: number, generation: number): string => {
    const id = `p${n}`;
    const name = first[n % first.length]!;
    n++;
    persons.push(
      person({
        id,
        firstName: name,
        lastName: "Haddad",
        gender,
        ...(generation < 2
          ? { isLiving: false, birth: { date: { year } }, death: { date: { year: year + 78 } } }
          : { birth: { date: { year } } }),
      }),
    );
    return id;
  };
  const root = add("male", 1900, 0);
  let row = [root];
  for (let g = 1; g < 5 && persons.length < 40; g++) {
    const next: string[] = [];
    for (const parent of row) {
      if (persons.length >= 40) break;
      const partner = add(
        persons.find((p) => p.id === parent)!.gender === "male" ? "female" : "male",
        1900 + g * 27,
        g - 1,
      );
      const kids = [add("female", 1925 + g * 27, g), add("male", 1928 + g * 27, g)];
      unions.push(union(`u${unions.length}`, [parent, partner], kids));
      next.push(...kids);
    }
    row = next.slice(0, 4);
  }
  return treeOf("The Haddad Family", persons, unions, root);
}
