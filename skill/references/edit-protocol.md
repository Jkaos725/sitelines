# routemap change protocol

`.routemap/edits.json` is a JSON array, append-only from the viewer. Every entry:

```json
{ "id": "e1m2k3", "at": "2026-07-28T18:03:11.000Z", "status": "pending", "op": "...", "summary": "human sentence" }
```

`status`: `pending`, then the agent implements it and sets `applied`, keeping the record. Use `rejected`
with a `reason` if the user decides against it after discussion.

## Ops

### add-link
```json
{ "op":"add-link", "from":"/home/", "to":"/pricing/", "label":"See pricing", "via":"link|button|redirect|form", "where":"hero CTA row" }
```
Add a real control on the `from` page. `where` is a free-text hint from the user. If it is empty, place the
control next to the closest existing sibling control and say where you put it.

### remove-link
```json
{ "op":"remove-link", "from":"/home/", "to":"/beta/", "label":"Try beta", "file":"home/index.html", "line":142 }
```
`file` is relative to the scan root. The line comes from the last scan, so verify by matching the label
rather than trusting the number.

### relabel
```json
{ "op":"relabel", "from":"/home/", "to":"/join/", "oldLabel":"Sign up", "label":"Get started", "file":"home/index.html", "line":88 }
```

### retarget
```json
{ "op":"retarget", "from":"/home/", "to":"/login/", "newTo":"/join/", "label":"Get started", "file":"home/index.html", "line":88 }
```

### add-page
```json
{ "op":"add-page", "route":"/pricing/", "label":"Pricing" }
```
Scaffold from the closest sibling page in the same section, so head tags, nav, footer, asset versioning,
and auth guards match. Usually paired with an `add-link` entry.

### delete-page
```json
{ "op":"delete-page", "route":"/beta/", "file":"beta/index.html" }
```
Also remove every inbound link (query the flow for edges whose `to` equals the route).

## Rules

1. The viewer never writes to the site. Every source change comes from the agent, after the user asks.
2. Re-run `scan.mjs` after applying. A fix that creates a new dead link is not done.
3. `flow.json` fields `layout` (card positions) and `notes` (per-route text) are user data. The scanner
   preserves them; never hand-edit them away.
4. Line numbers and `file` paths refer to the state at scan time. Match on the label text first.
