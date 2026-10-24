# Stam app design: a warm family album, with a premium edge

This is the design system for the editor at `/app`. The landing page keeps its own rules in
`DESIGN.md`. Tokens live in `src/ui/styles/tokens.css`. Components live in `src/ui/design/`, with
their styles in `src/ui/design/design.css`. You can see every component in every theme at
`/dev/design` (dev server only; add `?theme=dark` or `?lang=ar`).

## Direction

1. **An album, not an admin panel.** Linen pages and photographs: cards are raised paper with
   soft corners and a contact shadow, and people show up as faces or warm initials.
2. **One confident voice.** Archivo wide and heavy names things: the tree, the person, an empty
   page. Everything else is quiet Archivo at normal width.
3. **A deep accent, used with intent.** Mulberry is the album's cloth. It marks the primary
   action and the selection, and nothing else.

Why mulberry: a family tree is a tree, and mulberry is deep, warm and unmistakable. It is not the
terracotta and cream of generic "warm" UIs, and it is far enough from brick red that destructive
actions still read as their own colour. The palette avoids pure black and pure white everywhere
except in Print.

## Rules

- The accent is for **primary actions and the selection** only. It is never decoration, never a
  heading colour, never a border on idle things. Keyboard focus is an ink ring (`--focus`), so it
  stays distinct from the selection.
- **One primary button per view.** Secondary buttons are outlined pills. Quiet buttons are text.
  Destructive buttons are brick-outlined, and filled only as the final "Delete" of a
  confirmation.
- **Display type names things; it never labels.** Use no all-caps tracked labels; section labels
  are sentence-case `--ink-2` at 13 px.
- **Arabic-script text never gets negative tracking**, because it breaks the joins. `.display`
  resets `letter-spacing` under `[lang="ur"]` and `[lang="ar"]`.
- **Radius follows size:** 8 px inputs, 12 px cards and menus, 16 px dialogs, 22 px bottom sheets,
  and pills for buttons, chips and segmented controls. This replaces M1's "6 px on cards only" rule
  for the app; the landing page keeps that rule.
- **Logical properties only** (`inline`/`block`). The one exception is a glyph that must not
  mirror, such as the select chevron.
- Every pair in the tables below is AA (4.5:1 for text, 3:1 for strokes and marks), and
  `tests/ui/settings/tokenContrast.test.ts` enforces it in all four themes.

## Tokens

### Surfaces

| Token               | Light     | Dark      | Classic | Print     | Use                                    |
| ------------------- | --------- | --------- | ------- | --------- | -------------------------------------- |
| `--ground`          | `#f4eeea` | `#1a1418` | light   | `#ffffff` | the page, the canvas                   |
| `--surface-raised`  | `#fffcfa` | `#272026` | light   | `#ffffff` | cards, toolbar, panel, list rows       |
| `--surface-sunken`  | `#ebe3de` | `#130e11` | light   | `#ffffff` | segmented tracks, wells, empty avatars |
| `--surface-overlay` | `#fffcfa` | `#2c242a` | light   | `#ffffff` | menus, dialogs, popovers, toasts       |
| `--card`            | `#fffcfa` | `#272026` | light   | `#ffffff` | person card fill                       |
| `--deceased`        | `#eee7e2` | `#201a1e` | light   | `#ffffff` | a deceased person's card               |
| `--card-edge`       | ink 18 %  | ink 16 %  | light   | `#000`    | card stroke                            |
| `--field`           | `#fffcfa` | `#201a1e` | light   | `#ffffff` | text inputs                            |
| `--backdrop`        | ink 42 %  | black 60% | light   | black 50% | behind modal dialogs                   |

Classic inherits light and adds `--male #d9e5f6`, `--female #f7d8e5`, `--male-deceased #e3e7ee`
and `--female-deceased #eee2e7`.

### Ink

| Token           | Light     | Dark      | Print     | Use                                       |
| --------------- | --------- | --------- | --------- | ----------------------------------------- |
| `--ink`         | `#2a1e24` | `#f3eaee` | `#000000` | body text, headings                       |
| `--ink-2`       | `#6a5960` | `#b9a8b0` | `#000000` | secondary text (`--muted` is the same)    |
| `--ink-3`       | `#8f7d85` | `#8a7880` | `#000000` | icons, strokes, placeholders' marks (3:1) |
| `--line`        | ink 14 %  | ink 14 %  | black 45% | hairlines, dividers                       |
| `--line-strong` | ink 30 %  | ink 30 %  | black 70% | input and button edges                    |

