import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SkipLink } from "@/ui/app/SkipLink";

import { withI18n } from "../i18n";

afterEach(cleanup);

describe("SkipLink", () => {
  test("is the first stop and moves the focus past the header to the main content", async () => {
    render(
      withI18n(
        <>
          <SkipLink />
          <header>
            <button type="button">Toolbar</button>
          </header>
          <main>content</main>
        </>,
      ),
    );
    const user = userEvent.setup();
    await user.tab();
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(document.activeElement).toBe(link);
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });
});
