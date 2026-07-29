<!-- sitelines:begin -->
## sitelines: the site navigation map

This project uses [sitelines](https://github.com/Jkaos725/sitelines) to map its navigation. Every page and
every link, button, redirect, and form between them is scanned into `.sitelines/flow.json`, and changes the
user makes in the browser map are queued into `.sitelines/edits.json` for you to implement.

### Show the map

```bash
npx sitelines scan --root public     # -> .sitelines/flow.json
npx sitelines serve --root public    # -> http://localhost:4370
```

Run `serve` in the background and give the user the URL. Never block on it. `--root` is the directory
holding the pages; it is auto-detected if omitted. The viewer never writes to the site.

### Answer questions from flow.json, not from grep

`.sitelines/flow.json` already holds every navigation edge with its trigger text, `file`, and `line`. Read
it to answer "where does this button go", "what links to this page", or "what is unreachable" instead of
searching the codebase by hand.

`flow.json.issues` carries, in priority order: `deadLinks` (a control that goes nowhere, always a real
bug), `orphans` and `unreachable` (no inbound link, or not reachable from the entry by clicking), `deep`
(more than 3 clicks from the entry), `deadEnds` (no exits), and `hubs` (more than 12 exits). Report these
with `file:line` and let the user choose before changing anything.

### Apply the user's queued changes

When the user says "apply my sitelines changes" or similar, read `.sitelines/edits.json` and implement
every entry whose `status` is `pending`:

| op | what to do in code |
| --- | --- |
| `add-link` | add the anchor or button on `from` (in the region named by `where`, matching sibling markup and the project's conventions) navigating to `to`, text = `label`; `via: redirect` means a JS `location.href`, `via: form` means a form `action` |
| `remove-link` | delete the control at `file:line`, and any handler left dangling |
| `relabel` | change the visible text `oldLabel` to `label` at `file:line`; keep `aria-label` and `title` in sync |
| `retarget` | change the destination `to` to `newTo` at `file:line` |
| `add-page` | create the page at `route` following the repo's existing page scaffold (copy the closest sibling page: same head, nav, footer, asset versioning) |
| `delete-page` | delete the page file and every link pointing at it (query the flow for edges whose `to` equals the route) |

Line numbers are from the last scan, so **match on the label text first** and treat the number as a hint.

After applying: re-run `sitelines scan`, confirm the intended links exist and no new dead link appeared,
then set `"status": "applied"` on each entry you implemented. Keep them as history; do not delete them.
Report what changed as `file:line`.

Obey this repo's own conventions when writing: read `CLAUDE.md`, `AGENTS.md`, or any project docs for
cache-busting query strings, nav partials, route registration, and tests that must run.

### State

```
.sitelines/flow.json     the scan, plus the user's card positions and notes
.sitelines/views.json    saved views; "everything" is the base view and always shows every page
.sitelines/edits.json    the change queue, including applied history
```

`layout` and `notes` in `flow.json` are user data. The scanner preserves them; never hand-edit them away.
<!-- sitelines:end -->
