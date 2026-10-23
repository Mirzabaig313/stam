# Stam landing page: design system

Scope: the public pages `/`, `/privacy` and the 404. The editor at `/app` has its own UI and
shares only the tokens. Built with the `/awwwards` process; Phases 0 to 2 were fixed with the
owner (PRD §12), so this file records them rather than re-deciding them.

## Brief

|             |                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject     | Stam, a free, private, browser-based family tree builder at https://stam.mirzalabs.in. No accounts; data stays on the device.                                                                                                                     |
| Audience    | Families worldwide, including Urdu and Arabic speakers (RTL later).                                                                                                                                                                               |
| Job         | Get people to press "Start your tree" (→ `/app`).                                                                                                                                                                                                 |
| Language    | English now. All copy lives in `src/site/content.ts`; CSS uses logical properties only.                                                                                                                                                           |
| Constraints | Bun + React 19, no framework. CSP `script-src 'self'`, `font-src 'self'`: nothing third-party, no inline script. No analytics, no cookies. Exports and the relationship calculator do not exist yet (M2/M3): shown as "coming", never as working. |

Stack: inside the existing Bun project (its bundler, React 19, its tokens). GSAP + Lenis on the
landing only. No WebGL: the signature is the layout engine itself, drawn in SVG and HTML, and
GL would add weight without adding meaning.

## Concept Card (PRD §12.1, with the screenshot line amended)

```
Idea:        Every family fits on rows: one generation per line, drawn in order
Metaphor:    The ruled pages of a family register, with numbered generation lines
Signature:   Scroll-built family. The real layout engine adds people row by row (pinned chapters)
Emotion:     Calm order. "Oh, mine could look like that."
Motion verb: "settle into rows". Things slide sideways and then lock onto their row
Screenshot:  A finished 4-generation tree with a Roman-numeral ruler down the margin
```

Anchor: the product's core rule (systematic, one row per generation). The runner-up "threads"
contributes one detail: connectors draw in after their cards have locked.

Amendment to the screenshot line (PRD §12.1 said five generations): the sample family is four
generations (I to IV), told in five chapters (I to V). A fifth row made the hero tree too small to
read at laptop heights, so the card now says what the page shows.

## System

### Palette (PRD §12.2)

| Role    | Value      | Use                                                                   |
| ------- | ---------- | --------------------------------------------------------------------- |
| ground  | `#F4F5F2`  | paper white of the register                                           |
| ink     | `#111311`  | text, card outlines, primary button fill                              |
| muted   | `#5A615B`  | secondary text (5.9:1 on ground)                                      |
| line    | ink at 14% | ruling, hairlines, connectors                                         |
| accent  | `#2B47F5`  | cobalt: selection, focus, and the calculator's path. Never decoration |
| curtain | `#111311`  | the privacy field and page transitions                                |
| card    | `#ECEDE9`  | card fill, as in the editor                                           |

On the ink field (privacy section) text is ground and muted becomes `#A3AAA4` (7.6:1).

### Type

One family, two personalities: Archivo variable (self-hosted, `wdth` 62 to 125).

| Role           | Setting                                                            |
| -------------- | ------------------------------------------------------------------ |
| Display        | `wdth` 125, weight 800, tracking −0.035em to −0.045em, leading 0.9 |
| Headings       | `wdth` 112, weight 700, tracking −0.02em                           |
| Body           | `wdth` 100, weight 400, 17 to 18 px, leading 1.5                   |
| UI and meta    | `wdth` 100, weight 500 to 600, 13 to 14 px                         |
| Ruler numerals | `wdth` 125, weight 600, tracked +0.08em, tabular figures           |

Years always use tabular figures. No second family: the width axis gives the contrast a serif
would, and the register metaphor wants one hand.

Fluid scale: mega `clamp(3.25rem, 1.2rem + 7.6vw, 9.5rem)`, xl `clamp(2.25rem, 1.3rem + 3.6vw, 4.75rem)`,
l `clamp(1.5rem, 1.15rem + 1.4vw, 2.5rem)`, body `clamp(1.0625rem, 1rem + 0.2vw, 1.1875rem)`.

### Grid and rhythm

- A **register margin** down the inline-start edge of every page: 56 px on desktop, 36 px on
  phones, closed by one hairline. Roman numerals live only there. Everything else hangs from the
  margin line.
- Content: 12 columns, gutter `clamp(16px, 2.2vw, 32px)`, max width 1440. Text starts on column
  1 or column 7; nothing floats in between.
- Section rhythm varies on purpose: hero full viewport; chapters 5 × 100 svh; drag and drop
  airy (28u); exports normal (16u); calculator airy; privacy is a full-bleed ink field; footer
  ends on the ruled wordmark.

### Shape

