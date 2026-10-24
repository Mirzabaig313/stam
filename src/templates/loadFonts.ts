import { clearTextWidths, cssFont, type Font } from "./text";
import type { Template } from "./types";

/**
 * Waits for a template's fonts, so text is fitted with their real widths. Browsers fetch a web
 * font only when something is drawn in it; an export measures its cards before it draws them.
 * Outside a browser (tests) it does nothing.
 */
export async function loadTemplateFonts(template: Template): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  const { name, native, years, title } = template.fonts;
  const faces: Font[] = [
    name,
    native,
    years,
    title,
    { ...name, italic: true },
    { ...years, italic: true },
  ];
  await Promise.all(faces.map((f) => document.fonts.load(cssFont(f)).catch(() => [])));
  clearTextWidths();
}
