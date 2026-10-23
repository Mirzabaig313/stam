import { describe, expect, test } from "bun:test";

import { validate } from "@/core/model/validate";
import { buildChapterDocs, CHAPTER_STEPS } from "@/site/sample/family";
import {
  blendFrames,
  buildChapterFrames,
  ENTER_OFFSET,
  frameAt,
  roman,
  settle,
} from "@/site/sample/frames";
import { relationship } from "@/site/sample/kinship";

describe("sample family chapters", () => {
  const docs = buildChapterDocs();

  test("one valid document per chapter", () => {
    expect(docs).toHaveLength(CHAPTER_STEPS.length);
    for (const { doc } of docs) expect(validate(doc)).toEqual([]);
  });

  test("each chapter only adds people", () => {
    const counts = docs.map(({ doc }) => Object.keys(doc.persons).length);
    expect(counts).toEqual([1, 2, 5, 10, 14]);
  });

  test("chapter V has a divorce, a remarriage and an adoption", () => {
    const { doc, keyOf } = docs.at(-1)!;
    const unions = Object.values(doc.unions);
    const sami = unions.filter((u) => u.partners.some((p) => keyOf[p] === "sami"));
    expect(sami.map((u) => u.status).toSorted()).toEqual(["divorced", "married"]);
    const adopted = unions.flatMap((u) => u.children).filter((c) => c.type === "adopted");
    expect(adopted.map((c) => keyOf[c.personId])).toEqual(["theo"]);
  });

  test("is deterministic apart from engine ids", () => {
    const a = buildChapterFrames();
    const b = buildChapterFrames();
    expect(a).toEqual(b);
  });
});

describe("frames", () => {
  const frames = buildChapterFrames();

  test("rows grow from one generation to four", () => {
    expect(frames.map((f) => f.rows)).toEqual([1, 1, 2, 3, 4]);
  });

  test("edges and cards use stable keys", () => {
    const last = frames.at(-1)!;
    expect(last.cards.map((c) => c.key).toSorted()).toContain("theo");
    expect(last.edges.map((e) => e.id)).toContain("child:elif+sami:theo");
    expect(last.edges.find((e) => e.id === "union:hana+sami")?.status).toBe("divorced");
  });

  test("a blend starts at the old frame and ends at the new one", () => {
    const [a, b] = [frames[2]!, frames[3]!];
    const start = blendFrames(a, b, 0);
    const end = blendFrames(a, b, 1);
    const ada = (blend: typeof start) => blend.cards.find((c) => c.key === "ada")!;
    expect(ada(start).x).toBe(a.cards.find((c) => c.key === "ada")!.x);
    expect(ada(end).x).toBe(b.cards.find((c) => c.key === "ada")!.x);
    expect(end.bounds).toEqual(b.bounds);
    for (const edge of end.edges) expect(edge.draw).toBe(1);
  });

  test("new cards slide in from beside their place and fade in", () => {
    const [a, b] = [frames[0]!, frames[1]!];
    const start = blendFrames(a, b, 0);
    const tomas = start.cards.find((c) => c.key === "tomas")!;
    const target = b.cards.find((c) => c.key === "tomas")!;
    expect(Math.abs(tomas.x - target.x)).toBe(ENTER_OFFSET);
    expect(tomas.opacity).toBe(0);
    expect(tomas.entering).toBe(true);
  });

  test("frameAt clamps and lands on whole chapters", () => {
    expect(frameAt(frames, -1).cards).toHaveLength(1);
    expect(frameAt(frames, 99).cards).toHaveLength(14);
    expect(frameAt(frames, 2).cards.map((c) => c.x)).toEqual(frames[2]!.cards.map((c) => c.x));
  });

  test("settle is expo-out", () => {
    expect(settle(0)).toBe(0);
    expect(settle(1)).toBe(1);
    expect(settle(0.5)).toBeGreaterThan(0.9);
  });

  test("roman numerals", () => {
    expect([1, 2, 3, 4, 5, 9, 14].map(roman)).toEqual(["I", "II", "III", "IV", "V", "IX", "XIV"]);
  });
});

describe("relationship demo", () => {
  const sample = buildChapterDocs().at(-1)!;
  const say = (a: string, b: string) => relationship(sample, a, b).sentence;

  test.each([
    ["lena", "noor", "Lena is Noor’s first cousin once removed."],
    ["noor", "sami", "Noor is Sami’s first cousin."],
    ["ada", "lena", "Ada is Lena’s great-grandmother."],
    ["clara", "lena", "Clara is Lena’s great-aunt."],
    ["lena", "theo", "Lena is Theo’s half-sister."],
    ["hana", "sami", "Hana is Sami’s former wife."],
    ["elif", "lena", "Elif is Lena’s stepmother."],
    ["ada", "omar", "Ada is Omar’s mother-in-law."],
    ["hana", "henrik", "Hana is Henrik’s former daughter-in-law."],
    ["omar", "theo", "Omar is married to Clara, Theo’s great-aunt."],
    ["hana", "theo", "Hana was married to Sami, Theo’s father."],
  ])("%s and %s", (a, b, sentence) => {
    expect(say(a, b)).toBe(sentence);
  });

  test("the path runs through the shared ancestor", () => {
    expect(relationship(sample, "lena", "noor").path).toEqual([
      "lena",
      "sami",
      "henrik",
      "ada",
      "clara",
      "noor",
    ]);
  });
});
