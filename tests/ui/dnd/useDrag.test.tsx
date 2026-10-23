import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";

import type { LayoutNode } from "@/core/layout/types";
import type { DropTarget } from "@/ui/dnd/resolveDrop";
import { type DragSession, useDrag, type UseDragOptions } from "@/ui/dnd/useDrag";

import { fakeClock } from "../../fixtures/editorEnv";
import { reduceMotion } from "../i18n";

const NODE: LayoutNode = {
  nodeId: "c1",
  personId: "c1",
  kind: "blood",
  x: 0,
  y: 0,
  generation: 1,
  hiddenCount: 0,
} as LayoutNode;

const PERSON_TARGET: DropTarget = { kind: "person", personId: "x", actions: ["spouse"] };

type Point = [number, number];

const move = (x: number, y: number, init: Record<string, unknown> = {}) =>
  act(() => {
    window.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 1, clientX: x, clientY: y, ...init }),
    );
  });
const up = (x: number, y: number, init: Record<string, unknown> = {}) =>
  act(() => {
    window.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, clientX: x, clientY: y, ...init }),
    );
  });
const key = (k: string) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });

function setup(over: Partial<UseDragOptions> = {}) {
  const clock = fakeClock();
  const sessions: (DragSession | null)[] = [];
  const onDrop = mock((_s: DragSession) => true);
  const onLongPress = mock((_n: LayoutNode, _at: Point) => {});
  const resolve = mock((_id: string, _world: Point): DropTarget => PERSON_TARGET);
  const onClick = mock(() => {});
  const options: UseDragOptions = {
    // World is client / 2, so the conversion is visible in the resolve calls.
    toWorld: ([x, y]) => [x / 2, y / 2],
    resolve,
    homeOf: () => [100, 100],
    onDrop,
    onLongPress,
    timers: clock.timers,
    ...over,
  };

  const api: { current?: ReturnType<typeof useDrag> } = {};
  function Harness() {
    const drag = useDrag(options);
    useEffect(() => {
      api.current = drag;
    });
    sessions.push(drag.session);
    return (
      <button
        type="button"
        data-testid="card"
        onPointerDown={(event) => drag.start(NODE, event)}
        onClick={onClick}
      >
        card
      </button>
    );
  }

  const view = render(<Harness />);
  const card = view.getByTestId("card");
  const latest = () => sessions.at(-1) ?? null;

  const down = (x: number, y: number, init: Record<string, unknown> = {}) =>
    fireEvent.pointerDown(card, { pointerId: 1, button: 0, clientX: x, clientY: y, ...init });
  const cancel = () => api.current!.cancel();
  const isHolding = () => api.current!.isHolding();
  const handles = { card, clock, latest, onDrop, onLongPress, resolve, onClick, down, move, up };
  return { ...handles, key, cancel, isHolding };
}

beforeEach(() => reduceMotion(true));
afterEach(() => {
  cleanup();
  reduceMotion(false);
});

describe("useDrag with a mouse", () => {
  test("a move under the 5 px threshold is not a drag", () => {
    const d = setup();
    d.down(110, 110);
    d.move(113, 113);
    expect(d.latest()).toBeNull();
    d.up(113, 113);
    expect(d.onDrop).not.toHaveBeenCalled();
    fireEvent.click(d.card);
    expect(d.onClick).toHaveBeenCalledTimes(1);
  });

  test("past the threshold the ghost follows the pointer and resolves the target in world space", () => {
    const d = setup();
    d.down(110, 120);
    d.move(130, 140);
    const session = d.latest()!;
    expect(session.phase).toBe("dragging");
    expect(session.pointer).toEqual([130, 140]);
    // The grab point keeps the card under the pointer where it was picked up.
    expect(session.grab).toEqual([10, 20]);
    expect(session.target).toEqual(PERSON_TARGET);
    expect(d.resolve.mock.calls.at(-1)).toEqual(["c1", [65, 70]]);
  });

  test("release drops on the current target and clears", () => {
    const d = setup();
    d.down(110, 110);
    d.move(150, 150);
    d.up(150, 150);
    expect(d.onDrop).toHaveBeenCalledTimes(1);
    expect(d.onDrop.mock.calls[0]![0].target).toEqual(PERSON_TARGET);
    expect(d.latest()).toBeNull();
  });

  test("the click that follows a drag does not reach the card", () => {
    const d = setup();
    d.down(110, 110);
    d.move(150, 150);
    d.up(150, 150);
    fireEvent.click(d.card);
    expect(d.onClick).not.toHaveBeenCalled();
  });

  test("a refused drop sends the ghost back (at once under reduced motion)", () => {
    const d = setup({ onDrop: mock(() => false) });
    d.down(110, 110);
    d.move(150, 150);
    d.up(150, 150);
    expect(d.latest()).toBeNull();
  });

  test("with motion the ghost glides back to the card before it clears", async () => {
    reduceMotion(false);
    const d = setup({ onDrop: mock(() => false) });
    d.down(110, 110);
    d.move(150, 150);
    d.up(150, 150);
    const returning = d.latest()!;
    expect(returning.phase).toBe("returning");
    expect(returning.target).toEqual({ kind: "none" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(d.latest()).toBeNull();
  });

  test("Esc cancels the drag without dropping", () => {
    const d = setup();
    d.down(110, 110);
    d.move(150, 150);
    d.key("Escape");
    expect(d.latest()).toBeNull();
    d.up(150, 150);
    expect(d.onDrop).not.toHaveBeenCalled();
  });

  test("other buttons never start a drag", () => {
    const d = setup();
    d.down(110, 110, { button: 2 });
    d.move(150, 150);
    expect(d.latest()).toBeNull();
  });

  test("a pointercancel ends the drag without dropping", () => {
    const d = setup();
    d.down(110, 110);
    d.move(150, 150);
    act(() => {
      window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));
    });
    expect(d.latest()).toBeNull();
    expect(d.onDrop).not.toHaveBeenCalled();
  });
});

