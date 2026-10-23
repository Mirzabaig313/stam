/**
 * Puts `<script src>` (a classic, blocking script) at the top of the page's head, before any
 * stylesheet or module, so it runs before the first paint. Bun's HTML bundler folds classic
 * scripts into the module bundle, so blocking scripts are added after the build.
 */
export function injectHeadScript(html: string, src: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (!head) throw new Error("injectHeadScript: the page has no <head>");
  const start = head.index + head[0].length;
  const first = /<link\b|<script\b|<style\b/i.exec(html.slice(start));
  const at = first ? start + first.index : start;
  return `${html.slice(0, at)}<script src="${src}"></script>${html.slice(at)}`;
}
