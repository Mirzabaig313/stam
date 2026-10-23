// Dev-only page at /dev/design: every shared component (src/ui/design) in every theme, for review
// and screenshots. Not part of the production build (scripts/build.ts lists the real entries).
// ?theme=light|dark|classic|print shows one theme on the whole page (canvas theme rules included);
// without it the four themes are stacked. ?lang=ar shows the page in Arabic, right to left.
// The sample copy is dev tooling, not product UI, so it is not in the locale files.
import "@fontsource-variable/archivo/wdth.css";
import "@/i18n/fonts.css";
import "@/ui/styles/app.css";
import "@/ui/canvas/canvas.css";
import "./design.css";

import i18next from "i18next";
import { type ReactNode, StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";

import { layoutFamily } from "@/core/layout/family";
import ar from "@/i18n/locales/ar.json";
import en from "@/i18n/locales/en.json";
import { Edges } from "@/ui/canvas/Edges";
import { PersonCard } from "@/ui/cards/PersonCard";
import {
  Avatar,
  Button,
  Chip,
  Dialog,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Segmented,
  Select,
  Sheet,
  TextField,
} from "@/ui/design";
import type { Theme } from "@/ui/settings/settings";

import { bigFamily } from "./bigFamily";

const params = new URLSearchParams(location.search);
const LANG = params.get("lang") === "ar" ? "ar" : "en";
const ONLY = ["light", "dark", "classic", "print"].includes(params.get("theme") ?? "")
  ? (params.get("theme") as Theme)
  : null;
const THEMES: readonly Theme[] = ONLY ? [ONLY] : ["light", "dark", "classic", "print"];

document.documentElement.lang = LANG;
document.documentElement.dir = LANG === "ar" ? "rtl" : "ltr";
if (ONLY) document.documentElement.setAttribute("data-theme", ONLY);

const i18n = i18next.createInstance();
void i18n.init({
  lng: LANG,
  resources: { en: { translation: en }, ar: { translation: ar } },
  interpolation: { escapeValue: false },
  initAsync: false,
});

const COPY = {
  en: {
    title: "Stam design",
    intro:
      "A warm family album, with a premium edge. Every shared component, in every theme. Tokens: src/ui/styles/tokens.css; specs: DESIGN-APP.md.",
    themes: { light: "Light", dark: "Dark", classic: "Classic", print: "Print" },
    type: "Type",
    display: "The Khan family",
    displaySub: "Four generations, 38 people",
    body: "Zainab was born in Lahore in 1953, the second of three children.",
    years: "1920 – 1994",
    buttons: "Buttons",
    addPerson: "Add person",
    save: "Save changes",
    cancel: "Cancel",
    moreDetails: "More details",
    delete: "Delete…",
    deleteForever: "Delete tree",
    iconButtons: "Icon buttons",
    undo: "Undo",
    search: "Search",
    focus: "Focus on this family",
    fields: "Fields",
    firstName: "First name",
    born: "Born",
    bornHint: "A year is enough, like 1952",
    bornError: "Write the year as four digits, like 1952",
    notes: "Notes",
    colours: "Card colours",
    byGender: "By gender",
    byBranch: "By branch",
    byGeneration: "By generation",
    segmented: "Segmented",
    view: "View",
    family: "Family",
    ancestors: "Ancestors",
    descendants: "Descendants",
    chips: "Chips",
    living: "Living",
    deceased: "Deceased",
    branch: (n: number) => `Branch ${n + 1}`,
    removeLahore: "Remove Lahore",
    lahore: "Lahore",
    avatars: "Avatars",
    cards: "Cards on the canvas",
    menu: "Menu",
    openMenu: "Open the real menu",
    edit: "Edit details",
    addChild: "Add child",
    sheet: "Sheet",
    panelTitle: "Zainab Khan",
    closePanel: "Close panel",
    dialog: "Dialog",
    openDialog: "Open the real dialog",
    dialogTitle: "Rename tree",
    treeName: "Tree name",
    toast: "Toast",
    toastText: "A new version of Stam is ready.",
    reload: "Reload",
    empty: "Empty state",
    emptyTitle: "Start your family tree",
    emptyBody:
      "Add yourself, then your parents and grandparents. Everything stays on this device; nothing is uploaded.",
    newTree: "New tree",
    importFile: "Import a file",
    names: ["Ahmed Khan", "Sara Khan", "Zainab Khan", "Omar Raza", "Hina Malik", "Bilal Shah"],
  },
  ar: {
    title: "تصميم ستام",
    intro: "ألبوم عائلي دافئ بلمسة فاخرة. كل المكوّنات المشتركة، في كل سمة.",
    themes: { light: "فاتح", dark: "داكن", classic: "كلاسيكي", print: "طباعة" },
    type: "الخط",
    display: "عائلة خان",
    displaySub: "أربعة أجيال، ٣٨ شخصًا",
    body: "وُلدت زينب في لاهور عام 1953، وهي الثانية بين ثلاثة أطفال.",
    years: "1920 – 1994",
    buttons: "الأزرار",
    addPerson: "إضافة شخص",
    save: "حفظ التغييرات",
    cancel: "إلغاء",
    moreDetails: "تفاصيل أكثر",
    delete: "حذف…",
    deleteForever: "حذف الشجرة",
    iconButtons: "أزرار الأيقونات",
    undo: "تراجع",
    search: "بحث",
    focus: "التركيز على هذه العائلة",
    fields: "الحقول",
    firstName: "الاسم الأول",
    born: "الميلاد",
    bornHint: "تكفي السنة، مثل 1952",
    bornError: "اكتب السنة بأربعة أرقام، مثل 1952",
    notes: "ملاحظات",
    colours: "ألوان البطاقات",
    byGender: "حسب الجنس",
    byBranch: "حسب الفرع",
    byGeneration: "حسب الجيل",
    segmented: "مفتاح التبديل",
    view: "العرض",
    family: "العائلة",
    ancestors: "الأسلاف",
    descendants: "الذرية",
    chips: "الشارات",
    living: "على قيد الحياة",
    deceased: "متوفّى",
    branch: (n: number) => `الفرع ${n + 1}`,
    removeLahore: "إزالة لاهور",
    lahore: "لاهور",
    avatars: "الصور الرمزية",
    cards: "البطاقات على اللوحة",
    menu: "القائمة",
    openMenu: "افتح القائمة الحقيقية",
    edit: "تعديل التفاصيل",
    addChild: "إضافة طفل",
    sheet: "اللوحة الجانبية",
    panelTitle: "زينب خان",
    closePanel: "إغلاق اللوحة",
    dialog: "مربع الحوار",
    openDialog: "افتح مربع الحوار الحقيقي",
    dialogTitle: "إعادة تسمية الشجرة",
    treeName: "اسم الشجرة",
    toast: "الإشعار",
    toastText: "إصدار جديد من ستام جاهز.",
    reload: "إعادة التحميل",
    empty: "الحالة الفارغة",
    emptyTitle: "ابدأ شجرة عائلتك",
    emptyBody: "أضف نفسك، ثم والديك وأجدادك. كل شيء يبقى على هذا الجهاز ولا يُرفع شيء.",
    newTree: "شجرة جديدة",
    importFile: "استيراد ملف",
    names: ["أحمد خان", "سارة خان", "زينب خان", "عمر رضا", "هنا ملك", "بلال شاه"],
  },
} as const;

const c = COPY[LANG];

function Block({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? "ds-block ds-block--wide" : "ds-block"}>
      <h3 className="ds-block__title">{title}</h3>
      <div className="ds-block__body">{children}</div>
    </section>
  );
}

