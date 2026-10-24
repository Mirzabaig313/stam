import type { RoomConnection, RoomHandlers } from "@/cloud/transport";
import type { ClientMessage, ServerMessage } from "@/sync/protocol";

/** Stands in for `connectRoom`: the test opens, drops and feeds the connection by hand. */
export function fakeRoom() {
  const state = {
    handlers: null as RoomHandlers | null,
    sent: [] as ClientMessage[],
    stopped: false,
    connects: 0,
    open: false,
  };
  const connect = (opts: {
    treeId: string;
    token?: string;
    handlers: RoomHandlers;
  }): RoomConnection => {
    state.handlers = opts.handlers;
    state.connects++;
    state.stopped = false;
    return {
      send: (m) => void (state.open && state.sent.push(m)),
      stop: () => void (state.stopped = true),
    };
  };
  return {
    connect,
    state,
    open() {
      state.open = true;
      state.handlers!.onOpen();
    },
    receive(msg: ServerMessage) {
      state.handlers!.onMessage(msg);
    },
    drop() {
      state.open = false;
      state.handlers!.onDown();
    },
    /** A socket that never opened: the session decides whether to keep trying. */
    refuse(): Promise<boolean> {
      state.handlers!.onDown();
      return state.handlers!.shouldRetry();
    },
    closed(code: number) {
      state.open = false;
      state.handlers!.onClosed(code);
    },
  };
}
