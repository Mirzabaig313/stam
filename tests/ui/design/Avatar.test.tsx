import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render, screen } from "@testing-library/react";

import { Avatar } from "@/ui/design/Avatar";
import { avatarHue, initialsFor } from "@/ui/design/avatarHue";

afterEach(cleanup);

describe("avatarHue", () => {
  test("is one of the six hues, the same for the same name whatever the case or spacing", () => {
    for (const name of ["Ali Khan", "Zainab", "علی خان", "李小龙", "x"]) {
      const hue = avatarHue(name);
      expect(Number.isInteger(hue) && hue >= 0 && hue < 6).toBe(true);
      expect(avatarHue(`  ${name.toUpperCase()} `)).toBe(hue);
    }
    expect(avatarHue("")).toBe(0);
  });

  test("spreads names over the hues", () => {
    const names = ["Ahmed", "Sara", "Ali", "Zainab", "Omar", "Fatima", "Hassan", "Ayesha", "Bilal"];
    expect(new Set(names.map(avatarHue)).size).toBeGreaterThanOrEqual(4);
  });
});

describe("initialsFor", () => {
  test("the first letters of the first two words, by code point", () => {
    expect(initialsFor("Ali Khan")).toBe("AK");
    expect(initialsFor("  zainab  ")).toBe("Z");
    expect(initialsFor("Muhammad Ali Jinnah")).toBe("MA");
    expect(initialsFor("علی خان")).toBe("عخ");
    expect(initialsFor("𝒜da Lovelace")).toBe("𝒜L");
    expect(initialsFor("")).toBe("");
  });
});

describe("Avatar", () => {
  test("without a photo: initials on the name's hue, decorative", () => {
    const { container } = render(<Avatar name="Ali Khan" />);
    const avatar = container.querySelector(".avatar")!;
    expect(avatar.textContent).toBe("AK");
    expect(avatar.getAttribute("data-hue")).toBe(String(avatarHue("Ali Khan")));
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
  });

  test("with a photo: the image, no hue", () => {
    const { container } = render(<Avatar name="Ali Khan" photoUrl="blob:photo" size="lg" />);
    const avatar = container.querySelector(".avatar")!;
    expect(avatar.classList.contains("avatar--lg")).toBe(true);
    expect(avatar.hasAttribute("data-hue")).toBe(false);
    expect(avatar.querySelector("img")?.getAttribute("src")).toBe("blob:photo");
    expect(avatar.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  test("with a label: an image named for assistive technology", () => {
    render(<Avatar name="Ali Khan" label="Photo of Ali Khan" />);
    expect(screen.getByRole("img", { name: "Photo of Ali Khan" })).toBeTruthy();
  });
});