function CardsSample() {
  const { doc, nodes, edges, box } = useMemo(() => {
    const d = bigFamily(14, 7);
    const layout = layoutFamily(d, { rootId: d.rootPersonId ?? "" });
    const keep = layout.nodes.filter((n) => n.generation <= 1).slice(0, 5);
    const minX = Math.min(...keep.map((n) => n.x));
    const maxX = Math.max(...keep.map((n) => n.x + 180));
    const maxY = Math.max(...keep.map((n) => n.y + 72));
    const minY = Math.min(...keep.map((n) => n.y));
    return {
      doc: d,
      nodes: keep,
      edges: layout.edges.filter((e) =>
        e.points.every(
          ([x, y]) => x >= minX - 1 && x <= maxX + 1 && y >= minY - 1 && y <= maxY + 1,
        ),
      ),
      box: { x: minX - 30, y: minY - 30, w: maxX - minX + 60, h: maxY - minY + 60 },
    };
  }, []);
  return (
    <div className="stam-canvas ds-canvas" dir="ltr">
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} width="100%">
        <Edges edges={edges} lod="full" />
        {nodes.map((node, i) => (
          <PersonCard
            key={node.nodeId}
            doc={doc}
            node={node}
            selected={i === 1}
            tabbable={i === 0}
          />
        ))}
      </svg>
    </div>
  );
}