6 px radius on cards and buttons only (the editor's rule). Everything else is square.

### Motion language

- Easing: one expo-out family (`cubic-bezier(0.16, 1, 0.3, 1)`, GSAP `expo.out`).
- "Settle into rows" in practice: a thing slides sideways along its row, fast, then locks. New
  cards start 140 layout px beside their place; connectors draw once the cards are nearly home.
  Nothing drops in vertically and nothing bounces.
- Durations: hover 0.3 to 0.45 s; card re-flow 0.45 s (the editor's value); hero intro rows
  staggered 0.14 s per generation; page transition 0.5 s.
- Hovers (one treatment per role):
  - Primary buttons: a paper fill slides in from the inline-start and locks (the button
    inverts), the label slides out sideways while its copy slides in, the arrow travels.
  - Nav links: an underline slides in from the inline-start and locks.
  - Index rows (exports) and person buttons (calculator): the row marker slides along the row;
    cards tighten their outline.
  - Utility links (footer legal): underline at rest, thickens.
- Idle (a decision): the page is calm at rest, as the concept's emotion asks ("calm order").
  The hero tree leans a few px toward the pointer and holds still when the pointer does; the
  scroll-built chapters hold their finished frame while you read; the drag and drop demo loops
  while it is on screen. An earlier slow drift on the hero kept the first screen from ever
  settling and was removed.
- One clock: Lenis, ScrollTrigger and every driver run on `gsap.ticker`.
- Reduced motion: native scroll, no scrub; the chapters become five stacked finished frames,
  the drag demo shows its end state, the hero tree is drawn complete.
- Page transitions: five ruled rows of ink (the curtain, numbered I to V in the margin) slide
  in from the inline-start one row after another and lock, then the browser navigates. The next
  page opens covered (`flags.js` reads a session flag before first paint) and its rows slide off
  toward the inline-end, row by row, while the header stays put; its own intro waits for them.
  No view transitions: Bun's CSS bundler mangles `@view-transition`, and the curtain works in
  every browser. Back/forward from the cache replays the arrival.

### Composition plan

```
HERO (full-bleed, ruler margin)
| I  | Stam                                   How it builds  Privacy  [Start your tree] |
|    | EVERY FAMILY                                                                     |
|    | FITS ON ROWS.               short line about the product · CTA · privacy facts   |
|----|----------------------------------------------------------------------------------|
| I  |                     [Ada]==[Tomas]                                                |
| II |       [Clara]==[Omar]   [Henrik]==[Mei]   [Ines]                                  |
| III|     [Noor] [Adam]   [Hana]--[Sami]==[Elif]                                        |
| IV |                       [Lena]   [Theo]                                             |

CHAPTERS I–V (one pinned frame per chapter; each frame is a poster)
| I  |  the engine's tree on the register,       | III        of V                    |
| II |  camera fits as it grows                  | Their children                     |
|    |                                           | text                               |
|    |                                           | I II [III] IV V register of steps   |

DRAG AND DROP (split)
|    | heading + 3 rules       |  looping demo: a card lifts, slides, drops, rows re-flow |

EXPORTS (index list with preview)
|    | JSON backup   available |  preview sheet: the same tree on a poster, tiles, file  |
|    | SVG  PNG  JPEG  PDF ... |                                                         |

CALCULATOR (centered interactive)
|    |           heading · "Pick two people" · the sample tree as buttons · sentence     |

PRIVACY (text-led, ink field)
|    | YOUR FAMILY STAYS ON YOUR DEVICE.   four facts as a definition list               |

FOOTER (final composition)
| I  | ________________________ ruled lines ________________________________________   |
| II | STAM  (giant, sitting on a rule)        links · etymology · colophon             |

PRIVACY PAGE (the policy as a register)
|    | PRIVACY (giant)                          lede · updated                         |
| I  | question (small) | SHORT ANSWER (large) | details                              |
| II | ...                                                                             |

404: the hero's composition with a gap in the family: Ada and Tomas's children on rows I and
II, the third child a dashed "No record" card; "This branch has no record." on the left.
```

### Genericness test

- A generic product page would open on a centered headline over a gradient and a screenshot.
  Here the hero is the real engine's output on a ruled register, and the headline is set on the
  same rules.
- "Three feature cards" were replaced by sections that each use a different real mechanism:
  the engine (chapters), the command set (drag demo), the document format (JSON preview), the
  data model (calculator).
- The accent is not decoration: cobalt appears only for focus, selection and the kinship path,
  exactly as in the editor.

### Decisions worth knowing

- The chapters run the real `applyCommand` and `layoutFamily` in the browser. The prerendered
  HTML draws the same frames, because the sample family is keyed by stable names.
- Level of detail in three steps, as in the editor (FR-C9): full cards when there is room; at
  laptop sizes the avatar goes and the name keeps a readable size of its own (at least 11.5 px);
  only small cards (phones) show initials.
- The exports list is honest: only the JSON backup works today; everything else is labelled
  "Coming in a later version". The calculator demo runs on the sample family only and says so.
