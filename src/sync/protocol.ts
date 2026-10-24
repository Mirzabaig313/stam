import type { TreeDocument } from "@/core/model/types";

import type { Changes } from "./changes";
import type { EntityChange } from "./revert";

// The messages on a tree's WebSocket (spec §5.3, P1 subset). The Rust room
// (`server/stam-room/src/protocol.rs`) is the other side; the protocol and convergence suites run
// this client against it, compiled to WASM.

export type Role = "owner" | "view" | "comment" | "edit";

export type ClientMessage =
  | {
      type: "hello";
      lastVersion?: number;
      pending?: string[];
      /** A link user's display name (owners are named by their account). */
      name?: string;
    }
  /** A link user names themselves after joining. */
  | { type: "name"; name: string }
  /** The person this user has selected (none clears it). */
  | { type: "presence"; selectedPersonId?: string }
  | { type: "op"; opId: string; cmd: unknown }
  | { type: "revert"; opId: string; entries: EntityChange[]; direction: "undo" | "redo" };

export type PublicAuthor = { kind: "owner" | "link"; name: string };

/** Someone else in the room: one per open tab, never this tab itself. */
export type PresencePerson = {
  /** Made by the room from the socket; stable while that tab stays connected. */
  id: string;
  /** Empty for a link user who has not given a name. */
  name: string;
  kind: "owner" | "link";
  selectedPersonId?: string;
};

export type AppliedOp = { version: number; opId: string; author: PublicAuthor; changes: Changes };

export type ServerMessage =
  | {
      type: "welcome";
      role: Role;
      hideLiving: boolean;
      version: number;
      /** Which share of the tree this room is: a different one means start over. */
      epoch?: string;
      /** Which of the client's pending op ids the room already applied. */
      known?: string[];
      doc?: TreeDocument;
      ops?: AppliedOp[];
    }
  | ({ type: "applied" } & AppliedOp)
  | { type: "rejected"; opId?: string; code: string; key?: string }
  | { type: "busy"; retryAfter: number }
  /** Who is in the room, sent to everyone whenever it changes. */
  | { type: "presence"; people: PresencePerson[] }
  /** Sent just before the room closes the socket (4401 link off or session gone, 4404 deleted). */
  | { type: "closed"; code: number; reason: string };

const TYPES = new Set(["welcome", "applied", "rejected", "busy", "closed", "presence"]);

/** Reads a message from the room; throws on anything that is not one. */
export function parseServerMessage(text: string): ServerMessage {
  const msg = JSON.parse(text) as { type?: unknown };
  if (typeof msg !== "object" || msg === null || !TYPES.has(msg.type as string)) {
    throw new Error(`Unknown message from the room: ${text.slice(0, 80)}`);
  }
  return msg as ServerMessage;
}
