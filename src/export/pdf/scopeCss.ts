/**
 * Puts `scope` in front of every selector of a flat stylesheet, so its rules reach only what sits
 * inside the wrapper. At-rules are left as they are (the export theme has none after the font
 * faces are taken out).
 */
export function scopeCss(css: string, scope: string): string {
  return css.replace(
    /(^|\})(\s*)([^{}@]+)\{/g,
    (_all, close: string, space: string, list: string) => {
      const scoped = list
        .split(",")
        .map((selector) => `${scope} ${selector.trim()}`)
        .join(", ");
      return `${close}${space}${scoped}{`;
    },
  );
}