### Accent and danger

| Token            | Light     | Dark      | Print     |
| ---------------- | --------- | --------- | --------- |
| `--accent`       | `#7c2a5c` | `#e7a0c9` | `#000000` |
| `--accent-hover` | `#63204a` | `#f2bddb` | `#333333` |
| `--accent-soft`  | `#f3e1ea` | `#3d2435` | `#ffffff` |
| `--accent-ink`   | `#7c2a5c` | `#eeb3d4` | `#000000` |
| `--on-accent`    | `#ffffff` | `#1a1418` | `#ffffff` |
| `--danger`       | `#a3302a` | `#f0998f` | `#000000` |
| `--danger-hover` | `#87241f` | `#f6b5ad` | `#333333` |
| `--danger-soft`  | `#f8e0dc` | `#3d1d1b` | `#ffffff` |
| `--on-danger`    | `#ffffff` | `#1a1418` | `#ffffff` |

### Album hues (branch, generation, initials)

Soft hues are fills under `--ink` and `--ink-2` text (AA). Deep hues are dots, keys and bands
(3:1 on a card). In Print the soft hues are white and the deep hues are black.

| #   | Name       | Light soft | Light deep | Dark soft | Dark deep |
| --- | ---------- | ---------- | ---------- | --------- | --------- |
| 0   | apricot    | `#f5d6c0`  | `#b0552a`  | `#4a2f22` | `#e79a73` |
| 1   | sage       | `#d6e5c3`  | `#557a35`  | `#2c3a24` | `#9cc77a` |
| 2   | sky        | `#cadcf0`  | `#3d6a9e`  | `#21334a` | `#8db6e6` |
| 3   | rose       | `#efcfdf`  | `#a3466f`  | `#45253a` | `#e392b9` |
| 4   | marigold   | `#f3e0a6`  | `#8a6810`  | `#433817` | `#dcb64d` |
| 5   | eucalyptus | `#c7e3dc`  | `#2f7a6b`  | `#1f3b36` | `#6fc2b0` |

An initials avatar takes the hue `avatarHue(name)` (`src/ui/design/avatarHue.ts`): FNV-1a over the
name, so the same person has the same colour on the canvas, in the panel and in lists.

### Elevation

The shadows are warm (mulberry-brown, never grey), soft and low.

| Token        | Light value                          | Use                          |
| ------------ | ------------------------------------ | ---------------------------- |
| `--shadow-1` | `0 1px 2px` 8 % + `0 2px 6px` 6 %    | resting: rows, toolbar, keys |
| `--shadow-2` | `0 2px 4px` 6 % + `0 10px 24px` 12 % | floating: menus, panel, map  |
| `--shadow-3` | `0 4px 8px` 8 % + `0 24px 56px` 20 % | modal: dialogs, toasts       |

Dark uses black at 20 to 50 %. Print has no shadows (`none`, or a 1 px black ring for overlays).
Canvas cards use a cheaper contact shadow: a second rect 2 px below in `--card-shadow`, deeper
on hover. SVG filters would cost too much on large trees.

### Radius and spacing

`--radius-xs 6` · `--radius-sm 8` (inputs, menu items) · `--radius-md 12` (cards, menus, banners,
minimap) · `--radius-lg 16` (dialogs, list blocks) · `--radius-xl 22` (bottom sheet top) ·
`--radius-pill` (buttons, chips, segmented, handles). `--radius-card` is 12.

Spacing is on a 4 px base: `--space-1` 4, `2` 8, `3` 12, `4` 16, `5` 20, `6` 24, `7` 32,
`8` 48, `9` 64.

## Type

One family, Archivo variable (`wdth` 62 to 125), in two voices:

