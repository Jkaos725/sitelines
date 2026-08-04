<div align="center">

# sitelines

**See every page on your site, every link between them, and everything that is broken.**

Zero dependencies · no build step · Node 18+ · MIT

</div>

![The sitelines viewer showing a 20-page site laid out by click depth, with dead links in red](https://raw.githubusercontent.com/Jkaos725/sitelines/main/docs/map.jpg)

sitelines reads your source, finds every page and every link, button, redirect, and form that moves between
them, then serves a map in your browser. Each card is a real page with a live preview. Each wire is a real
control, labelled with its actual button text and traced back to `file:line`.

It tells you what is wrong: links that go nowhere, pages nothing links to, pages with no way out, pages
buried more than three clicks deep, and pages carrying too many exits.

You can also change the navigation from the map. Rename a button, point it somewhere else, draw a new link
between two pages, propose a new page. **Nothing is written to your site.** Changes queue to a JSON file,
and a coding agent implements them in your code when you ask.

> The screenshots on this page are the bundled example site, mapped by sitelines itself. Run
> `npx sitelines demo` and you get exactly this.

[How to use it](#how-to-use-it) ·
[Install](#install) ·
[What you get](#what-you-get) ·
[Reference](docs/reference.md) ·
[Troubleshooting](docs/reference.md#troubleshooting)

---

## How to use it

**1. Point it at your pages.**

```bash
cd your-project
npx sitelines open
```

That scans, starts a local server, and opens `http://localhost:4370`. Nothing is installed — see
[Install](#install) for the other package managers and for a permanent install.

It looks for your pages in the first of `public`, `site`, `www`, `static`, `src/pages`, `src/routes`,
`src/app`, `app/pages`, `pages`, `app`, `docs` that exists, and falls back to the whole current directory
if none do. Point it somewhere else with `--root`:

```bash
npx sitelines open --root src/routes --port 5000
```

**2. Read the map.** Columns are click depth from your front door. Cards are pages. Wires are controls. The
left sidebar counts what exists and lists what is broken, and every issue jumps you to the page it is on.

**3. Change the navigation.** Edit an exit's text, change where it points, draw a new link, propose a page.
Everything you do queues up instead of touching your files.

**4. Hand the queue to an agent.** Press **Copy prompt**, or install the skill and say
*"apply my sitelines changes"*.

---

## Install

There is nothing to install to use it — `npx sitelines open` runs the whole thing. Everything below is
optional: seeing it on a throwaway site first, keeping the command around, or teaching an agent to write
your queued changes.

### Try it on the demo site

Safest first run. Copies a 20-page example site into `./sitelines-demo` and maps that. Nothing outside
that folder is touched, and your own project is never read.

```bash
npx sitelines demo
```

The example has deliberate faults so every part of the map has something to show: two dead links (one of
them only reachable by reading the JavaScript), three orphans, a dead end, and a page four clicks deep.

### Run it without installing

Pick your package manager. All five do the same thing.

```bash
npx sitelines open                    # npm
pnpm dlx sitelines open               # pnpm
bunx sitelines open                   # bun
yarn dlx sitelines open               # yarn
deno run -A npm:sitelines open        # deno
```

Every other `npx` in this README substitutes the same way.

### Install it permanently

```bash
npm  install -g sitelines     # then: sitelines open
pnpm add -g sitelines         # then: sitelines open
bun  add -g sitelines         # then: sitelines open
```

Yarn 2+ has no global install, so add it to the project instead — note the different run command:

```bash
yarn add --dev sitelines      # then: yarn sitelines open
```

### Run it from source

Nothing to build. Clone once, anywhere, and point Node at `bin/sitelines.mjs` from inside the project you
want mapped:

```bash
git clone https://github.com/Jkaos725/sitelines.git ~/tools/sitelines

cd /path/to/your-project
node ~/tools/sitelines/bin/sitelines.mjs open
```

<details>
<summary>Why any package manager works</summary>

sitelines has no dependencies and no build step, so there is nothing for a package manager to disagree
about. Node 18+, Bun, and Deno all run it; npm, pnpm, yarn (both `node_modules` and Plug'n'Play), and bun
all install it.

</details>

### Let an agent write the changes

The same tool, plus the instructions an agent needs to turn your queued changes into real code. This is what
lets the changes you queue in the map actually get **written** into your source.

**Claude Code** reads skill folders:

```bash
npx sitelines skill install            # ~/.claude/skills/sitelines    (every project)
npx sitelines skill install --project  # ./.claude/skills/sitelines    (this repo only)
```

**Codex, opencode, Cursor, Zed, Gemini CLI** read `AGENTS.md` from your project root:

```bash
npx sitelines agents install            # writes the block into ./AGENTS.md
npx sitelines agents uninstall          # takes it back out
```

That appends a fenced block rather than overwriting, so an existing `AGENTS.md` keeps everything it
already had. Re-running replaces the block in place instead of duplicating it, and uninstalling leaves
your own content untouched.

<details>
<summary>Install it by hand instead</summary>

A Claude Code skill is just a folder containing a `SKILL.md`. Copy four things into it:

```bash
git clone https://github.com/Jkaos725/sitelines.git
mkdir -p ~/.claude/skills/sitelines

cp    sitelines/skill/SKILL.md   ~/.claude/skills/sitelines/
cp -r sitelines/skill/references ~/.claude/skills/sitelines/
cp -r sitelines/scripts          ~/.claude/skills/sitelines/
cp -r sitelines/viewer           ~/.claude/skills/sitelines/
```

On Windows PowerShell:

```powershell
git clone https://github.com/Jkaos725/sitelines.git
New-Item -ItemType Directory -Force "$HOME\.claude\skills\sitelines"

Copy-Item sitelines\skill\SKILL.md   "$HOME\.claude\skills\sitelines\"
Copy-Item sitelines\skill\references "$HOME\.claude\skills\sitelines\" -Recurse
Copy-Item sitelines\scripts          "$HOME\.claude\skills\sitelines\" -Recurse
Copy-Item sitelines\viewer           "$HOME\.claude\skills\sitelines\" -Recurse
```

</details>

<details>
<summary>Or ask Claude Code to install it</summary>

Paste this in:

> Install the sitelines skill from https://github.com/Jkaos725/sitelines into `~/.claude/skills/sitelines`.
> Clone the repo to a temp directory, copy `skill/SKILL.md`, `skill/references/`, `scripts/`, and `viewer/`
> into the skill folder, then confirm `~/.claude/skills/sitelines/SKILL.md` exists.

</details>

Restart Claude Code, then type `/sitelines` or just ask:

- "show me the site flow"
- "where does the Start free button go?"
- "find the dead links"
- "apply my sitelines changes"

### The commands

```
sitelines open    scan, serve, and open the browser   -- the usual one
sitelines demo    copy the example site and map it
sitelines scan    read the site, write .sitelines/flow.json
sitelines serve   open the map for an existing scan
sitelines help    every command and flag
```

Every flag, including `--base`, is in the [reference](docs/reference.md#flags).

---

## What you get

### Every page is live, at any width

![The inspector panel open on a docs page, showing a live desktop preview and all eight of its exits with file and line numbers](https://raw.githubusercontent.com/Jkaos725/sitelines/main/docs/inspector.jpg)

Click a card to open it: a real preview at mobile, tablet, or desktop width, every exit with its editable
label and destination, every entrance, and a notes field. Previews come straight off disk, so you do not
need a dev server running.

The dots down each side of a card are ports, and each wire terminates on the exact dot that represents it.
Hover any dot or wire for the control's real text, both routes, how it navigates, and its `file:line`.

### Changes queue instead of landing

![The queued changes drawer listing five pending edits, with the map already previewing them](https://raw.githubusercontent.com/Jkaos725/sitelines/main/docs/changes.jpg)

| Do this | Get this |
| --- | --- |
| Edit an exit's text field | A queued rename |
| Change an exit's destination | A queued retarget |
| Click the ✕ on an exit | A queued removal |
| **+ Link**, then click a destination | A queued new control |
| **+ Page** | A queued new page, optionally linked from the selected one |

The map previews the result immediately: queued links draw in amber, and a proposed page appears as a
dashed card. The queue lives in `.sitelines/edits.json` and is the only thing sitelines writes.

### Both themes, because it sits next to your editor

![The same map in dark mode](https://raw.githubusercontent.com/Jkaos725/sitelines/main/docs/dark.jpg)

Follows `prefers-color-scheme` and remembers a manual override. Every text color clears WCAG AA in both.

### It stays readable on a real site

Your header and footer are folded away — any link appearing on more than four pages, with the count it
folded reported on screen — so the wires that remain are the ones specific to a page. Directories fold into
single cards. Filtered views are yours to name and save. None of it changes the analysis: a page reachable
only through your footer is still reachable, and sitelines will not call it an orphan.

---

## What it writes

One directory, next to where you run it. Nothing outside it is ever touched.

```
.sitelines/
├── flow.json     the scan: pages, links, issues, plus your card positions and notes
├── views.json    your views and their rules
└── edits.json    the change queue, including applied history
```

Add it to `.gitignore` if it is yours alone, or commit it to share the layout and notes with your team.

## Reference

The details live in [`docs/reference.md`](docs/reference.md):

- [Commands and every flag](docs/reference.md#flags), including `--base`
- [What the scanner reads](docs/reference.md#what-the-scanner-reads) — which markup and JS calls become
  links, and what static analysis cannot see
- [Views](docs/reference.md#views), [directories](docs/reference.md#directories), and the
  [keyboard map](docs/reference.md#keyboard)
- [Previews](docs/reference.md#previews) and [performance on large sites](docs/reference.md#performance)
- [Troubleshooting](docs/reference.md#troubleshooting)

---

## Contributing

Issues and pull requests are welcome.

- **No dependencies.** Everything is Node's standard library and platform web APIs. A PR adding a runtime
  dependency needs a strong reason.
- **No build step.** `viewer/` is HTML, CSS, and ES modules served as written.
- **Read `DESIGN.md` before touching `viewer/style.css`.** It is the authority on tokens, shape, type,
  motion, and what each color means.
- Test against `examples/demo-site` and against something with more than 40 pages. Density is where this
  tool succeeds or fails.

## License

MIT. See [LICENSE](LICENSE).
