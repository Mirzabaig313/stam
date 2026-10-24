// Every visible string on the public pages, in one place, so Urdu and Arabic can follow.
// Rules: sentence case, no em or en dashes, no filler verbs, only true statements.
//
// Assumptions (mirrored in the M5 report):
// - The sample family (Linden, Haddad, ...) is invented and labelled as a sample on the page.
// - Hosting facts on /privacy assume Cloudflare Pages with no extra logging or analytics.
// - The contact address is stam@mirzalabs.in; no source link is published yet.

import { APP_NAME } from "@/config";

export const SITE_URL = "https://stam.mirzalabs.in";
export const CONTACT_EMAIL = "stam@mirzalabs.in";
export const APP_PATH = "/app";

export const site = {
  name: APP_NAME,
  url: SITE_URL,
  lang: "en",
  cta: "Start your tree",
  skip: "Skip to content",
  nav: [
    { label: "How it builds", href: "/#chapters" },
    { label: "Privacy", href: "/privacy" },
  ],
  homeLabel: `${APP_NAME}, home`,
  theme: { toDark: "Switch to dark theme", toLight: "Switch to light theme" },
};

export type PageMeta = {
  path: string;
  title: string;
  description: string;
};

export const meta = {
  home: {
    path: "/",
    title: `${APP_NAME}: a free family tree builder, one generation per row`,
    description:
      "Build your family tree in the browser. Add a person and the layout puts each generation on its own row. Free, no account, and your data stays on your device.",
  },
  privacy: {
    path: "/privacy",
    title: `Privacy at ${APP_NAME}: your family tree stays in your browser`,
    description: `${APP_NAME} has no accounts, no server storage and no cookies. Your family tree is saved in your own browser, and you can download a backup at any time.`,
  },
  notFound: {
    path: "/404",
    title: `No record of this page at ${APP_NAME}`,
    description: `This address has no page. Go back to the start, or open ${APP_NAME} and start your family tree.`,
  },
} satisfies Record<string, PageMeta>;

export const hero = {
  titleLines: ["Every family", "fits on rows."],
  lede: "A free family tree builder that runs in your browser. Add one person, then their family, and every generation gets its own row.",
  secondary: "See how it builds",
  facts: ["Free", "No account", "Stays on your device"],
  treeLabel: "A sample family drawn by the layout engine",
};

export const chaptersIntro = {
  heading: "How a tree builds itself",
  text: "Scroll, and the same engine that runs the editor adds a sample family one step at a time. You never drag a box into place.",
  sampleNote: "The Linden family is a made-up sample.",
};

export const chapters = [
  {
    title: "One person",
    text: "Start with anyone: yourself, a grandparent, the person you know most about. They sit on row I.",
  },
  {
    title: "A partner",
    text: "A partner joins the same row, side by side. A double line means married.",
  },
  {
    title: "Their children",
    text: "Children go one row down and hang from the line between their parents. Row II opens.",
  },
  {
    title: "Grandchildren",
    text: "Partners marry in, and the next generation takes row III. Branches move apart so nothing overlaps.",
  },
  {
    title: "Remarriage and adoption",
    text: "Sami divorced, remarried and adopted Theo. A dashed line marks the divorce, a dotted line the adoption. Real families fit too.",
  },
];

export const dragDrop = {
  heading: "Rearrange by dragging",
  text: "Pick up any card and drop it where it belongs. The rows re-flow around it.",
  rules: [
    {
      term: "Between siblings",
      text: "Drop a card between brothers and sisters to change their order.",
    },
    {
      term: "On a person",
      text: "Drop it on someone and choose: child, partner or parent. Only moves that make sense are offered.",
    },
    { term: "Undo", text: "Every drop is one step. Ctrl+Z puts it back." },
  ],
  demoLabel: "Demo: Ines is dragged to the start of her row, and her siblings move over.",
};

export type ExportFormat = {
  id: string;
  name: string;
  text: string;
  available: boolean;
  /** How the preview frames the sample tree. */
  sheet: "file" | "image" | "poster" | "tiles" | "page";
  caption: string;
};

