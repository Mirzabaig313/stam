import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Toolbar } from "@/ui/app/Toolbar";
import { TreeListPage } from "@/ui/app/TreeListPage";
import { setCurrentMotion } from "@/ui/settings/motion";
import { DEFAULT_SETTINGS, setCurrentSettings, type Settings } from "@/ui/settings/settings";
import { SettingsDialog } from "@/ui/settings/SettingsDialog";
import { createEditorStore } from "@/ui/store/editorStore";
import { EditorContext } from "@/ui/store/useEditor";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";

type Env = Awaited<ReturnType<typeof makeEditorEnv>>;
let env: Env;
const html = () => document.documentElement;

beforeEach(async () => {
  env = await makeEditorEnv();
  localStorage.clear();
  setCurrentSettings(DEFAULT_SETTINGS);
  setCurrentMotion("system");
});

afterEach(() => {
  cleanup();
  setCurrentSettings(DEFAULT_SETTINGS);
  setCurrentMotion("system");
  localStorage.clear();
});

function open() {
  let closed = 0;
  renderApp(<SettingsDialog onClose={() => closed++} />, { repo: env.repo });
  return { closed: () => closed, user: userEvent.setup() };
}

const stored = () => env.repo.getSetting<Settings>("ui");

describe("SettingsDialog", () => {
  test("shows the current settings", () => {
    setCurrentSettings({ ...DEFAULT_SETTINGS, theme: "classic", colorMode: "branch" });
    open();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Classic/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: /By branch/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("radio", { name: "Auto" }).getAttribute("aria-checked")).toBe("true");
  });

  test("two columns: appearance, and language and layout", () => {
    open();
    const appearance = screen.getByRole("region", { name: "Appearance" });
    const layout = screen.getByRole("region", { name: "Language and layout" });
    expect(
      within(appearance).getAllByRole("radio", { name: /Light|Dark|Classic|Print/ }),
    ).toHaveLength(4);
    expect(within(appearance).getByRole("radiogroup", { name: "Card colours" })).toBeTruthy();
    expect(within(layout).getByRole("combobox", { name: "Language" })).toBeTruthy();
    expect(within(layout).getByRole("radiogroup", { name: "Tree direction" })).toBeTruthy();
    expect(within(layout).getByRole("radiogroup", { name: "Reduce motion" })).toBeTruthy();
    // A visible close button, and each theme drawn in miniature.
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(document.querySelectorAll(".theme-preview")).toHaveLength(4);
  });

  test("arrow keys move through the card colours", async () => {
    const { user } = open();
    screen.getByRole("radio", { name: /By gender/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(html().getAttribute("data-color-mode")).toBe("branch");
  });

  test("each theme and colour mode is described", () => {
    open();
    const dark = screen.getByRole("radio", { name: "Dark" });
    const hint = document.getElementById(dark.getAttribute("aria-describedby")!);
    expect(hint?.textContent).toContain("night");
  });

  test("a theme applies at once and is saved through the repo", async () => {
    const { user } = open();
    await user.click(screen.getByRole("radio", { name: /Dark/ }));
    expect(html().getAttribute("data-theme")).toBe("dark");
    await waitFor(async () => expect((await stored())?.theme).toBe("dark"));
    expect(JSON.parse(localStorage.getItem("stam:settings")!).theme).toBe("dark");
    // Picked by the user, so the landing page follows it too.
    expect(JSON.parse(localStorage.getItem("stam:settings")!).themeChosen).toBe(true);
  });

  test("picking the theme already in use (the default Light) still counts as a choice", async () => {
    const { user } = open();
    const light = screen.getByRole("radio", { name: /Light/ }) as HTMLInputElement;
    expect(light.checked).toBe(true);
    await user.click(light);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("stam:settings") ?? "{}").themeChosen).toBe(true),
    );
    expect(html().getAttribute("data-theme")).toBe("light");
  });

  test("card colours and tree direction", async () => {
    const { user } = open();
    await user.click(screen.getByRole("radio", { name: /By generation/ }));
    expect(html().getAttribute("data-color-mode")).toBe("generation");
    await user.click(screen.getByRole("radio", { name: /Right to left/ }));
    await waitFor(async () =>
      expect(await stored()).toMatchObject({ colorMode: "generation", treeDirection: "rtl" }),
    );
    // No theme was picked: the landing page keeps following the OS.
    expect(JSON.parse(localStorage.getItem("stam:settings")!).themeChosen).toBeUndefined();
  });

  test("the language picker lists English, Urdu and Arabic, each in its own script", () => {
    open();
    const select = screen.getByRole("combobox", { name: "Language" }) as HTMLSelectElement;
    const options = [...select.options];
    expect(options.map((o) => o.value)).toEqual(["en", "ur", "ar"]);
    expect(options.map((o) => o.getAttribute("lang"))).toEqual(["en", "ur", "ar"]);
    expect(options.map((o) => o.textContent)).toEqual(["English", "اردو", "العربية"]);
  });

  test("choosing Urdu translates the dialog at once, with no reload, and notes the review", async () => {
    const { user } = open();
    await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "ur");
    // Strings, <html lang dir> and (through lang) the font all follow.
    expect(await screen.findByRole("dialog", { name: "ترتیبات" })).toBeTruthy();
    expect(html().lang).toBe("ur");
    expect(html().dir).toBe("rtl");
    const select = screen.getByRole("combobox", { name: "زبان" });
    const note = document.getElementById(select.getAttribute("aria-describedby")!);
    expect(note?.textContent).toBeTruthy();
    await waitFor(async () => expect((await stored())?.language).toBe("ur"));

    await user.selectOptions(select, "ar");
    expect(await screen.findByRole("dialog", { name: "الإعدادات" })).toBeTruthy();
    expect(html().lang).toBe("ar");

    await user.selectOptions(screen.getByRole("combobox", { name: "اللغة" }), "en");
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect(html().dir).toBe("ltr");
    // English needs no review note.
    expect(
      screen.getByRole("combobox", { name: "Language" }).hasAttribute("aria-describedby"),
    ).toBe(false);
  });

  test("reduce motion follows the device until chosen", async () => {
    const { user } = open();
    const group = screen.getByRole("radiogroup", { name: "Reduce motion" });
    expect(within(group).getByRole("radio", { name: "Device" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    await user.click(within(group).getByRole("radio", { name: /^On/ }));
    expect(html().getAttribute("data-motion")).toBe("reduce");
    await waitFor(async () => expect(await env.repo.getSetting("motion")).toBe("reduce"));
    await user.click(within(group).getByRole("radio", { name: "Device" }));
    expect(html().hasAttribute("data-motion")).toBe(false);
  });

  test("Done and Escape close it", async () => {
    const { user, closed } = open();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(closed()).toBe(1);
    await user.keyboard("{Escape}");
    expect(closed()).toBe(2);
  });
});

describe("where it opens", () => {
  test("from the editor's menu", async () => {
    const doc = famSimple();
    await env.repo.saveTree(doc);
    const { autosaver } = env;
    const store = createEditorStore({ repo: env.repo, autosaver, now: env.now });
    await store.getState().load(doc.id);
    renderApp(
      <EditorContext.Provider value={store}>
        <Toolbar
          autosaver={autosaver}
          onZoomIn={() => {}}
          onZoomOut={() => {}}
          onFit={() => {}}
          onOpenSearch={() => {}}
          onOpenUnconnected={() => {}}
        />
      </EditorContext.Provider>,
      { repo: env.repo },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Appearance" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    // The menu closed behind it.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("from the tree list", async () => {
    renderApp(<TreeListPage />, { repo: env.repo });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
  });
});
