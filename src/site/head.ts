// <head> tags for each prerendered page: title, description, canonical, Open Graph, Twitter
// and JSON-LD. Pure string building, used by scripts/prerender.ts.

import type { PageName } from "./components/Shell";
import { meta, site, SITE_URL } from "./content";

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export const PAGE_META = { home: meta.home, privacy: meta.privacy, notFound: meta.notFound };

export function headFor(page: PageName): string {
  const m = PAGE_META[page];
  const url = page === "notFound" ? undefined : `${SITE_URL}${m.path === "/" ? "/" : m.path}`;
  const image = `${SITE_URL}/og.png`;
  const tags = [
    `<title>${escape(m.title)}</title>`,
    `<meta name="description" content="${escape(m.description)}" />`,
    page === "notFound" ? `<meta name="robots" content="noindex" />` : "",
    url ? `<link rel="canonical" href="${url}" />` : "",
    `<meta name="theme-color" content="#F4F5F2" />`,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />`,
    `<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escape(site.name)}" />`,
    `<meta property="og:title" content="${escape(m.title)}" />`,
    `<meta property="og:description" content="${escape(m.description)}" />`,
    url ? `<meta property="og:url" content="${url}" />` : "",
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="A family tree drawn on ruled rows, one generation per row, beside the words Every family fits on rows." />`,
    `<meta property="og:locale" content="en_GB" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escape(m.title)}" />`,
    `<meta name="twitter:description" content="${escape(m.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ];
  if (page === "home") {
    const ld = {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: site.name,
      url: `${SITE_URL}/`,
      description: m.description,
      applicationCategory: "LifestyleApplication",
      operatingSystem: "Any (runs in a web browser)",
      browserRequirements: "Requires a modern web browser with JavaScript and IndexedDB",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      inLanguage: site.lang,
    };
    // JSON-LD is data, not script, so the CSP allows it. "<" is escaped so it cannot close the tag.
    tags.push(
      `<script type="application/ld+json">${JSON.stringify(ld).replaceAll("<", "\\u003c")}</script>`,
    );
  }
  return tags.filter(Boolean).join("\n    ");
}
