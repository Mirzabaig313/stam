import { type ClientMessage, parseServerMessage, type ServerMessage } from "@/sync/protocol";

/** The parts of a WebSocket the transport uses (tests drive a fake). */
export type SocketLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (e: { data: string }) => void): void;
  addEventListener(type: "close", listener: (e: { code: number }) => void): void;
};

export type RoomHandlers = {
  onOpen(): void;
  onMessage(msg: ServerMessage): void;
  /** The connection dropped; the transport reconnects unless told otherwise. */
  onDown(): void;
  /** The room ended the connection for good (4401 link off or session gone, 4404 deleted). */
  onClosed(code: number): void;
  /**
   * A socket closed before it opened: refused (no access any more) or just offline. Answer
   * whether to keep trying; false stops the transport.
   */
  shouldRetry(): Promise<boolean>;
};

export type RoomConnection = { send(msg: ClientMessage): void; stop(): void };

const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

/** Where the room's sockets are: the page's own origin, or the local Worker in development. */
export function wsOrigin(): string {
  if (process.env.NODE_ENV !== "production") return "ws://localhost:8787";
  return location.origin.replace(/^http/, "ws");
}

/**
 * One tree's WebSocket, kept open: after a drop it reconnects with exponential backoff and jitter
 * (1 to 30 seconds). A `closed` notice from the room ends it.
 */
export function connectRoom(opts: {
  treeId: string;
  token?: string;
  handlers: RoomHandlers;
  createSocket?: (url: string) => SocketLike;
  schedule?: (fn: () => void, ms: number) => void;
  random?: () => number;
}): RoomConnection {
  const {
    handlers,
    createSocket = (url) => new WebSocket(url) as unknown as SocketLike,
    schedule = (fn, ms) => void setTimeout(fn, ms),
    random = Math.random,
  } = opts;
  const query = opts.token ? `?t=${encodeURIComponent(opts.token)}` : "";
  const url = `${wsOrigin()}/api/trees/${opts.treeId}/ws${query}`;
  let socket: SocketLike | null = null;
  let open = false;
  let stopped = false;
  let attempt = 0;

  function retryLater() {
    const delay = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** attempt);
    attempt++;
    schedule(() => !stopped && connect(), Math.max(MIN_DELAY_MS, delay * (0.5 + random() / 2)));
  }

  function connect() {
    const s = createSocket(url);
    socket = s;
    let opened = false;
    s.addEventListener("open", () => {
      opened = true;
      open = true;
      attempt = 0;
      handlers.onOpen();
    });
    s.addEventListener("message", (e) => {
      let msg: ServerMessage;
      try {
        msg = parseServerMessage(e.data);
      } catch {
        return; // not ours: ignored
      }
      if (msg.type === "closed") {
        stopped = true;
        handlers.onClosed(msg.code);
        s.close();
        return;
      }
      handlers.onMessage(msg);
    });
    s.addEventListener("close", (e) => {
      open = false;
      if (socket === s) socket = null;
      if (stopped) return;
      if (e.code === 4401 || e.code === 4404) {
        stopped = true;
        handlers.onClosed(e.code);
        return;
      }
      handlers.onDown();
      if (opened) {
        retryLater();
        return;
      }
      void handlers.shouldRetry().then((retry) => {
        if (retry && !stopped) retryLater();
        else stopped = true;
      });
    });
  }

  connect();
  return {
    send(msg) {
      if (open) socket?.send(JSON.stringify(msg));
    },
    stop() {
      stopped = true;
      socket?.close();
    },
  };
}
