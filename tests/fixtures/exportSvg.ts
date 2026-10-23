import type { ExportPerson, RenderedSvg } from "@/export/types";

/**
 * A hand-written stand-in for lane R's `renderTreeSvg` output: a standalone SVG whose card
 * groups carry `data-person-id`, with text already escaped the way the renderer escapes it.
 */
export const fixtureSvg: RenderedSvg = {
  width: 520,
  height: 300,
  svg: [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"',
    ' width="520" height="300" viewBox="0 0 520 300">',
    "<style>.card{fill:#fff;stroke:#111311}.name{font:600 14px system-ui;fill:#111311}</style>",
    '<path d="M130 90 V150 H390 V210" fill="none" stroke="#111311"/>',
    '<g data-person-id="p-adam" transform="translate(48 48)">',
    '<rect class="card" width="164" height="64" rx="6"/>',
    '<text class="name" x="12" y="28">Adam Hadžić</text></g>',
    '<g data-person-id="p-hana" transform="translate(300 48)">',
    '<rect class="card" width="164" height="64" rx="6"/>',
    '<text class="name" x="12" y="28">Hana Hadžić</text></g>',
    '<g data-person-id="p-evil" transform="translate(300 188)">',
    '<rect class="card" width="164" height="64" rx="6"/>',
    '<text class="name" x="12" y="28">&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;</text>',
    "</g></svg>",
  ].join(""),
};

export const fixturePeople: ExportPerson[] = [
  {
    id: "p-adam",
    name: "Adam Hadžić",
    lifespan: "1931 – 2004",
    details: [
      { label: "Born", value: "3 March 1931, Mostar" },
      { label: "Died", value: "2004" },
    ],
  },
  {
    id: "p-hana",
    name: "Hana Hadžić",
    nativeName: "هانا",
    lifespan: "b. 1935",
    details: [],
  },
  {
    id: "p-evil",
    name: "</script><img src=x onerror=alert(1)>",
    lifespan: "",
    details: [{ label: "Notes", value: '<b onclick="x()">bold</b> & </SCRIPT>' }],
  },
];

export const fixtureMeta = {
  title: "The Hadžić family",
  generatedAt: "23 October 2026",
  lang: "en",
  dir: "ltr" as const,
};
