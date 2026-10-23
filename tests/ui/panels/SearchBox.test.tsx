import { afterEach, describe, expect, mock, test } from "bun:test";

import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SearchBox } from "@/ui/panels/SearchBox";

import { famSimple } from "../../fixtures/families";
import { renderWithStore } from "../../fixtures/panelEnv";

afterEach(cleanup);

async function open(props: Partial<Parameters<typeof SearchBox>[0]> = {}) {
  const onPick = mock((_id: string) => {});
  const onClose = mock(() => {});
  const view = await renderWithStore(
    <SearchBox onPick={onPick} onClose={onClose} {...props} />,
    famSimple(),
  );
  return { ...view, onPick, onClose, user: userEvent.setup() };
}

const khans = () => screen.getAllByRole("button", { name: /Khan/ });

const names = () =>
  within(screen.getByRole("list", { name: "Matching people" }))
    .queryAllByRole("button")
    .map((o) => o.textContent);

describe("SearchBox", () => {
  test("focuses the input and lists nothing for a blank query", async () => {
    await open();
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    expect(screen.queryAllByRole("button", { name: /Khan/ })).toHaveLength(0);
  });

  test("lists matches from searchPeople, with lifespans", async () => {
    const { user } = await open();
    await user.type(screen.getByRole("searchbox"), "ali");
    expect(names()).toEqual(["Ali Khan1980"]);
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "khan");
    expect(names()).toHaveLength(5);
  });

  test("says when nothing matches", async () => {
    const { user } = await open();
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("No one matches “zzz”.")).toBeTruthy();
  });

  test("Enter picks the first result", async () => {
    const { user, onPick } = await open();
    await user.type(screen.getByRole("searchbox"), "ali{Enter}");
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("c1");
  });

  test("arrow keys move the active result, wrapping at the ends", async () => {
    const { user, onPick } = await open();
    const input = screen.getByRole("searchbox");
    await user.type(input, "khan");
    expect(khans()[0]!.getAttribute("aria-current")).toBe("true");
    expect(khans()[1]!.getAttribute("aria-current")).toBeNull();
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("button", { name: /Khan/ })[1]!.getAttribute("aria-current")).toBe(
      "true",
    );
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getAllByRole("button", { name: /Khan/ })[4]!.getAttribute("aria-current")).toBe(
      "true",
    );
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith("c3");
  });

  test("clicking a result picks it", async () => {
    const { user, onPick } = await open();
    await user.type(screen.getByRole("searchbox"), "zain");
    await user.click(screen.getByRole("button", { name: /Zainab Khan/ }));
    expect(onPick).toHaveBeenCalledWith("c2");
  });

  test("Enter with no results picks nothing", async () => {
    const { user, onPick } = await open();
    await user.type(screen.getByRole("searchbox"), "zzz{Enter}");
    expect(onPick).not.toHaveBeenCalled();
  });

  test("Esc closes", async () => {
    const { user, onClose } = await open();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  test("names are in bdi", async () => {
    const { user } = await open();
    await user.type(screen.getByRole("searchbox"), "ali");
    expect(screen.getAllByRole("button", { name: /Khan/ })[0]!.querySelector("bdi")).toBeTruthy();
  });

  test("picker mode has its own title and the same behaviour", async () => {
    const { user, onPick } = await open({ mode: "picker" });
    expect(screen.getByRole("heading", { name: "Choose a person" })).toBeTruthy();
    await user.type(screen.getByRole("searchbox"), "omar{Enter}");
    expect(onPick).toHaveBeenCalledWith("c3");
  });

  test("search mode is titled 'Search people'", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Search people" })).toBeTruthy();
  });

  test("excluded people are not offered", async () => {
    const { user } = await open({ mode: "picker", exclude: new Set(["c1"]) });
    await user.type(screen.getByRole("searchbox"), "khan");
    expect(names()).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /Ali Khan/ })).toBeNull();
  });
});
