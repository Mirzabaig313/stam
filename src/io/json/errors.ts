export type ImportErrorCode =
  "NOT_JSON" | "NOT_STAM" | "FUTURE_VERSION" | "INVALID_TREE" | "TOO_LARGE";

/**
 * Thrown for any file or stored tree we cannot accept. The UI translates by `code`; the
 * message is English for logs only.
 */
export class ImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}
