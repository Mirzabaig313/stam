import { CommandError } from "./errors";

/** The base64url alphabet, in the order the counter counts through it. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Two counter characters give this many ids per op. */
const MAX_IDS = ALPHABET.length * ALPHABET.length;

const OP_ID = /^[A-Za-z0-9_-]{10}$/;

/** An op id is ten id characters (a 10-character nanoid). */
export function isOpId(value: string): boolean {
  return OP_ID.test(value);
}

/**
 * The ids an op creates: the op id plus a two-character counter, in the order the handler asks for
 * them. Server and clients re-running the same op on the same document therefore create the same
 * people and unions.
 */
export function opIdSource(opId: string): () => string {
  if (!isOpId(opId)) throw new CommandError("INVALID", `${opId} is not an op id`);
  let n = 0;
  return () => {
    if (n >= MAX_IDS) throw new CommandError("INVALID", "An op cannot create this many ids");
    const id = opId + ALPHABET[n >> 6] + ALPHABET[n & 63];
    n++;
    return id;
  };
}