export const exportsSection = {
  heading: "Take your tree anywhere",
  text: "One tree, many formats. The backup file works today. Prints and images come next.",
  availableLabel: "Available now",
  comingLabel: "Coming soon",
  nextLabel: "Coming next",
  formats: [
    {
      id: "json",
      name: "Backup file",
      text: "Everything, photos included, in one file you can open again on any device.",
      available: true,
      sheet: "file",
      caption: "the-linden-family.stam.json",
    },
    {
      id: "pdf",
      name: "PDF poster",
      text: "One page from A4 to A0, with sharp vector text for printing.",
      available: false,
      sheet: "poster",
      caption: "A2 poster, landscape",
    },
    {
      id: "tiled",
      name: "Tiled PDF",
      text: "A big tree split over A4 pages with marks to line them up.",
      available: false,
      sheet: "tiles",
      caption: "Six A4 pages with alignment marks",
    },
    {
      id: "png",
      name: "PNG and JPEG",
      text: "Images up to four times sharper than the screen.",
      available: false,
      sheet: "image",
      caption: "PNG at 2x",
    },
    {
      id: "svg",
      name: "SVG",
      text: "Vector drawing with the fonts embedded, ready for a designer.",
      available: false,
      sheet: "image",
      caption: "SVG, fonts embedded",
    },
    {
      id: "html",
      name: "Web page",
      text: "One file with zoom, search and details. Opens without internet.",
      available: false,
      sheet: "page",
      caption: "the-linden-family.html",
    },
  ] satisfies ExportFormat[],
};

export const calculator = {
  heading: "How are we related?",
  text: "Pick two people and get the answer in a sentence.",
  note: "A preview: the calculator is coming in a later version. This demo only knows the sample family.",
  pickFirst: "Pick a person.",
  pickSecond: (name: string) => `${name} is picked. Now pick a second person.`,
  reset: "Clear",
  start: { a: "lena", b: "noor" },
};

export const privacySection = {
  heading: "Your family stays on your device.",
  facts: [
    { term: "No account", text: "There is nothing to sign up for. Open it and start." },
    {
      term: "No server",
      text: "Your tree is saved in this browser's own storage. It is never uploaded.",
    },
    {
      term: "No cookies",
      text: "No cookies, no analytics, no tracking scripts. Not on this page either.",
    },
    {
      term: "Your backup",
      text: "Download a backup file whenever you like and open it on another device.",
    },
  ],
  more: "Read the privacy details",
};

export const footer = {
  wordmark: APP_NAME,
  etymology: `${APP_NAME} is Dutch for stem and lineage. A family tree is a stamboom.`,
  languages: "English. Urdu and Arabic are on the way.",
  colophon: "Set in Archivo. Every tree on this page is drawn by the same engine as the editor.",
  colophonPlain: "Set in Archivo. No cookies, no tracking, no third-party requests on any page.",
  links: [
    { label: "Start your tree", href: APP_PATH },
    { label: "How it builds", href: "/#chapters" },
    { label: "Privacy", href: "/privacy" },
    { label: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
  ],
};

export const privacyPage = {
  title: "Privacy",
  lede: `${APP_NAME} is built so that your family's details never leave your device. Here is exactly what that means.`,
  updated: "Last updated 23 October 2026",
  columns: ["Question", "In short", "In detail"],
  sections: [
    {
      heading: "What is stored",
      answer: "What you add",
      body: [
        "The people you add, their dates, places, notes and photos, and how they are related. Photos are shrunk to at most 512 pixels on your device before they are saved.",
      ],
    },
    {
      heading: "Where it is stored",
      answer: "This browser",
      body: [
        "In your browser's own storage (IndexedDB) on this device. Nothing is sent to a server, because there is no server that could receive it.",
        "That also means clearing your browser's site data deletes your trees. Download a backup now and then; the app reminds you.",
      ],
    },
    {
      heading: "What is never collected",
      answer: "Everything else",
      body: [
        "There are no accounts, no cookies, no analytics, no advertising and no third-party scripts. The pages load only files from this site.",
      ],
    },
    {
      heading: "Backups and sharing",
      answer: "A file you keep",
      body: [
        "A backup is a file you download and keep. It goes wherever you put it. You can open it again in the app on any device.",
      ],
    },
    {
      heading: "Hosting",
      answer: "Static files",
      body: [
        "The site is served as static files by Cloudflare Pages. Like any web host, Cloudflare handles your IP address to deliver the files and protect the service. The site itself keeps no logs and sees none of your tree.",
      ],
    },
  ],
  back: "Back to the start",
};

export const notFound = {
  card: "No record",
  heading: "This branch has no record.",
  text: "The page you followed is not in the register. It may have moved, or the address has a typo.",
  home: "Back to the start",
};
