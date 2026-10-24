import { albumFace } from "./faces/album";
import { TEMPLATE_IDS, type TemplateId } from "./look";
import { MEDALLION_R } from "./medallion";
import { DEFAULT_FAMILY, type Font } from "./text";
import type { FaceDrawing, FaceInput, Palette, Template } from "./types";

// Families, with the app's own Archivo after each: "Archivo Variable" carries Naskh for the
// Arabic-script range (src/i18n/fonts.css), so a native name in any template falls through to it.
export const FAMILIES = {
  archivo: DEFAULT_FAMILY,
  cormorant: '"Cormorant Garamond Variable", "Archivo Variable", Georgia, serif',
  fraunces: '"Fraunces Variable", "Archivo Variable", Georgia, serif',
  caveat: '"Caveat Variable", "Archivo Variable", cursive',
  nastaliq: '"Noto Nastaliq Urdu Variable", "Archivo Variable", serif',
} as const;

const font = (family: string, size: number, weight = 400, italic = false): Font => ({
  family,
  size,
  weight,
  ...(italic ? { italic } : {}),
});

/** The album hues (tokens.css), for initials on a soft disc. */
const LIGHT_HUES = ["#f5d6c0", "#d6e5c3", "#cadcf0", "#efcfdf", "#f3e0a6", "#c7e3dc"] as const;
const DARK_HUES = ["#4a2f22", "#2c3a24", "#22324a", "#44263a", "#433816", "#1f3b35"] as const;

/** The deep sky and rose of tokens.css, and their dark-theme pair. */
const LIGHT_MARKS = { male: "#3d6a9e", female: "#a3466f" };
const DARK_MARKS = { male: "#8db3e0", female: "#e39abb" };

const palette = (
  p: Omit<Palette, "hues" | "male" | "female"> & Partial<Pick<Palette, "hues" | "male" | "female">>,
): Palette => ({
  hues: LIGHT_HUES,
  ...(p.hues === DARK_HUES ? DARK_MARKS : LIGHT_MARKS),
  ...p,
});

/**
 * The Print theme: black on white, for any printer, in every template. The template keeps its
 * shapes, type and marks; fills go, a deceased card keeps a faint grey, and the gender markers are
 * black and a mid grey.
 */
const PRINT: Palette = {
  ground: "#ffffff",
  card: "#ffffff",
  cardDeceased: "#eeeeee",
  ink: "#000000",
  muted: "#3d3d3d",
  edge: "#000000",
  line: "#000000",
  accent: "#000000",
  onAccent: "#ffffff",
  soft: "#8c8c8c",
  memorial: "#000000",
  hues: ["#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2"],
  male: "#000000",
  female: "#6b6b6b",
};