function ThemeSection({ theme }: { theme: Theme }) {
  const [colour, setColour] = useState("branch");
  const [view, setView] = useState<"family" | "ancestors" | "descendants">("family");
  const [living, setLiving] = useState(true);
  const [menuAt, setMenuAt] = useState<[number, number] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="ds-theme" data-theme={theme}>
      <h2 className="display ds-theme__name">{c.themes[theme]}</h2>
      <div className="ds-grid">
        <Block title={c.type}>
          <p className="display display--lg">{c.display}</p>
          <p className="display display--md">{c.displaySub}</p>
          <p>{c.body}</p>
          <p className="muted years">{c.years}</p>
        </Block>

        <Block title={c.buttons}>
          <div className="ds-row">
            <Button variant="primary" icon="plus">
              {c.addPerson}
            </Button>
            <Button>{c.save}</Button>
            <Button variant="quiet">{c.moreDetails}</Button>
          </div>
          <div className="ds-row">
            <Button variant="danger">{c.delete}</Button>
            <Button variant="danger" solid>
              {c.deleteForever}
            </Button>
            <Button size="sm">{c.cancel}</Button>
            <Button variant="primary" disabled>
              {c.save}
            </Button>
          </div>
        </Block>

        <Block title={c.iconButtons}>
          <div className="ds-row">
            <IconButton icon="undo" label={c.undo} />
            <IconButton icon="search" label={c.search} />
            <IconButton icon="focus" label={c.focus} pressed />
            <IconButton icon="settings" label="Settings" disabled />
            <IconButton icon="plus" label={c.addPerson} showLabel />
            <IconButton icon="tree" label={c.family} showLabel size="sm" />
          </div>
        </Block>

        <Block title={c.fields}>
          <TextField label={c.firstName} defaultValue="Zainab" />
          <div className="ds-two">
            <TextField label={c.born} hint={c.bornHint} placeholder="1952" />
            <TextField label={c.born} error={c.bornError} defaultValue="52" />
          </div>
          <Select
            label={c.colours}
            value={colour}
            onChange={(e) => setColour(e.currentTarget.value)}
            options={[
              { value: "gender", label: c.byGender },
              { value: "branch", label: c.byBranch },
              { value: "generation", label: c.byGeneration },
            ]}
          />
          <TextField multiline label={c.notes} rows={2} />
        </Block>

        <Block title={c.segmented}>
          <Segmented
            label={c.view}
            value={view}
            onChange={setView}
            options={[
              { value: "family", label: c.family, icon: "viewFamily" },
              { value: "ancestors", label: c.ancestors, icon: "viewPedigree" },
              { value: "descendants", label: c.descendants, icon: "viewDescendants" },
            ]}
          />
          <Segmented
            label={c.colours}
            block
            value={colour}
            onChange={setColour}
            options={[
              { value: "gender", label: c.byGender },
              { value: "branch", label: c.byBranch },
              { value: "generation", label: c.byGeneration },
            ]}
          />
        </Block>

        <Block title={c.chips}>
          <div className="ds-row">
            <Chip selected={living} onClick={() => setLiving(!living)}>
              {c.living}
            </Chip>
            <Chip selected={!living} onClick={() => setLiving(!living)}>
              {c.deceased}
            </Chip>
            <Chip onRemove={() => {}} removeLabel={c.removeLahore}>
              {c.lahore}
            </Chip>
            <Chip>
              <span className="years">b. 1953</span>
            </Chip>
          </div>
          <div className="ds-row">
            {[0, 1, 2, 3, 4, 5].map((h) => (
              <Chip key={h} hue={h}>
                {c.branch(h)}
              </Chip>
            ))}
          </div>
        </Block>

        <Block title={c.avatars}>
          <div className="ds-row ds-row--center">
            {c.names.map((name, i) => (
              <Avatar
                key={name}
                name={name}
                size={(["sm", "md", "lg", "xl", "md", "sm"] as const)[i]}
              />
            ))}
          </div>
        </Block>

        <Block title={c.cards} wide>
          <CardsSample />
        </Block>

        <Block title={c.menu}>
          <div className="dnd-menu ds-static" role="presentation">
            <MenuItem icon="person" tabIndex={-1}>
              {c.edit}
            </MenuItem>
            <MenuItem icon="plus" tabIndex={-1}>
              {c.addChild}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon="trash" danger tabIndex={-1}>
              {c.delete}
            </MenuItem>
          </div>
          <Button
            size="sm"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenuAt([r.left, r.bottom + 6]);
            }}
          >
            {c.openMenu}
          </Button>
          {menuAt && (
            <Menu at={menuAt} label={c.panelTitle} onClose={() => setMenuAt(null)}>
              <MenuItem icon="person" onClick={() => setMenuAt(null)}>
                {c.edit}
              </MenuItem>
              <MenuItem icon="plus" onClick={() => setMenuAt(null)}>
                {c.addChild}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon="trash" danger onClick={() => setMenuAt(null)}>
                {c.delete}
              </MenuItem>
            </Menu>
          )}
        </Block>

        <Block title={c.sheet}>
          <div className="ds-sheet-frame">
            <Sheet
              title={c.panelTitle}
              leading={<Avatar name={c.panelTitle} size="lg" />}
              onClose={() => {}}
              closeLabel={c.closePanel}
              footer={
                <>
                  <Button variant="primary">{c.save}</Button>
                  <Button variant="quiet">{c.cancel}</Button>
                </>
              }
            >
              <div className="ds-row">
                <Chip>
                  <span className="years">1953 – 2019</span>
                </Chip>
                <Chip>{c.lahore}</Chip>
              </div>
              <TextField label={c.firstName} defaultValue="Zainab" />
            </Sheet>
          </div>
        </Block>

        <Block title={c.dialog}>
          <div className="dialog ds-static" role="presentation">
            <div className="dialog-header">
              <h4 className="dialog-title">{c.dialogTitle}</h4>
              <IconButton className="dialog-close" icon="close" label={c.cancel} tabIndex={-1} />
            </div>
            <div className="dialog-content">
              <TextField label={c.treeName} defaultValue={c.display} tabIndex={-1} />
              <div className="dialog-actions">
                <Button tabIndex={-1}>{c.cancel}</Button>
                <Button variant="primary" tabIndex={-1}>
                  {c.save}
                </Button>
              </div>
            </div>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            {c.openDialog}
          </Button>
          {dialogOpen && (
            <Dialog title={c.dialogTitle} onClose={() => setDialogOpen(false)}>
              <TextField label={c.treeName} defaultValue={c.display} />
              <div className="dialog-actions">
                <Button onClick={() => setDialogOpen(false)}>{c.cancel}</Button>
                <Button variant="primary" onClick={() => setDialogOpen(false)}>
                  {c.save}
                </Button>
              </div>
            </Dialog>
          )}
        </Block>

        <Block title={c.toast}>
          <div className="toast ds-static" role="presentation">
            <p>{c.toastText}</p>
            <Button size="sm" variant="primary" tabIndex={-1}>
              {c.reload}
            </Button>
          </div>
        </Block>

        <Block title={c.empty} wide>
          <EmptyState
            title={c.emptyTitle}
            level={3}
            actions={
              <>
                <Button variant="primary" icon="plus">
                  {c.newTree}
                </Button>
                <Button>{c.importFile}</Button>
              </>
            }
          >
            {c.emptyBody}
          </EmptyState>
        </Block>
      </div>
    </div>
  );
}

function Showcase() {
  return (
    <main className="ds">
      <header className="ds-header">
        <h1 className="display display--lg">{c.title}</h1>
        <p className="muted">{c.intro}</p>
        <nav className="ds-nav">
          {(["light", "dark", "classic", "print"] as const).map((t) => (
            <a key={t} href={`?theme=${t}${LANG === "ar" ? "&lang=ar" : ""}`}>
              {c.themes[t]}
            </a>
          ))}
          <a href={LANG === "ar" ? "?" : "?lang=ar"}>{LANG === "ar" ? "English" : "العربية"}</a>
          <a href="?">All</a>
        </nav>
      </header>
      {THEMES.map((theme) => (
        <ThemeSection key={theme} theme={theme} />
      ))}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <Showcase />
    </I18nextProvider>
  </StrictMode>,
);