| Role       | Setting                                                    | Where                                |
| ---------- | ---------------------------------------------------------- | ------------------------------------ |
| Display lg | `--text-display` clamp(30→46 px), 800, `wdth` 125, −0.03em | page titles, empty states            |
| Display    | `--text-xl` clamp(24→32 px), 800, `wdth` 125, −0.02em      | "Your trees", empty-state titles     |
| Display md | `--text-lg` clamp(19→22 px), 750–800, `wdth` 115–118       | panel name, dialog and sheet titles  |
| Title      | `--text-md` 17 px, 750–800, `wdth` 112–118                 | tree title in the toolbar, tree rows |
| Body       | `--text-base` 15 px, 400, line-height 1.5                  | everything else                      |
| UI         | 13–14 px, 600                                              | buttons, segments, chips             |
| Small      | `--text-sm` 13 px / `--text-xs` 12 px                      | hints, meta                          |

Years and dates always use tabular figures (`font-variant-numeric: tabular-nums`, which the body
sets, plus the `.years` class). Urdu keeps Noto Nastaliq Urdu (`--font` is swapped in
`src/i18n/fonts.css`), and Arabic-script names keep Noto Naskh through Archivo's
`unicode-range`. Neither font changed in M6.

## Motion

One family, the exponential ease: `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)` for things
arriving and `--ease-in` `cubic-bezier(0.7, 0, 0.84, 0)` for things leaving. `--ease` is the
same as `--ease-out`.

| Token          | Duration | For                                                        |
| -------------- | -------- | ---------------------------------------------------------- |
| `--dur-micro`  | 140 ms   | hover, press, focus, menu opening                          |
| `--dur-card`   | 250 ms   | card fill and stroke changes, card lift                    |
| `--dur-panel`  | 320 ms   | dialogs (fade, 0.97 to 1 scale, 8 px rise), sheets, toasts |
| `--dur-layout` | 450 ms   | the tree re-flowing                                        |

All motion answers something the person did. Nothing moves on its own except the opening of
what they opened. When the OS asks for less motion, or `<html data-motion="reduce">` is set,
every duration becomes 0 and every animation and transition is removed. Settings can override
the OS with `data-motion="full"`.

## Components

Every component keeps the class names the app already used, so restyling a class restyles
every screen.

| Component      | File                           | Notes                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Button         | `src/ui/design/Button.tsx`     | `.button` + `-primary` / `-quiet` / `-danger` (`solid`), `-sm`, `-block`; leading `icon`; `type="button"` by default                                                                                                                                                     |
| IconButton     | `src/ui/design/IconButton.tsx` | `.icon-button`, round, 40 px (32 px `sm`); `label` is the aria-label, or visible text with `showLabel`; `pressed` sets aria-pressed (accent-soft)                                                                                                                        |
| TextField      | `src/ui/design/TextField.tsx`  | label, `hint`, `error` (aria-invalid, aria-describedby hint then error); `multiline` textarea                                                                                                                                                                            |
| Select         | `src/ui/design/Select.tsx`     | native select in `.select`, drawn chevron, label and hint                                                                                                                                                                                                                |
| Segmented      | `src/ui/design/Segmented.tsx`  | radiogroup of radio buttons; one Tab stop; arrows move and choose (mirrored in RTL), Home and End                                                                                                                                                                        |
| Chip           | `src/ui/design/Chip.tsx`       | static tag; filter toggle (`selected`/`onClick`, aria-pressed); `hue` key with a deep dot; `onRemove`                                                                                                                                                                    |
| Sheet          | `src/ui/design/Sheet.tsx`      | side panel (380 px, inline end), bottom sheet under 768 px (≤ 50 vh, grabber); `complementary`, named by its display title; header `leading`/`headerActions`/close; pinned `footer`                                                                                      |
| Dialog         | `src/ui/app/Dialog.tsx`        | upgraded in place: header with title and a visible close (✕) button, scrolling `.dialog-content`, sticky `.dialog-actions`; max height is the window minus 32 px; first field gets the focus, never the ✕; `closeButton={false}` when the actions already end in "Close" |
| Menu, MenuItem | `src/ui/design/Menu.tsx`       | `Menu` is `PopupMenu` (unchanged behaviour); `MenuItem` (`icon`, `danger`), `MenuSeparator`                                                                                                                                                                              |
| Toast          | `.toast` (design.css)          | overlay surface, 12 px radius, `--shadow-3`, rises in (`UpdateToast`)                                                                                                                                                                                                    |
| Avatar         | `src/ui/design/Avatar.tsx`     | photo or initials on `avatarHue(name)`; sizes 28/40/64/96; decorative unless `label`                                                                                                                                                                                     |
| EmptyState     | `src/ui/design/EmptyState.tsx` | album drawing, display title (h2/h3), body ≤ 46ch, actions; `align="start"`                                                                                                                                                                                              |
| Icon           | `src/ui/app/Icon.tsx`          | added plus, person, chevronDown, check, trash, settings, photo, more and tree; optional `size`                                                                                                                                                                           |