export const TEMPLATES: Record<TemplateId, Template> = {
  album: {
    id: "album",
    growth: "down",
    palettes: {
      light: palette({
        ground: "#efe4da",
        card: "#fffdf9",
        cardDeceased: "#f1e6d6",
        ink: "#2b1f26",
        muted: "#6b5560",
        edge: "#d8c9bd",
        line: "#7d5a6c",
        accent: "#6e2a4f",
        onAccent: "#fff6f9",
        soft: "#f1d3df",
        memorial: "#1d1418",
      }),
      dark: palette({
        ground: "#1a1418",
        card: "#2b2329",
        cardDeceased: "#231c20",
        ink: "#f2e9ec",
        muted: "#bba7b0",
        edge: "#44383f",
        line: "#b896a6",
        accent: "#e3a6c6",
        onAccent: "#1a1418",
        soft: "#4a3040",
        memorial: "#0b0809",
        hues: DARK_HUES,
      }),
      paper: PRINT,
    },
    fonts: {
      name: font(FAMILIES.archivo, 19, 700),
      native: font(FAMILIES.archivo, 15),
      years: font(FAMILIES.caveat, 22, 500),
      title: font(FAMILIES.archivo, 18, 800),
    },
    connectors: { width: 2.2, radius: 0, wobble: 2.2, adoptedDash: "8 7" },
    face: albumFace,
  },

  heritage: {
    id: "heritage",
    growth: "down",
    palettes: {
      light: palette({
        ground: "#f4ead6",
        card: "#fbf5e8",
        cardDeceased: "#ecdcbd",
        ink: "#2a2018",
        muted: "#6b5a44",
        edge: "#2a2018",
        line: "#2a2018",
        accent: "#9c7a3c",
        onAccent: "#fbf5e8",
        soft: "#e7d7b4",
        memorial: "#2a2018",
      }),
      dark: palette({
        ground: "#1c1712",
        card: "#2a231b",
        cardDeceased: "#3a2f22",
        ink: "#efe4cf",
        muted: "#c3b293",
        edge: "#efe4cf",
        line: "#d8c8a8",
        accent: "#d0ab62",
        onAccent: "#1c1712",
        soft: "#4a3d2a",
        memorial: "#efe4cf",
        hues: DARK_HUES,
      }),
      paper: PRINT,
    },
    fonts: {
      name: font(FAMILIES.cormorant, 22, 700),
      native: font(FAMILIES.archivo, 15),
      years: font(FAMILIES.cormorant, 16, 500, true),
      title: font(FAMILIES.cormorant, 24, 600, true),
    },
    connectors: { width: 1.8, radius: 0, wobble: 0, coupleMark: "diamond", adoptedDash: "6 5" },
    face: albumFace,
  },

  botanical: {
    id: "botanical",
    growth: "up",
    palettes: {
      light: palette({
        ground: "#f6f2e7",
        card: "#fbf9f1",
        cardDeceased: "#f4e3c3",
        ink: "#2f3a27",
        muted: "#5d6852",
        edge: "#5f7f4b",
        line: "#6b4f3a",
        accent: "#4f7a3c",
        onAccent: "#fbf9f1",
        soft: "#8fae7b",
        memorial: "#a86f30",
      }),
      dark: palette({
        ground: "#151a13",
        card: "#1f271c",
        cardDeceased: "#33281a",
        ink: "#e8eedf",
        muted: "#b2bea6",
        edge: "#8fb07a",
        line: "#b08b6b",
        accent: "#93c07a",
        onAccent: "#151a13",
        soft: "#5f7d50",
        memorial: "#e0a35c",
        hues: DARK_HUES,
      }),
      paper: PRINT,
    },
    fonts: {
      name: font(FAMILIES.fraunces, 20, 600),
      native: font(FAMILIES.archivo, 15),
      years: font(FAMILIES.fraunces, 15, 400, true),
      title: font(FAMILIES.fraunces, 27, 500, true),
    },
    connectors: { width: 3, radius: 34, wobble: 0, taper: true, adoptedDash: "9 7" },
    face: albumFace,
  },

  gallery: {
    id: "gallery",
    growth: "down",
    palettes: {
      light: palette({
        ground: "#f1eee8",
        card: "#f1eee8",
        cardDeceased: "#f1eee8",
        ink: "#141414",
        muted: "#5f5b54",
        edge: "#141414",
        line: "#141414",
        accent: "#d2421d",
        onAccent: "#f1eee8",
        soft: "#dcd7cd",
        memorial: "#141414",
      }),
      dark: palette({
        ground: "#141414",
        card: "#141414",
        cardDeceased: "#141414",
        ink: "#f1eee8",
        muted: "#b4afa6",
        edge: "#f1eee8",
        line: "#d9d5cd",
        accent: "#ff6a45",
        onAccent: "#141414",
        soft: "#3a3833",
        memorial: "#f1eee8",
        hues: DARK_HUES,
      }),
      paper: PRINT,
    },
    fonts: {
      name: font(FAMILIES.archivo, 21, 700),
      native: font(FAMILIES.archivo, 16),
      years: font(FAMILIES.archivo, 16),
      title: font(FAMILIES.archivo, 58, 900),
    },
    connectors: {
      width: 2.4,
      radius: 0,
      wobble: 0,
      adoptedDash: "10 7",
      coupleMeets: MEDALLION_R,
    },
    face: albumFace,
  },

  shajara: {
    id: "shajara",
    growth: "down",
    preferredDirection: "rtl",
    palettes: {
      light: palette({
        ground: "#f5ecd7",
        card: "#fffaf0",
        cardDeceased: "#fffaf0",
        ink: "#2a1c14",
        muted: "#5a4a3a",
        edge: "#1f3a6b",
        line: "#3f6b4a",
        accent: "#1f3a6b",
        onAccent: "#fffaf0",
        soft: "#a8832f",
        memorial: "#a8832f",
      }),
      dark: palette({
        ground: "#0f1a33",
        card: "#17254a",
        cardDeceased: "#17254a",
        ink: "#f3ead6",
        muted: "#c8bda3",
        edge: "#9fb6e6",
        line: "#8cc29b",
        accent: "#9fb6e6",
        onAccent: "#0f1a33",
        soft: "#d6b45e",
        memorial: "#d6b45e",
        hues: DARK_HUES,
      }),
      paper: PRINT,
    },
    fonts: {
      name: font(FAMILIES.cormorant, 21, 600),
      native: font(FAMILIES.nastaliq, 22),
      years: font(FAMILIES.cormorant, 14, 600),
      title: font(FAMILIES.nastaliq, 25),
    },
    connectors: { width: 2.6, radius: 30, wobble: 0, adoptedDash: "2.5 7" },
    face: albumFace,
  },

  swiss: {
    id: "swiss",
    growth: "down",
    palettes: {
      light: palette({
        ground: "#ffffff",
        card: "#ffffff",
        cardDeceased: "#ffffff",
        ink: "#000000",
        muted: "#595959",
        edge: "#000000",
        line: "#000000",
        accent: "#000000",
        onAccent: "#ffffff",
        soft: "#ececec",
        memorial: "#000000",
      }),
      dark: palette({
        ground: "#000000",
        card: "#000000",
        cardDeceased: "#000000",
        ink: "#ffffff",
        muted: "#b3b3b3",
        edge: "#ffffff",
        line: "#ffffff",
        accent: "#ffffff",
        onAccent: "#000000",
        soft: "#262626",
        memorial: "#ffffff",
        hues: DARK_HUES,
      }),
      paper: PRINT,
    },
    fonts: {
      name: font(FAMILIES.archivo, 19, 700),
      native: font(FAMILIES.archivo, 15),
      years: font(FAMILIES.archivo, 15),
      title: font(FAMILIES.archivo, 18, 700),
    },
    connectors: { width: 1.6, radius: 0, wobble: 0, adoptedDash: "4 4" },
    face: albumFace,
  },
};

