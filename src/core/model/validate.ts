import type { TreeDocument } from "./types";

export type Issue = {
  code:
    | "DANGLING_REF"
    | "MULTIPLE_BIO_PARENTS"
    | "CYCLE"
    | "EMPTY_UNION"
    | "BAD_ROOT"
    | "UNION_ORDER_MISMATCH"
    | "DUPLICATE_CHILD";
  message: string;
  ids: string[];
};

/** Checks the invariants of PRD section 9. Runs in linear time and never recurses. */
export function validate(doc: TreeDocument): Issue[] {
  const issues: Issue[] = [];
  const has = (personId: string) => Object.hasOwn(doc.persons, personId);

  if (doc.rootPersonId !== undefined && !has(doc.rootPersonId)) {
    issues.push({
      code: "BAD_ROOT",
      message: `Root person ${doc.rootPersonId} does not exist`,
      ids: [doc.rootPersonId],
    });
  }

  const bioUnionsOf = new Map<string, string[]>();
  const edges = new Map<string, Set<string>>();

  for (const union of Object.values(doc.unions)) {
    if ((union.partners as readonly string[]).length === 0) {
      issues.push({
        code: "EMPTY_UNION",
        message: `Union ${union.id} has no partners`,
        ids: [union.id],
      });
    }

    for (const partnerId of union.partners) {
      if (!has(partnerId)) {
        issues.push({
          code: "DANGLING_REF",
          message: `Union ${union.id} has a partner ${partnerId} who does not exist`,
          ids: [union.id, partnerId],
        });
      } else if (!doc.unionOrder[partnerId]?.includes(union.id)) {
        issues.push({
          code: "UNION_ORDER_MISMATCH",
          message: `Union ${union.id} is missing from the union order of ${partnerId}`,
          ids: [union.id, partnerId],
        });
      }
    }

    const seenChildren = new Set<string>();
    for (const child of union.children) {
      if (seenChildren.has(child.personId)) {
        issues.push({
          code: "DUPLICATE_CHILD",
          message: `Union ${union.id} lists child ${child.personId} more than once`,
          ids: [union.id, child.personId],
        });
        continue;
      }
      seenChildren.add(child.personId);

      if (!has(child.personId)) {
        issues.push({
          code: "DANGLING_REF",
          message: `Union ${union.id} has a child ${child.personId} who does not exist`,
          ids: [union.id, child.personId],
        });
        continue;
      }

      if (child.type === "biological") {
        const list = bioUnionsOf.get(child.personId);
        if (list) list.push(union.id);
        else bioUnionsOf.set(child.personId, [union.id]);
      }
      for (const partnerId of union.partners) {
        if (!has(partnerId)) continue;
        const targets = edges.get(partnerId);
        if (targets) targets.add(child.personId);
        else edges.set(partnerId, new Set([child.personId]));
      }
    }
  }

  for (const [personId, order] of Object.entries(doc.unionOrder)) {
    if (!has(personId)) {
      issues.push({
        code: "DANGLING_REF",
        message: `Union order belongs to ${personId}, who does not exist`,
        ids: [personId],
      });
      continue;
    }
    const seen = new Set<string>();
    for (const unionId of order) {
      const union = doc.unions[unionId];
      if (!union) {
        issues.push({
          code: "DANGLING_REF",
          message: `Union order of ${personId} lists union ${unionId}, which does not exist`,
          ids: [personId, unionId],
        });
      } else if (!(union.partners as readonly string[]).includes(personId)) {
        issues.push({
          code: "UNION_ORDER_MISMATCH",
          message: `Union order of ${personId} lists union ${unionId}, which they are not part of`,
          ids: [personId, unionId],
        });
      } else if (seen.has(unionId)) {
        issues.push({
          code: "UNION_ORDER_MISMATCH",
          message: `Union order of ${personId} lists union ${unionId} more than once`,
          ids: [personId, unionId],
        });
      }
      seen.add(unionId);
    }
  }

  for (const [personId, unionIds] of bioUnionsOf) {
    if (unionIds.length > 1) {
      issues.push({
        code: "MULTIPLE_BIO_PARENTS",
        message: `${personId} is a biological child of ${unionIds.length} unions`,
        ids: [personId, ...unionIds],
      });
    }
  }

  issues.push(...findCycles(doc, edges));
  return issues;
}

/** Iterative three-colour DFS over parent -> child edges; one issue per back edge. */
function findCycles(doc: TreeDocument, edges: Map<string, Set<string>>): Issue[] {
  const issues: Issue[] = [];
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();

  for (const startId of Object.keys(doc.persons)) {
    if (colour.has(startId)) continue;
    const path: string[] = [startId];
    const frames: { iter: Iterator<string> }[] = [
      { iter: (edges.get(startId) ?? new Set<string>()).values() },
    ];
    colour.set(startId, GREY);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const next = frame.iter.next();
      if (next.done) {
        colour.set(path.pop()!, BLACK);
        frames.pop();
        continue;
      }
      const childId = next.value;
      const state = colour.get(childId);
      if (state === GREY) {
        const cycle = path.slice(path.indexOf(childId));
        issues.push({
          code: "CYCLE",
          message: `${cycle.join(" -> ")} -> ${childId} makes a person their own ancestor`,
          ids: cycle,
        });
      } else if (state === undefined) {
        colour.set(childId, GREY);
        path.push(childId);
        frames.push({ iter: (edges.get(childId) ?? new Set<string>()).values() });
      }
    }
  }
  return issues;
}
