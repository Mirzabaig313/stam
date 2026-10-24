// How long the room's work takes on a 5,000-person tree, against the free plan's 10 ms of CPU per
// request (spec §10). Runs the release WASM of the real room (`bun run wasm` first) in Bun: a
// proxy for the Worker, not the Worker itself. Budget: each under 5 ms, half the limit.

import { bigFamily } from "@/dev/bigFamily";

import { loadWasm } from "../tests/parity/wasm";

type Harness = {
  connect(attachment: string): string;
  message(socketId: string, text: string, now: string, nowMs: number): string;
  restart(): void;
};
const { RoomHarness } = loadWasm<{ RoomHarness: new (doc: string, now: string) => Harness }>(
  "stam-room",
);

const NOW = "2026-10-24T00:00:00.000Z";
const RUNS = 50;
const BUDGET_MS = 5;

const PEOPLE = Number(process.env.PEOPLE ?? 5000);
const doc = bigFamily(PEOPLE);
console.log(`${PEOPLE} people`);
const people = Object.keys(doc.persons);
const attachment = (id: string, hideLiving: boolean, role = "owner") =>
  JSON.stringify({
    socketId: id,
    role,
    hideLiving,
    author: { kind: role === "owner" ? "owner" : "link", id, name: id },
  });

function median(xs: number[]): number {
  const s = xs.toSorted((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

let opCount = 0;
const opId = () => `bench${String(opCount++).padStart(5, "0")}`;
const addChild = () =>
  JSON.stringify({
    type: "op",
    opId: opId(),
    cmd: { type: "addChild", parentId: people[opCount % people.length], child: { gender: "male" } },
  });

const room = new RoomHarness(JSON.stringify(doc), NOW);
const owner = room.connect(attachment("owner", false));
room.connect(attachment("viewer", true, "view")); // so every op also builds the redacted broadcast
let ms = 0;

// Cold open: the room wakes from hibernation and replays up to 49 logged ops on its snapshot.
for (let i = 0; i < 49; i++) room.message(owner, addChild(), NOW, (ms += 1000));
const open: number[] = [];
for (let i = 0; i < RUNS; i++) {
  const t = performance.now();
  room.restart();
  open.push(performance.now() - t);
}

// One op, with its full and redacted broadcasts.
const op: number[] = [];
for (let i = 0; i < RUNS; i++) {
  const text = addChild();
  const t = performance.now();
  room.message(owner, text, NOW, (ms += 1000));
  op.push(performance.now() - t);
}

// A viewer joining: the whole tree, cut for hide-living. The first join after an edit builds it
// (the worst case); later joins at the same version reuse it.
const welcome: number[] = [];
const welcomeCached: number[] = [];
const viewer = room.connect(attachment("viewer2", true, "view"));
const hello = JSON.stringify({ type: "hello" });
for (let i = 0; i < RUNS; i++) {
  room.message(owner, addChild(), NOW, (ms += 1000));
  let t = performance.now();
  room.message(viewer, hello, NOW, (ms += 1000));
  welcome.push(performance.now() - t);
  t = performance.now();
  room.message(viewer, hello, NOW, (ms += 1000));
  welcomeCached.push(performance.now() - t);
}

const rows = {
  "cold open (snapshot + 49 ops)": open,
  "one op (+ redacted broadcast)": op,
  "hide-living join after an edit": welcome,
  "hide-living join, same version": welcomeCached,
};
let over = false;
for (const [name, times] of Object.entries(rows)) {
  const m = median(times);
  over ||= m > BUDGET_MS;
  console.log(`${name.padEnd(32)} median ${m.toFixed(2)} ms ${m > BUDGET_MS ? "OVER BUDGET" : ""}`);
}
process.exit(over ? 1 : 0);