export const templateOf = (id: TemplateId): Template => TEMPLATES[id];

type Face = (input: FaceInput) => FaceDrawing;

/**
 * The faces other than Warm album's load the first time their template is used, so the app's
 * first load carries one face, not six. Until then a template draws with Album's face, which is
 * why everything that switches template waits for `loadFace` first.
 */
const FACES: Record<Exclude<TemplateId, "album">, () => Promise<Face>> = {
  heritage: () => import("./faces/heritage").then((m) => m.heritageFace),
  botanical: () => import("./faces/botanical").then((m) => m.botanicalFace),
  gallery: () => import("./faces/gallery").then((m) => m.galleryFace),
  shajara: () => import("./faces/shajara").then((m) => m.shajaraFace),
  swiss: () => import("./faces/swiss").then((m) => m.swissFace),
};

const loaded = new Set<TemplateId>(["album"]);

export const faceLoaded = (id: TemplateId) => loaded.has(id);

/** Loads a template's face once; afterwards `TEMPLATES[id]` is a new object that draws with it. */
export async function loadFace(id: TemplateId): Promise<void> {
  if (loaded.has(id)) return;
  const face = await FACES[id as Exclude<TemplateId, "album">]();
  TEMPLATES[id] = { ...TEMPLATES[id], face };
  loaded.add(id);
}

/** Every face: the Look dialog's previews, scripts and tests. */
export async function loadAllFaces(): Promise<void> {
  await Promise.all(TEMPLATE_IDS.map(loadFace));
}

/** The app's theme picks the template's palette: dark for dark, the paper one for Print. */
export function paletteFor(template: Template, theme: string): Palette {
  if (theme === "dark") return template.palettes.dark;
  if (theme === "print") return template.palettes.paper;
  return template.palettes.light;
}
