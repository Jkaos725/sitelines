# sitelines reference

Everything past the basics. For what sitelines is and how to install it, see the
[README](../README.md).

- [Commands](#commands)
- [Flags](#flags)
- [What the scanner reads](#what-the-scanner-reads)
- [Views](#views)
- [Directories](#directories)
- [Keyboard](#keyboard)
- [Previews](#previews)
- [Performance](#performance)
- [State files](#state-files)
- [Troubleshooting](#troubleshooting)

---

## Commands

```
sitelines scan  [--root DIR] [--out DIR] [--base URL]           read the site, write .sitelines/flow.json
sitelines serve [--root DIR] [--out DIR] [--port N] [--open]    open the map
sitelines open  [--root DIR] [--port N]                         scan, serve, and open the browser
sitelines demo  [--dir DIR] [--port N]                          copy the example site and map it
sitelines skill install   [--global|--project] [--dir PATH] [--force]   install the Claude Code skill
sitelines skill uninstall [--global|--project] [--dir PATH]             remove it
sitelines agents install   [--dir DIR]                          write the AGENTS.md block (every other agent)
sitelines agents uninstall [--dir DIR]                          remove just that block
sitelines version
sitelines help
```

`open` is `scan` then `serve` then a browser launch, and is the one to reach for. Run `scan` and `serve`
separately when you want to rescan without restarting the server, or serve a map you scanned elsewhere.

## Flags

| Flag | Applies to | Means |
| --- | --- | --- |
| `--root DIR` | `scan`, `serve`, `open` | Where your pages live. Defaults to the first of `public`, `site`, `www`, `static`, `src/pages`, `src/routes`, `src/app`, `app/pages`, `pages`, `app`, `docs` that exists, and to the whole current directory if none do. Resolved relative to where you run the command. |
| `--out DIR` | `scan`, `serve` | Where the state directory goes. Defaults to `.sitelines` next to where you run it. Point `serve` at the same `--out` you scanned to. |
| `--port N` | `serve`, `open`, `demo` | Server port. Defaults to `4370`. |
| `--open` | `serve` | Launch a browser once the server is up. `open` does this for you. |
| `--base URL` | `scan` | Records the deployed origin of the site in `flow.json`. See below. |
| `--dir DIR` | `demo`, `skill`, `agents` | For `demo`, the folder to copy the example into (default `sitelines-demo`). For `skill` and `agents`, install somewhere other than the default location. |
| `--global` / `--project` | `skill` | `~/.claude/skills/sitelines` or `./.claude/skills/sitelines`. Defaults to `--global`. |
| `--force` | `skill install` | Overwrite an existing install instead of stopping. |

### `--base URL`

```bash
npx sitelines scan --base https://example.com
```

Writes that origin into `.sitelines/flow.json` as a top-level `base` field, and a later `scan` keeps it if
you do not pass the flag again.

It is metadata, not behaviour. The viewer does not use it: previews are always served off disk from the
local server, so a scan with `--base` maps exactly the same site as a scan without it. Set it when
something *else* consumes `flow.json` — a CI job checking the scanned routes against what is actually
deployed, or a report that needs to print absolute URLs — and leave it off otherwise.

## What the scanner reads

| Source | How the label is found |
| --- | --- |
| `<a href>` | The link text |
| `<button>` / `<div>` with `onclick="location.href=…"`, `data-href`, `data-nav`, `formaction` | The element text |
| `<form action>` | `POST form` |
| `<meta http-equiv=refresh>` | `meta refresh` |
| `location.href` / `.assign` / `.replace`, `window.open`, `router.push` / `.replace`, `navigate()` | The nearest `getElementById` or `querySelector` above the call |

Pages are `*.html` files. If a project has none, sitelines falls back to framework page files under
`pages/`, `routes/`, or `app/`.

It is static analysis, so it reads what is in the source. A destination assembled at runtime from a template
string is not something a scanner can resolve, and sitelines skips it rather than guessing.

Directories it never walks into: `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `vendor`,
`target`, `tmp`, and the framework caches (`.next`, `.nuxt`, `.output`, `.svelte-kit`, `.astro`, `.cache`,
`.turbo`, `.parcel-cache`, `.vercel`, `.netlify`, `.wrangler`).

### Repeated links

A nav bar repeated on twenty pages emits twenty identical links, and those wires bury every link that is
actually specific to a page. sitelines detects any link appearing on more than four pages, folds it away,
and reports the count it folded. Turn it back on under **Layers**.

Folding is a drawing decision, never an analytical one. A page reachable only through your footer is still
reachable, and sitelines will not call it an orphan just because the footer is hidden.

## Views

The base view, **everything**, always shows every page and never takes a rule. Filter from it and sitelines
starts a new view rather than quietly turning your one complete picture into a partial one. Press **+** on
the tab bar to name a view, or write one into `.sitelines/views.json` and it appears:

```json
{
  "active": "all",
  "views": [
    { "id": "all",  "label": "everything", "base": true, "include": [], "exclude": [] },
    { "id": "docs", "label": "docs only",  "include": ["/docs/**"], "exclude": [] },
    { "id": "app",  "label": "no legal",   "include": [], "exclude": ["/legal/**"] }
  ]
}
```

| Pattern | Matches |
| --- | --- |
| `/docs/**` | The whole subtree |
| `/docs/` | That exact route |
| `/docs/*` | One level down only |
| `*report*` | Any route containing the substring |

The base view is a guarantee, not a default: the server restores it if a hand-edit drops it, and strips any
rule added to it.

## Directories

Pages sharing a top-level directory sit on a labelled backdrop. Click the label to fold the whole directory
into one card: internal links disappear, and the directory keeps one wire per neighbour labelled `N links`,
with every underlying control in its tooltip.

## Keyboard

| | |
| --- | --- |
| Drag background / wheel | Pan / zoom |
| `f` | Fit everything on screen |
| `/` | Focus the filter |
| `1` `2` `3` | Switch views |
| `e` | New link from the selected page |
| `Escape` | Cancel whatever is in progress |

## Previews

Two defaults worth knowing:

- **Page JavaScript is off.** Preview iframes get an empty `sandbox`. A page that polls or retries a dead
  API will otherwise peg your browser forty iframes over. Markup and CSS still render. Turn it on under
  **Layers → Run page JavaScript**.
- **Service workers are blocked** inside previews, or your site's own worker caches the preview responses
  and serves them back for every later preview.

Previews come straight off disk, so you do not need a dev server running. For pages that need real data or
a login, run your own dev server and use the **Open** button on the card.

## Performance

Large sites stay usable because the viewer refuses to pretend:

- At most 12 preview iframes stay mounted, two loading at a time. Offscreen cards unmount.
- Past 60 pages previews start off, and the viewer says why.
- Below 0.26 zoom, thumbnails and wire labels leave the render tree instead of compositing a smear.

## State files

sitelines writes one directory next to where you run it, or wherever `--out` points:

```
.sitelines/
├── flow.json     the scan: pages, links, issues, plus your card positions and notes
├── views.json    your views and their rules
└── edits.json    the change queue, including applied history
```

Add it to `.gitignore` if it is yours alone, or commit it to share the layout and notes with your team.
Nothing outside this directory is ever written.

A rescan does not throw away what you added: card positions, notes, and the recorded `base` survive it.

## Troubleshooting

**`0 nodes, 0 links`** — the scanner looked in the wrong place. It only guesses; if none of the candidate
directories exist it scans the whole current directory, which usually finds nothing useful. Say where the
pages are:

```bash
npx sitelines open --root src/routes
```

**`sitelines: root not found: …`** — the `--root` path does not exist. It is resolved relative to where you
ran the command, not to the repo root.

**`sitelines: port 4370 is already in use`** — something else has the port. Use another:

```bash
npx sitelines open --port 5000
```

**The map is empty but the scan found pages** — `serve` is reading a different state directory than `scan`
wrote. Pass the same `--out` to both.

**Previews are blank or unstyled** — page JavaScript is off by default, so anything that renders
client-side shows up empty. Turn it on under **Layers → Run page JavaScript**. On maps past 60 pages
previews start off entirely; the viewer says so, and **Layers** turns them back on.

**Previews need a login or live data** — sitelines reads files off disk, so it cannot log in. Run your own
dev server and use the **Open** button on a card.

**A link you know exists is missing** — it is probably built at runtime. Static analysis cannot resolve a
destination assembled from a template string, and sitelines skips those rather than guessing. See
[What the scanner reads](#what-the-scanner-reads).

**`/sitelines` does nothing in Claude Code** — restart Claude Code after installing the skill, and check
that `~/.claude/skills/sitelines/SKILL.md` exists.
