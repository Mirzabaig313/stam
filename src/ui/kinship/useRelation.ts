import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { Relationship } from "@/core/kinship/types";
import { useEditor } from "@/ui/store/useEditor";

import {
  type Explanation,
  type KinshipFns,
  kinshipKey,
  phraseRelations,
  realKinship,
} from "./explain";

export type RelationState = {
  /** The pair, while the calculator is open; null when closed. */
  pair: { aId: string | null; bId: string | null } | null;
  /** Null until both people are chosen (and different), or when the calculator failed. */
  explanation: Explanation | null;
  failed: boolean;
};

type Worked = { rels: Relationship[] | null; failed: boolean };

/**
 * The open calculator's answer. The relationships are worked out only while the calculator has
 * two people, and again only when the pair or the family itself changes (`kinshipKey` and the
 * unions): renaming someone or editing a note just rephrases the sentences.
 */
export function useRelation(fns: KinshipFns = realKinship): RelationState {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const doc = useEditor((s) => s.doc);
  const pair = useEditor((s) => s.relation);
  const aId = pair?.aId ?? null;
  const bId = pair?.bId ?? null;
  const asked = doc !== null && aId !== null && bId !== null && aId !== bId;

  const persons = doc?.persons;
  const unions = doc?.unions;
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const key = useMemo(() => (asked && doc ? kinshipKey(doc) : ""), [asked, persons]);
  const latestDoc = useRef(doc);
  latestDoc.current = doc;

  const worked = useMemo((): Worked => {
    const current = latestDoc.current;
    if (!asked || !current || aId === null || bId === null) return { rels: null, failed: false };
    if (!current.persons[aId] || !current.persons[bId]) return { rels: null, failed: false };
    try {
      return { rels: fns.relate(current, aId, bId), failed: false };
    } catch {
      return { rels: null, failed: true };
    }
    // `key` and `unions` stand for the parts of the document relate reads.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, key, unions, aId, bId, fns]);

  const answer = useMemo(() => {
    if (!doc || worked.rels === null || aId === null || bId === null) {
      return { explanation: null, failed: worked.failed };
    }
    try {
      return {
        explanation: phraseRelations(doc, aId, bId, worked.rels, t, fns, language),
        failed: false,
      };
    } catch {
      return { explanation: null, failed: true };
    }
  }, [doc, worked, aId, bId, t, fns, language]);
  return { pair, ...answer };
}
