import { describe, expect, test } from "bun:test";

import en from "@/i18n/locales/en.json";
import { VIEW_MODES } from "@/ui/store/viewLayouts";

describe("view labels", () => {
  test("every view mode has a plain-string label under views.mode", () => {
    const modes = (en.views as Record<string, unknown>).mode as Record<string, unknown>;
    expect(modes).toEqual({
      family: "Family",
      pedigree: "Pedigree",
      descendants: "Descendants",
      hourglass: "Hourglass",
      fan: "Fan",
      timeline: "Timeline",
    });
    for (const mode of VIEW_MODES) expect(typeof modes[mode]).toBe("string");
  });

  test("no plain mode label sits beside the renderers' views.fan / views.timeline groups", () => {
    const views = en.views as Record<string, unknown>;
    for (const mode of VIEW_MODES) {
      if (mode in views) expect(typeof views[mode]).toBe("object");
    }
    expect(typeof views.fan).toBe("object");
    expect(typeof views.timeline).toBe("object");
  });
});
