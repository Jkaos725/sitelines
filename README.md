# routemap

**See every page on your site, every link between them, and everything that is broken.**

routemap reads your source, finds each page and each link, button, redirect, and form that moves between
them, then serves a map in your browser. Every card is a real page with a live preview. Every wire is a real
control, labelled with its actual button text and traced to `file:line`.

It flags what is wrong: links that go nowhere, pages nothing links to, pages with no way out, pages buried
more than three clicks deep, and pages carrying too many exits.

You can also change the navigation from the map. Rename a button, point it somewhere else, draw a new link
between two pages, propose a new page. Nothing is written to your site. Changes queue to a JSON file, and a
coding agent implements them in your code when you ask.

Zero dependencies. No build step. Node 18+.

---

## Two ways to use it

|  | **The tool** | **The agent skill** |
| --- | --- | --- |
| What you get | The scanner, the server, and the map UI | A Claude Code skill that runs all of that, plus the instructions for applying your queued changes to real code |
| Needs an AI agent | No | Yes, Claude Code |
| Can queue changes | Yes | Yes |
| Can *apply* changes to your code | No, you do it | Yes, the agent does it |
| Install | `npx routemap` | `npx routemap skill install` |

Start with the tool. Add the skill when you want the queued changes actually written for you.

---

## Option 1: the tool

### Run it without installing

```bash
cd your-project
npx routemap open
```

That scans, starts the server, and opens `http://localhost:4370`.

### Install it

```bash
npm install -g routemap        # or: pnpm add -g routemap
cd your-project
routemap open
```

### Or clone it

```bash
git clone https://github.com/YOUR-USERNAME/routemap.git
cd your-project
node /path/to/routemap/bin/routemap.mjs open
```

There is nothing to build and nothing to install. The whole tool is Node's standard library.

### Commands

```
routemap scan  [--root DIR] [--out DIR]                 read the site, write .routemap/flow.json
routemap serve [--root DIR] [--out DIR] [--port N] [--open]   open the map
routemap open  [--root DIR] [--port N]                  scan, serve, and open the browser
routemap skill install   [--global|--project] [--force] install the Claude Code skill
routemap skill uninstall [--global|--project]           remove it
routemap version
routemap help
```

`--root` is the directory holding your pages. Leave it off and routemap looks for the first of `public`,
`site`, `www`, `static`, `src/pages`, `src/routes`, `src/app`, `app/pages`, `pages`, `app`, `docs`.

```bash
routemap open --root src/routes --port 5000
```

---

## Option 2: the Claude Code skill

The skill is the same tool plus the instructions an agent needs to turn your queued changes into real code.
Install it whichever way suits you.

### With the CLI

```bash
npx routemap skill install            # -> ~/.claude/skills/routemap    (every project)
npx routemap skill install --project  # -> ./.claude/skills/routemap    (this repo only)
```

### By hand, from a clone

A Claude Code skill is just a folder containing a `SKILL.md`. Copy these four things into it:

```bash
git clone https://github.com/YOUR-USERNAME/routemap.git
mkdir -p ~/.claude/skills/routemap

cp    routemap/skill/SKILL.md   ~/.claude/skills/routemap/
cp -r routemap/skill/references ~/.claude/skills/routemap/
cp -r routemap/scripts          ~/.claude/skills/routemap/
cp -r routemap/viewer           ~/.claude/skills/routemap/
```

On Windows PowerShell:

```powershell
git clone https://github.com/YOUR-USERNAME/routemap.git
New-Item -ItemType Directory -Force "$HOME\.claude\skills\routemap"

Copy-Item routemap\skill\SKILL.md   "$HOME\.claude\skills\routemap\"
Copy-Item routemap\skill\references "$HOME\.claude\skills\routemap\" -Recurse
Copy-Item routemap\scripts          "$HOME\.claude\skills\routemap\" -Recurse
Copy-Item routemap\viewer           "$HOME\.claude\skills\routemap\" -Recurse
```

### By asking Claude Code

Paste this into Claude Code and it will do the install for you:

> Install the routemap skill from https://github.com/YOUR-USERNAME/routemap into `~/.claude/skills/routemap`.
> Clone the repo to a temp directory, copy `skill/SKILL.md`, `skill/references/`, `scripts/`, and `viewer/`
> into the skill folder, then confirm `~/.claude/skills/routemap/SKILL.md` exists.

### Then

Restart Claude Code and type `/routemap`, or just ask in your own words:

- "show me the site flow"
- "map this app"
- "where does the Get started button go?"
- "find the dead links"
- "apply my routemap changes"

