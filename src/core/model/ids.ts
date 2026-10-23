import { nanoid } from "nanoid";

export const ID_LENGTH = 12;

export function newId(): string {
  return nanoid(ID_LENGTH);
}
