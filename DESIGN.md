# routemap viewer — design

The authority for `viewer/style.css`. Read this before changing anything visual.

**Mode: Operate.** The visitor is a developer holding a question: *where does this button go, and what did I break?*
Scanability, state legibility, and keyboard reach outrank expression. The brand lives in precision, not in
personality. If a decision makes the map prettier and the answer slower, the decision is wrong.

## World

A **plan view**. The map is a technical drawing of a site: pages are cards laid out on a measured ground,
depth columns are ruled like a drafting grid, links are drawn wires with a legible arrowhead. Nothing is
themed, gamified, or narrated. The visual interest comes from real density and real hierarchy: forty live
page previews arranged by how many clicks they sit from the front door.

The tool runs beside an editor, all day, in whatever ambient light the developer already chose. So it ships
**both themes**, follows `prefers-color-scheme` by default, and offers a manual override that persists.
Neither theme is the "real" one.

## Tokens

Every value below is a CSS custom property in `:root`, re-declared under `[data-theme="dark"]` and
`@media (prefers-color-scheme: dark)`. Nothing in the stylesheet may hardcode a color.

| role | light | dark |
| --- | --- | --- |
| `--bg` canvas | `#f5f6f8` | `#0d0f12` |
| `--surface` cards, panels, bar | `#ffffff` | `#16191e` |
| `--surface-2` insets, fields | `#eef0f4` | `#1d2127` |
| `--surface-3` pressed, hovered inset | `#e7eaef` | `#252a32` |
| `--text` primary | `#10131a` | `#eceef2` |
| `--text-2` secondary | `#3f4653` | `#b9bfc9` |
| `--text-3` tertiary | `#5c6472` | `#949ba6` |
| `--text-4` quietest legible | `#6f7784` | `#7f8794` |
| `--line` hairline | `#e2e5ea` | `#262b33` |
| `--line-2` defined edge | `#cdd2da` | `#363c46` |
| `--wire` link stroke | `#99a1af` | `#4e5663` |

Every text token clears 4.5:1 against the surface it is used on, in both themes. `--text-4` is the floor,
not a decorative gray: there is no token below AA.

**One accent, locked:** `--accent` `#2563eb` / `#5b9cff`. It means *selected, primary, interactive*. It is
the only non-status hue on the surface.

**Three status hues, each a meaning:**

| token | meaning | light | dark |
| --- | --- | --- | --- |
| `--danger` | a link that goes nowhere | `#d92d20` | `#ff6b5e` |
| `--warn` | queued, proposed, not yet in the code | `#b25e09` | `#f0b132` |
| `--ok` | an entry point, a way in | `#067a5b` | `#35c99a` |

Adding a color means adding a row to the legend. There is no decorative color.

## Link kind is drawn, not colored

A wire's **hue carries state** (normal, dead, queued, traced). A wire's **style carries kind**, so the four
navigation mechanisms stay distinguishable without spending four more hues:

| kind | stroke |
| --- | --- |
| anchor / button | solid |
| script navigation | dotted `1 4` |
| redirect | dashed `8 5` |
| form submit | solid, with a bar terminal at the source |
| queued (proposed) | dashed `7 5`, `--warn`, heavier |

## Shape

One radius system, no exceptions:

- `--r-1` **6px** — every interactive control: buttons, tabs, inputs, chips, badges, list rows.
- `--r-2` **10px** — every surface: page cards, panels, popovers, the modal, the preview frame.
- `--r-3` **14px** — containers that hold surfaces: the section backdrop.

A pill, a circle, or a square-cornered control is a bug. The one intentional circle is the I/O port dot,
which is a dot because it is a point of connection.

## Type

- `--ui`: the platform's own UI stack. Chrome, headings, labels, prose. No webfont: the viewer is served
  from `node:http` with zero dependencies and must paint correctly offline, on the first frame.
- `--mono`: the platform's own mono stack. Reserved for **data**: routes, `file:line`, counts, link labels,
  measurements. Mono here is not a costume for "technical" — every string set in it is an identifier or a
  number the developer will compare against something else.

Hierarchy comes from weight and color, not scale. The size range across the whole UI is 11px to 19px.
Uppercase tracking appears in exactly two places: rail panel titles, and depth-column labels on the canvas.
Both are axis labels for a graph, not section eyebrows.

## Motion

`prefers-reduced-motion` collapses all of it. The budget is deliberately small.

- **One authored moment:** on first paint the map settles in, cards rising 6px and fading, staggered by
  depth column so the site's shape reads left to right. It plays once per render, never on scroll.
- Everything else is feedback: 120ms on hover and focus, 90ms on `:active`, a wire trace on hover.
- Nothing loops. Nothing parallaxes. A skeleton shimmer marks a preview that is genuinely still loading.

## Density and honesty

The viewer is a cockpit, and it earns that density by never lying about it:

- Below `0.26` scale, wire labels and page thumbnails leave the render tree. A map that cannot show detail
  says so by not drawing it, rather than compositing an unreadable smear.
- At most 12 preview iframes stay mounted, two loading at a time, page JS off by default. Offscreen cards
  unmount.
- Past 60 pages, previews start off and the viewer says why.

## Icons

12px geometric glyphs from a single inline `<symbol>` sprite in `index.html`, one stroke weight (1.6),
`currentColor` throughout. An icon library is the right default and is deliberately not used here: the
project ships zero dependencies and no build step, so a CDN or an npm icon set would break both. That
constraint buys the sprite; it does not buy hand-drawn illustration. Every glyph is a rectangle, a line, a
circle, or a chevron.

No emoji anywhere in the UI.

## Anti-reference

Two worlds this replaced, both evidence of what the tool does rather than authority over how it looks:

1. A dark stone-and-torch "dungeon" theme with rooms, corridors, and quests.
2. A periwinkle "starchart" theme with sky gradients, star specks, and violet hero cards.

Do not reintroduce a spatial metaphor, a decorative ground texture, pill controls, all-mono chrome, or a
saturated gradient card. The nouns in this tool are **page**, **link**, **section**, **entry**, **exit**,
**issue**, and **change**. They are the product's language, and they are the only language the UI speaks.