The skill folder ends up looking like this:

```
~/.claude/skills/routemap/
├── SKILL.md                   what the agent reads
├── DESIGN.md                  the viewer's visual system
├── references/
│   └── edit-protocol.md       the exact shape of every queued change
├── scripts/                   scan.mjs, serve.mjs
└── viewer/                    index.html, app.js, style.css
```

---

## Using the map

**Getting around**

| | |
| --- | --- |
| Drag the background | Pan |
| Wheel | Zoom |
| `f` | Fit everything on screen |
| `/` | Focus the filter box |
| `1` `2` `3` | Switch view tabs |
| `Escape` | Cancel whatever is in progress |
| Drag a card | Move it. The position is saved |

**Reading a card**

Each page card shows its route, a live preview, and a badge counting entrances and exits. The dots down the
left edge are entrances, the dots down the right edge are exits. Hover any dot or any wire to see the
control's real text, both routes, how it navigates, and the `file:line` it lives at. Click a dot to jump to
the page at the other end.

Pages sharing a top-level directory sit on a labelled backdrop. Click the label to collapse the whole
directory into one card.

**Reading a wire**

Color is state, and stroke is mechanism:

| | |
| --- | --- |
| Solid | An anchor or a button |
| Dotted | A script navigation (`location.href`, `router.push`, …) |
| Long dashes | A redirect |
| Solid with a bar at the source | A form submit |
| Red | The target does not exist |
| Amber, dashed | A change you queued that is not in the code yet |

**Changing the navigation**

| Do this | Get this |
| --- | --- |
| Edit an exit's text field | A queued rename |
| Change an exit's destination dropdown | A queued retarget |
| Click the ✕ on an exit | A queued removal |
| **+ Link**, then click a destination | A queued new control |
| **+ Page** | A queued new page, optionally linked from the selected one |

Open **Changes** to see the queue, then **Copy prompt** and paste it to your agent. Or just say *"apply my
routemap changes"* if you installed the skill.

---

## State

routemap writes one directory next to where you run it:

```
.routemap/
├── flow.json     the scan: pages, links, issues, plus your card positions and notes
├── views.json    your view tabs and their hide/only rules
└── edits.json    the change queue, including applied history
```

Add it to `.gitignore` if it is yours alone, or commit it to share the layout and notes with your team.
Nothing outside this directory is ever written.

---

## What the scanner reads

| Source | How the label is found |
| --- | --- |
| `<a href>` | The link text |
| `<button>` / `<div>` with `onclick="location.href=…"`, `data-href`, `data-nav`, `formaction` | The element text |
| `<form action>` | `POST form` |
| `<meta http-equiv=refresh>` | `meta refresh` |
| `location.href` / `.assign` / `.replace`, `window.open`, `router.push` / `.replace`, `navigate()` | The nearest `getElementById` or `querySelector` above the call |

Pages are `*.html` files. If a project has none, routemap falls back to framework page files under
`pages/`, `routes/`, or `app/`.

It is static analysis, so it reads what is in the source. A destination built at runtime from a template
string is not something a scanner can resolve, and routemap skips it rather than guessing.

## Previews

Previews come straight off disk, so you do not need a dev server running. Two things are true by default
and worth knowing:

- **Page JavaScript is off.** Preview iframes get an empty `sandbox`. A page that polls or retries a dead
  API will otherwise peg your browser forty iframes over. Markup and CSS still render. Turn it on under
  **Layers → Run page JavaScript**.
- **Service workers are blocked** inside previews. Otherwise your site's own worker caches the preview
  responses and serves them back for every later preview.

For pages that need real data or a login, run your own dev server and use the **Open** button on the card.

## Performance

Large sites stay usable because the viewer refuses to pretend:

- At most 12 preview iframes stay mounted, two loading at a time. Offscreen cards unmount.
- Past 60 pages, previews start off and the viewer tells you why.
- Below 0.26 zoom, thumbnails and wire labels leave the render tree instead of compositing an unreadable
  smear.

If it still feels heavy, turn off **Live page previews** under Layers.

---

## Contributing

Issues and pull requests are welcome.

- **No dependencies.** Everything is Node's standard library and platform web APIs. A PR that adds a
  runtime dependency needs a strong reason.
- **No build step.** `viewer/` is HTML, CSS, and ES modules served as written.
- **Read `DESIGN.md` before touching `viewer/style.css`.** It is the authority on tokens, shape, type,
  motion, and what the colors mean.
- Test against a real site with more than 40 pages. Density is where this tool succeeds or fails.

## License

MIT. See [LICENSE](LICENSE).