/** A global function that, like the browser's timers, refuses to be called on another object. */
function strict<F extends (...args: never[]) => unknown>(real: F) {
  return function (this: unknown, ...args: Parameters<F>) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return real(...args);
  };
}

describe("useDrag with touch", () => {
  const TOUCH = { pointerType: "touch" };

  test("moving before the long-press is not a drag", async () => {
    const d = setup();
    d.down(110, 110, TOUCH);
    d.move(130, 130, TOUCH);
    await act(() => d.clock.advance(400));
    expect(d.latest()).toBeNull();
    d.up(130, 130, TOUCH);
    expect(d.onDrop).not.toHaveBeenCalled();
    expect(d.onLongPress).not.toHaveBeenCalled();
  });

  test("the real timers work: browsers refuse setTimeout called on another object", () => {
    // Chrome and Safari throw "Illegal invocation" unless `this` is the window (or undefined).
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    globalThis.setTimeout = strict(realSet) as unknown as typeof setTimeout;
    globalThis.clearTimeout = strict(realClear) as typeof clearTimeout;
    try {
      const d = setup({ timers: undefined });
      expect(() => d.down(110, 110, TOUCH)).not.toThrow();
      d.up(110, 110, TOUCH);
    } finally {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    }
  });

  test("a press shorter than 350 ms does nothing", async () => {
    const d = setup();
    d.down(110, 110, TOUCH);
    await act(() => d.clock.advance(300));
    expect(d.latest()).toBeNull();
    d.up(110, 110, TOUCH);
    expect(d.onLongPress).not.toHaveBeenCalled();
  });

  test("a long-press arms the drag; moving then drags and release drops", async () => {
    const d = setup();
    d.down(110, 110, TOUCH);
    await act(() => d.clock.advance(350));
    expect(d.latest()?.phase).toBe("armed");
    d.move(160, 160, TOUCH);
    expect(d.latest()?.phase).toBe("dragging");
    d.up(160, 160, TOUCH);
    expect(d.onDrop).toHaveBeenCalledTimes(1);
    expect(d.onLongPress).not.toHaveBeenCalled();
  });

  test("cancel stops a waiting press, so the long-press never fires (a pinch took over)", async () => {
    const d = setup();
    d.down(110, 110, TOUCH);
    act(() => d.cancel());
    await act(() => d.clock.advance(400));
    expect(d.latest()).toBeNull();
    d.up(110, 110, TOUCH);
    expect(d.onLongPress).not.toHaveBeenCalled();
  });

  test("cancel puts down a card the long-press picked up", async () => {
    const d = setup();
    d.down(110, 110, TOUCH);
    await act(() => d.clock.advance(350));
    expect(d.isHolding()).toBe(true);
    act(() => d.cancel());
    expect(d.isHolding()).toBe(false);
    d.up(110, 110, TOUCH);
    expect(d.onLongPress).not.toHaveBeenCalled();
    expect(d.onDrop).not.toHaveBeenCalled();
  });

  test("a long-press released without moving opens the context menu instead", async () => {
    const d = setup();
    d.down(110, 110, TOUCH);
    await act(() => d.clock.advance(350));
    d.up(111, 111, TOUCH);
    expect(d.onLongPress).toHaveBeenCalledTimes(1);
    expect(d.onLongPress.mock.calls[0]![1]).toEqual([111, 111]);
    expect(d.onDrop).not.toHaveBeenCalled();
    expect(d.latest()).toBeNull();
  });
});
