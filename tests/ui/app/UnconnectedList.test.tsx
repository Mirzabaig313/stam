import { afterEach, describe, expect, mock, test } from "bun:test";

import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UnconnectedList } from "@/ui/app/UnconnectedList";

import { docOf, famSimple, person } from "../../fixtures/families";
import { renderWithStore } from "../../fixtures/panelEnv";

afterEach(cleanup);

function withStrangers() {
  const doc = famSimple();
  return docOf(
    [
      ...Object.values(doc.persons),
      person("x1", "Nadia", "Lone", "female"),
      person("x2", "", "", "male"),
    ],
    Object.values(doc.unions),
    "dad",
  );
}

async function open(doc = withStrangers()) {
  const onPick = mock((_id: string) => {});
  const onClose = mock(() => {});
  const view = await renderWithStore(<UnconnectedList onPick={onPick} onClose={onClose} />, doc);
  return { ...view, onPick, onClose, user: userEvent.setup() };
}

describe("UnconnectedList", () => {
  test("lists the people layout.unreachable names, unnamed ones with a label", async () => {
    await open();
    const items = screen.getAllByRole("button", { name: /Nadia Lone|Unnamed person/ });
    expect(items.map((b) => b.textContent)).toEqual(["Nadia Lone", "Unnamed person"]);
    expect(screen.getByRole("region", { name: "Not connected" })).toBeTruthy();
  });

  test("names are in bdi", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Nadia Lone" }).querySelector("bdi")).toBeTruthy();
  });

  test("clicking a person sets the view root to them and closes", async () => {
    const { user, store, onPick, onClose } = await open();
    await user.click(screen.getByRole("button", { name: "Nadia Lone" }));
    expect(onPick).toHaveBeenCalledWith("x1");
    expect(store.getState().viewRootId).toBe("x1");
    expect(onClose).toHaveBeenCalled();
  });

  test("Esc and a click outside close it", async () => {
    const { user, onClose } = await open();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test("a click on the badge that opened it is left to the badge", async () => {
    const { onClose } = await open();
    const badge = document.createElement("button");
    badge.className = "toolbar-unconnected";
    document.body.append(badge);
    fireEvent.pointerDown(badge);
    expect(onClose).not.toHaveBeenCalled();
    badge.remove();
  });

  test("says so when everyone is connected", async () => {
    await open(famSimple());
    expect(screen.getByText("Everyone is connected.")).toBeTruthy();
  });
});
