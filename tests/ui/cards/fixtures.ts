import type { TreeDocument } from "@/core/model/types";

import { docOf, person, union } from "../../fixtures/families";

/**
 * Ahmed + Sara with Ali (born 1950, native name), Zainab (1953–2019, deceased) and adopted Omar.
 * Ali married Hina, whose own parents are Imran + an "Unknown mother" placeholder.
 * Root is Ahmed.
 */
export function cardFamily(): TreeDocument {
  return docOf(
    [
      person("ahmed", "Ahmed", "Khan", "male", { birth: { date: { year: 1920 } } }),
      person("sara", "Sara", "Khan", "female"),
      person("ali", "Ali", "Khan", "male", {
        nativeName: "علی خان",
        birth: { date: { year: 1950 } },
      }),
      person("zainab", "Zainab", "Khan", "female", {
        nativeName: "زینب خان",
        isLiving: false,
        birth: { date: { year: 1953 } },
        death: { date: { year: 2019, month: 3 } },
      }),
      person("omar", "Omar", "Khan", "male"),
      person("hina", "Hina", "Raza", "female"),
      person("imran", "Imran", "Raza", "male"),
      person("unknownMom", "", "", "female", { isPlaceholder: true }),
      person("bilal", "Bilal", "Khan", "male"),
    ],
    [
      union("u1", ["ahmed", "sara"], ["ali", "zainab", ["omar", "adopted"]]),
      union("u2", ["imran", "unknownMom"], ["hina"]),
      union("u3", ["ali", "hina"], ["bilal"]),
    ],
    "ahmed",
  );
}

/** Ahmed married Sara, then Hina, and also has a child on his own. */
export function remarried(): TreeDocument {
  return docOf(
    [
      person("dad", "Ahmed", "Khan", "male"),
      person("mom", "Sara", "Malik", "female"),
      person("w2", "Hina", "Raza", "female"),
      person("c1", "Ali", "Khan", "male"),
      person("c2", "Noor", "Khan", "female"),
    ],
    [union("u1", ["dad", "mom"], ["c1"]), union("u2", ["dad", "w2"]), union("u3", ["dad"], ["c2"])],
    "dad",
  );
}