Each one is exported from `src/ui/design/index.ts`. The unit tests are in `tests/ui/design/`.

### Specs in brief

- **Primary button:** a mulberry pill with white text, 40 px tall, 18 px inline padding. On hover
  it darkens, lifts with `--shadow-1` and gets an inset bottom edge (more than a colour change,
  per WCAG 1.4.1). Pressed, it moves down 1 px.
- **Secondary button:** a raised pill with a `--line-strong` edge. On hover the edge firms to
  `--ink-3` and the button lifts.
- **Quiet button:** `--ink-2` text with no edge. On hover it gets a wash, ink text and an
  underline.
- **Destructive button:** a brick text and edge. On hover it fills with `--danger-soft`. It is
  solid brick only as the confirming button in `.dialog-actions`.
- **Icon button with label:** for actions people must find, such as "Add person". Phase 2 should
  use it for the toolbar's main actions instead of icon-only buttons.
- **Text input and select:** 40 px tall, 8 px radius, `--line-strong` edge. On focus the edge
  turns mulberry, with a 3 px soft accent halo and the ink focus ring.
- **Segmented control:** a sunken pill track. The chosen segment is a raised pill with
  `--shadow-1`; in Print it is ink. The view switcher and the gender toggle already use this
  look.
- **Card:** `--surface-raised`, 12 px radius, `--line` edge, `--shadow-1`. Lists of cards may
  deepen to `--shadow-2` on hover.
- **Person card (canvas):** drawn by the tree's template (see "Templates" below). Whatever the
  template, the selection is a mulberry 2 px ring set 4 px outside the card's own outline (it
  follows a leaf, an arch or a print as well as a box) and keyboard focus is an ink ring outside
  that; zoomed out to names only, the card's own edge turns mulberry instead.
- **Sheet:** see the table. The title uses the display voice. The body scrolls with
  `overscroll-behavior: contain`. Optional, added for the person panel: `label` names the
  landmark instead of the title, `subtitle` puts lines under the title, and `expandable` turns the
  bottom sheet's grabber into a handle (tap or drag up to expand, drag down to collapse, and drag
  down again to close).
- **Person profile (the person panel):** the header is linen (`--ground`) with the portrait
  mounted like an album print: four paper corners, set 2° askew, with a photo badge (tap to
  change). Relatives are raised pill chips with a small Avatar. Anything still empty is a dashed
  "+" pill, the same sign as the canvas start card.
- **Dialog:** an overlay surface with a 16 px radius, `--shadow-3` and a warm backdrop. It opens
  in 320 ms.
- **Menu:** an overlay surface with a 12 px radius and 6 px padding. Items have an 8 px radius
  and are 36 px tall. A danger item is brick and goes last, after a separator.
- **Toast:** see the table. A toast holds one action, as a small primary button.
- **Empty state:** an invitation with a title such as "Start your family tree", one sentence
  saying what will appear and that everything stays on the device, and the primary action.
- **Avatar:** see the table. Print draws a 1 px ink ring instead of a fill.

## Templates

