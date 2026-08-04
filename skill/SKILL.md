---
name: sitelines
description: Map, audit, and edit a website's navigation. Scans the repo for pages and every link, button, redirect, and form that moves between them, then serves an interactive map where each card is a page with a live preview and each wire is a navigation. Flags dead links, orphans, dead ends, and pages buried too deep. Changes made in the browser are queued and implemented in the code by the agent. Use when the user says "show the site flow", "map the app", "user flow", "site map", "where does this button go", "add a page to the flow", "find dead links", "optimize navigation", or invokes /sitelines.
---

# sitelines - a site's navigation as a map you can edit

Three verbs: **show** (scan and serve the map), **change** (queue navigation edits in the browser),
**improve** (act on the flagged issues). The map is the source of truth for what the code does; the change
queue is the source of truth for what the user wants different.

## Show the map

```bash
node <skill-dir>/scripts/scan.mjs --root public      # -> .sitelines/flow.json
node <skill-dir>/scripts/serve.mjs --root public     # -> http://localhost:4370
```

Run `serve.mjs` with `run_in_background: true`, then give the user the URL. Never block on it.

Both scripts are plain ESM with no dependencies: swap `node` for `bun` or `deno run -A` if the project has
no node on PATH.

- `--root` = the directory holding the site's pages. Auto-detected if omitted (`public`, `site`, `www`,
  `static`, `src/pages`, `src/routes`, `src/app`, `app/pages`, `pages`, `app`, `docs`).
- `--out` = state directory, default `.sitelines/` in the repo. Suggest adding it to `.gitignore` unless
  the user wants to share the map's layout and notes with their team.
- `--port` = default 4370.
- Node 18+, zero dependencies, no build step.

If the user installed the npm package instead, `sitelines scan` and `sitelines serve` do the same thing.

If they only want to see what the tool does, `sitelines demo` copies the bundled 20-page example site into
`./sitelines-demo` and maps that. The example carries deliberate faults (two dead links, three orphans, a
dead end, a page four clicks deep), so every part of the map has something to show.

Previews are served from disk by `serve.mjs` at `/site<route>`, so no dev server is needed. Two deliberate
defaults:

- **Page JavaScript is off** in previews (iframes get an empty `sandbox`). Real pages that poll, retry a
  dead API, or animate will otherwise peg the renderer forty iframes over. Markup and CSS still render. The
  **Run page JavaScript** toggle under Layers turns it back on.
- **Service workers are neutralised** for anything under `/site/`, because the site's own worker would
  otherwise cache the preview responses and serve them back for every later preview.

Thumbnails mount two at a time and switch off past 60 pages. For pages that need real data (auth, an API),
run the user's own dev server and use the page's **Open** button against it instead.

## What the scanner extracts

Cards are pages (`*.html`, or framework page files if there is no HTML). Wires are navigations, each
carrying the **trigger text** (the actual button or link label), the file, and the line:

| source | how it is found |
| --- | --- |
| `<a href>` | label = link text |
| `<button>`/`<div>` with `onclick="location.href=…"`, `data-href`, `data-nav`, `formaction` | label = element text |
| `<form action>` | label = `POST form` |
| `<meta http-equiv=refresh>` | label = `meta refresh` |
| JS: `location.href/assign/replace`, `window.open`, `router.push/replace`, `navigate(…)`, `href="…"` in templates | trigger inferred from the nearest `getElementById`/`querySelector` above the call |

Targets that resolve to no file become **dead-link** cards. `/api/*` and `http(s)://` become side cards,
hidden by default behind the API and external toggles.

**Site-wide links fold away by default.** A link appearing from more than 4 pages is tagged `repeated` by
the scanner (a header, a footer, a nav partial), as is any link wired by a script more than 4 pages include
(`js-shared`). Both hide behind **Layers → Site-wide nav and footer links**, and the sidebar reports the
count it folded, for example `Links drawn 27 of 174`. This is a drawing decision only: depth, orphans,
dead ends, and every other judgement are computed from the complete link set, so a page reachable only
through the footer is never reported as an orphan.

Re-running the scan preserves card positions and notes.

## Improve

`flow.json.issues` and the **Issues** list carry, in priority order:

1. **Dead links** - a control goes nowhere. Always a real bug: fix the href or create the page.
2. **Orphan / unreachable** - no inbound link, or not reachable from the entry by clicking. Link it or delete it.
3. **Deep** - more than 3 clicks from the entry. Propose a shortcut from a hub.
4. **Dead ends** - no exits. Add a next step or a way back.
5. **Hubs** - more than 12 exits on one page. Propose grouping.

