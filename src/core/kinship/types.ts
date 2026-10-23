export type RelationKind =
  | "self"
  | "parent"
  | "child"
  | "grandparent"
  | "grandchild"
  | "sibling"
  | "auncle"
  | "nibling"
  | "cousin"
  | "spouse"
  | "exSpouse"
  | "fiance"
  | "partner"
  | "stepParent"
  | "stepChild"
  | "stepSibling"
  | "parentInLaw"
  | "childInLaw"
  | "siblingInLaw"
  | "auncleByMarriage"
  | "niblingByMarriage"
  | "auncleInLaw"
  | "niblingInLaw"
  | "grandparentInLaw"
  | "grandchildInLaw"
  | "otherInLaw";

export type Relationship = {
  kind: RelationKind;
  greats: number; // grandparent: 0 = grandparent, 1 = great-grandparent ... ; auncle/nibling: 0 = uncle/aunt, 1 = great-uncle
  degree?: number; // cousin degree (1 = first cousin)
  removal?: number; // cousin removal (0 = none)
  half: boolean; // shares only one parent at the closest common ancestor level
  side?: "paternal" | "maternal"; // relative to B: through B's father or mother (for B's ancestors and their descendants)
  sexOfA: "male" | "female";
  path: string[]; // person ids from A to B inclusive, via the common ancestor(s) or spouse link
  // Additions beyond the M3 plan contract (optional, so they don't break consumers). They carry
  // what language-specific terms need and the path ids alone can't tell.
  /** Blood relationships that go up two or more generations from A: the sex of A's parent on the path (brother's son vs sister's son; son's son vs daughter's son). */
  viaSex?: "male" | "female";
  /** Uncles and aunts (greats 0): whether A is older than B's parent on the path. Undefined when the birth dates don't tell. */
  elder?: boolean;
  /**
   * Parent and child only: true when the direct link between the two is an adoption ("adopted
   * son", "adoptive father"). Wider relations through an adoption stay plain.
   */
  adopted?: boolean;
  /**
   * Relationships by marriage (`auncleByMarriage`, `niblingInLaw` …): the sex of the partner
   * through whom A and B are linked (a father's brother's wife is چچی, a father's sister's
   * husband پھوپھا). Their `greats`, `side`, `elder` and `viaSex` are those of the blood
   * relationship on the other side of that partner.
   */
  partnerSex?: "male" | "female";
};

/** The translation function `describeRelationship` takes, so core stays free of i18n imports. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;
