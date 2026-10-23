import { afterEach, describe, expect, mock, test } from "bun:test";

import { act, cleanup, renderHook } from "@testing-library/react";

import type { LayoutResult } from "@/core/layout/types";
import { useCenterAfterLayout } from "@/ui/app/useCenterAfterLayout";

afterEach(cleanup);

/** Only `primaryNode` matters to the hook. */
const layoutWith = (...personIds: string[]) =>
  ({
    primaryNode: Object.fromEntries(personIds.map((id) => [id, `n-${id}`])),
  }) as unknown as LayoutResult;

function setup(initial: LayoutResult | null) {
  const centerOn = mock((_id: string) => {});
  const view = renderHook(({ layout }) => useCenterAfterLayout(layout, centerOn), {
    initialProps: { layout: initial },
  });
  return { centerOn, ...view };
}

describe("useCenterAfterLayout", () => {
  test("a person who is already in the layout is centred right after the commit", () => {
    const { centerOn, result } = setup(layoutWith("a", "b"));
    act(() => result.current("b"));
    expect(centerOn).toHaveBeenCalledTimes(1);
    expect(centerOn).toHaveBeenCalledWith("b");
  });

  test("waits for the layout that contains the person, then centres once", () => {
    const { centerOn, result, rerender } = setup(layoutWith("a"));
    act(() => result.current("z"));
    expect(centerOn).not.toHaveBeenCalled();

    rerender({ layout: layoutWith("a") }); // a layout without z: still waiting
    expect(centerOn).not.toHaveBeenCalled();

    rerender({ layout: layoutWith("a", "z") });
    expect(centerOn).toHaveBeenCalledTimes(1);
    expect(centerOn).toHaveBeenCalledWith("z");

    rerender({ layout: layoutWith("a", "z", "y") }); // the request is cleared
    expect(centerOn).toHaveBeenCalledTimes(1);
  });

  test("does not centre in the requesting tick, only after the commit that has the node", () => {
    const calls: string[] = [];
    const centerOn = (id: string) => calls.push(`center ${id}`);
    const view = renderHook(({ layout }) => useCenterAfterLayout(layout, centerOn), {
      initialProps: { layout: layoutWith("a") },
    });
    act(() => {
      view.result.current("z");
      calls.push("requested");
    });
    expect(calls).toEqual(["requested"]);
    view.rerender({ layout: layoutWith("a", "z") });
    expect(calls).toEqual(["requested", "center z"]);
  });

  test("a later request replaces an earlier one that never arrived", () => {
    const { centerOn, result, rerender } = setup(layoutWith("a"));
    act(() => result.current("gone"));
    act(() => result.current("b"));
    rerender({ layout: layoutWith("a", "b") });
    expect(centerOn.mock.calls).toEqual([["b"]]);
  });

  test("asking with null drops a request that can no longer be met (I2)", () => {
    const { centerOn, result, rerender } = setup(layoutWith("a"));
    act(() => result.current("z"));
    act(() => result.current(null));
    rerender({ layout: layoutWith("a", "z") }); // z appears later, for another reason
    expect(centerOn).not.toHaveBeenCalled();
  });

  test("no layout yet: waits", () => {
    const { centerOn, result, rerender } = setup(null);
    act(() => result.current("a"));
    expect(centerOn).not.toHaveBeenCalled();
    rerender({ layout: layoutWith("a") });
    expect(centerOn).toHaveBeenCalledWith("a");
  });

  test("the request function keeps its identity", () => {
    const { result, rerender } = setup(layoutWith("a"));
    const first = result.current;
    rerender({ layout: layoutWith("a", "b") });
    expect(result.current).toBe(first);
  });
});