Report these as findings with `file:line`, and only change code once the user picks.

## Apply the user's changes

The browser queues changes to `.sitelines/edits.json`; the viewer never writes to the site. When the user
says "apply my sitelines changes" (or similar), read that file and implement each `pending` entry in the
real code:

```bash
cat .sitelines/edits.json
```

| op | what to do in code |
| --- | --- |
| `add-link` | add the anchor or button on `from` (in the region named by `where`, matching sibling markup and the project's design system) navigating to `to`, text = `label`; `via: redirect` means a JS `location.href` in that page's script, `via: form` means a form `action` |
| `remove-link` | delete the control at `file:line`, and any handler left dangling |
| `relabel` | change the visible text `oldLabel` to `label` at `file:line`; keep `aria-label` and `title` in sync |
| `retarget` | change the destination `to` to `newTo` at `file:line` |
| `add-page` | create the page at `route` following the repo's existing page scaffold (copy the closest sibling page: same head, nav, footer, asset versioning) |
| `delete-page` | delete the page file and every link pointing at it (search the flow for inbound edges first) |

`references/edit-protocol.md` has the exact JSON shape of every op.

After applying: re-run `scan.mjs`, confirm the intended links now exist and no new dead links appeared, then
mark each applied entry by setting `"status": "applied"` in `.sitelines/edits.json`. Keep them as history;
do not silently drop them. Report what changed as `file:line`.

Obey the repo's own conventions when writing. Read `CLAUDE.md`, `AGENTS.md`, or any project skill for
cache-busting query strings, nav partials, route registration, or tests that must run.

## Views, sections, and state

**One view is seeded**: `everything`, the base view. It always shows every page and never carries a rule.
Filtering while it is active creates a new view instead of narrowing the one complete picture of the site.

To add a view, append to `.sitelines/views.json` and its tab appears. Do this rather than touching the
viewer code when the user asks for a different split:

```json
{
  "active": "all",
  "views": [
    { "id": "all",  "label": "everything", "base": true, "include": [], "exclude": [] },
    { "id": "docs", "label": "docs only",  "include": ["/docs/**"], "exclude": [] }
  ]
}
```

Each view is `{id, label, include[], exclude[], collapsed[], entry?}`. Patterns: `/admin/**` (subtree),
`/admin/` (exact), `/admin/*` (one level), `*report*` (substring). A non-empty `include` means *only* those.
The base view is a guarantee: the server restores it if a hand-edit drops it, and strips any rule added to
it. Users also add views from the **+** on the tab bar, the rule box in the sidebar, and **Hide from this
view** in the inspector.

- Hiding a page removes it **and every wire touching it** from that view; the sidebar lists what is hidden.
- **Sections**: pages sharing a top-level directory get a labelled backdrop. Click the backdrop label (or
  the card's **Expand**) to collapse the whole section into one card. Internal links fold away and the
  collapsed section keeps **one wire per neighbour**, labelled `N links`, with every underlying control in
  its hover tooltip.
- **Ports**: dots down each card's left (entrances) and right (exits) edge. Hover one, or any wire, for the
  button text, both routes, the trigger kind, and `file:line`; the wire lights up. Click a port to jump to
  the page at the other end.
- The sidebar's **Entry points** lists where a visit can start; **Leaves the site** lists where the site
  sends people (API, external, dead).

## Viewer controls (tell the user these)

- Drag the background to pan, wheel to zoom, `f` to fit, `/` to search, `Escape` to cancel, drag a card to
  move it (the position is saved).
- **Layers**: site-wide nav and footer links, API endpoints, external links, live previews, run page JavaScript.
- Keys `1` `2` `3` switch view tabs; **+** on the tab bar makes a new view.
- Click a card to inspect it: full-size live preview at mobile, tablet, or desktop width, its exits, its
  entrances, and notes.
- **+ Link** (or `e`), then click a destination, proposes a new control.
- Edit an exit's text, or change its destination in the dropdown, to queue a rename or retarget. The ✕
  queues a removal.
- **+ Page** proposes a new page, optionally linked from the selected one.
- **Changes** is the queue; **Copy prompt** gives the user the exact sentence to paste back.
- The theme follows the OS and can be overridden with the sun/moon button.

## Files

```
DESIGN.md                     the viewer's visual system - read before touching viewer/style.css
scripts/scan.mjs              static analysis -> .sitelines/flow.json
scripts/serve.mjs             viewer + site preview server + change queue API (node:http, no deps)
scripts/install-skill.mjs     copies this skill into a Claude Code skills directory
viewer/                       the map UI (index.html, app.js, style.css)
references/edit-protocol.md   exact JSON shape of every queued change
```
