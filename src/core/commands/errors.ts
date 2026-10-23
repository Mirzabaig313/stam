import type { Issue } from "@/core/model/validate";

export type CommandErrorCode =
  "NOT_FOUND" | "CYCLE" | "AMBIGUOUS_UNION" | "PARENTS_FULL" | "ALREADY_LINKED" | "INVALID";

export class CommandError extends Error {
  code: CommandErrorCode;
  /** Set only when the debug guard found the command left an invalid document. */
  issues?: Issue[];

  constructor(code: CommandErrorCode, message: string = code, issues?: Issue[]) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.issues = issues;
  }
}
