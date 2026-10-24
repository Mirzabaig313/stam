import type { Issue } from "@/core/model/validate";

export type CommandErrorCode =
  | "NOT_FOUND"
  | "CYCLE"
  | "AMBIGUOUS_UNION"
  | "PARENTS_FULL"
  | "ALREADY_LINKED"
  | "INVALID"
  /** A collaborative undo found the entity changed since (see `src/sync/revert`). */
  | "CONFLICT";

export class CommandError extends Error {
  code: CommandErrorCode;
  /** Set only when the debug guard found the command left an invalid document. */
  issues?: Issue[];
  /** For CONFLICT: the entity that changed, e.g. `persons/<id>`. */
  key?: string;

  constructor(code: CommandErrorCode, message: string = code, issues?: Issue[], key?: string) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.issues = issues;
    this.key = key;
  }
}