A tree is drawn in one of six templates, on the canvas and in every export alike; people choose
one, and the card size, text size and spacing, in the Look dialog (the editor's More menu). The
choice is kept per tree on this device. Code: `src/templates/` (one face per template in
`faces/`), the print frame in `src/export/render/frame.tsx`, the design in
`docs/superpowers/specs/2026-10-24-tree-templates-design.md`.

| Template             | Card                                                    | Lines                                 | Deceased                                      |
| -------------------- | ------------------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| Warm album (default) | a photo print, small paper corners, tilted up to 1.5°   | soft, hand-drawn                      | sepia print, small mourning ribbon            |
| Heritage manuscript  | a notched cartouche, gold inner frame, book serif       | ink hairline, gold diamond on couples | darker cartouche, ink inner frame             |
| Botanical tree       | a leaf; the tree grows upward                           | bark, thinning away from the root     | autumn leaf; married-in people a lighter leaf |
| Modern gallery       | a medallion above the name                              | crisp ink, reaching the medallions    | hollow medallion; the eldest row in vermilion |
| Shajara              | a mihrab arch, Nastaliq name first; reads right to left | vines                                 | مرحوم after the years                         |
| Swiss minimal        | a hairline box                                          | one hairline                          | † after the name                              |

Rules every template keeps: divorced couples get a "//" on their line; only an adopted, step or
foster child's own drop is dashed, never the bar siblings share; an unknown person has a dashed
outline and "?"; faces draw their colours inline, so the canvas only adds its states (hover,
drop target, selection) on top; every palette passes AA (`tests/templates/contrast.test.ts`).

## Canvas

- The ground is the template's own (its light or dark palette, black on white in Print).
  Connectors are drawn in the template's line colour and style. Card size and the gaps between
  cards and rows come from the tree's look (`src/templates/metrics.ts`).
- **Person card:** every template has a photo slot (the photo, or initials on a soft hue) whose
  ring is the colour key: sky or rose deep by gender, or the deep hue of the branch or
  generation. Years read "1920–1994" (a spaced dash only around approximate years); a deceased
  person with no years gets a quiet "Deceased" line, never a lone "†". Exports keep their own years
  line ("1913 – †1964") and colour the ring by gender.
- The collapse chevron is a small sunken disc inside the card's bottom inline-end corner, shown
  only on the card under the pointer, the keyboard or the selection. A collapsed branch shows a
  sunken "+N" pill in the same corner, which is the expand control. On a three-line card (with a
  native name) the years line stops short of it.
- The minimap is a sunken print in a raised 16 px frame (`--shadow-2`), cards in a muted
  mulberry-grey, the selection in the accent and the view framed in the accent. It appears from
  10 cards up, only while part of the tree is off screen, and never on a phone.
- The ruler sits on a slightly translucent ground.
- Quick-add handles are round 24 px "+" buttons that fill with mulberry on hover. The inline
  editor reads as a field in focus, not a selected card: a 1.5 px mulberry edge with a soft
  `--accent-soft` halo, a 12 px radius and `--shadow-2`. Inside: a dashed avatar circle, a filled
  "Full name" field (sunken, 8 px radius), ♂ and ♀ as outlined chips that fill with their
  gender's soft hue when chosen, a filled mulberry ✓ and a quiet ✕.
- **Empty tree:** a raised album page (16 px radius, `--shadow-2`) in the middle of the canvas
  with the album art, "Every tree starts with one person", one sentence, and the dashed "Start
  with a person" photo slot.

## Toolbar

- **Desktop:** one row that never wraps. Start: "‹ My trees", a hairline, the tree's name in the
  display voice (click to rename), a marigold "N not connected" tag, the save state. Centre: the
  view switcher, naming only the current view below 1500 px. End: the primary "+ Add person",
  Search, the zoom pill (− fit +, sunken), undo and redo, and "⋯ More".
- **More** holds the occasional tools, each with an icon and a label: focus mode and "How are we
  related?" (ticked toggles), Birthdays (a count, and an accent dot on ⋯ when one is near),
  Export (with its shortcut), the two backups, and Settings.
- **+ Add person** starts the first person in an empty tree. Otherwise it opens a chooser,
  "Add to {name}": Parent, Spouse, Child (one per family), Sibling, limited to what the view can
  draw. With nobody selected it says "Select someone first" and offers someone not connected yet.
- The view's own controls (the breadcrumb, the focus, the fan's generations) float as pills
  under the bar.
- **Phone:** a top bar (back, name, undo, redo, More), a bottom dock (Add, Search, the views as
  icons) and the zoom pill floating above the dock at the inline end.

## What phase 2 builds on this

Phase 2 restructures screens using these pieces:

- the tree list, with EmptyState, cards and Avatar;
- the toolbar, with IconButton `showLabel` for "Add person", grouped tools and a Menu for the
  rest;
- the person panel, with Sheet, Avatar, Chip, TextField and Select, progressive fields and
  relationships;
- Settings, with Segmented and big theme swatches in a Dialog that already scrolls and closes.
