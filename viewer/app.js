// sitelines viewer
const $ = (s) => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (t, a = {}) => { const n = document.createElementNS(SVGNS, t); for (const k in a) n.setAttribute(k, a[k]); return n; };
// glyphs come from the sprite in index.html; see DESIGN.md on why there is no icon package
const icon = (id, cls = 'icon') => {
  const s = svgEl('svg', { class: cls });
  s.appendChild(svgEl('use', { href: `#${id}` }));
  return s;
};
const iconBtn = (id, cls, label) => {
  const b = el('button', cls);
  b.type = 'button';
  b.appendChild(icon(id, 'icon sm'));
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
};

const COL = 330, ROW = 232, PAD = 96, W = 232, H = 188, WS = 172, HS = 74, PER_COL = 7;

const S = {
  flow: null, edits: [], sel: null, linkFrom: null,
  cfg: null, mode: 'site',            // which view tab is active (from .sitelines/views.json)
  cam: { x: 60, y: 60, k: 0.8 },
  nodes: new Map(), pos: new Map(), dom: new Map(), io: new Map(), ioAll: new Map(), depth: new Map(), colX: new Map(),
  edges: [], collapsed: new Set(), groups: new Map(),
  // page JS is off by default: previews are the real pages, and one with a
  // polling loop or a failing API call will peg the renderer 40 frames over.
  filters: { shared: false, api: false, ext: false, preview: true, js: false },
  q: '',
};

const CACHE_KEY = 'sitelines:cache:v1';
const THEME_KEY = 'sitelines:theme';

boot();

async function boot() {
  wireUI();
  // paint from the last session's map immediately, then refresh from the server
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.root === location.host + (c.flow?.root || '')) { paint(c.flow, c.cfg, c.edits || []); fit(); }
  } catch { /* stale cache shape - ignore */ }
  try {
    await reload();
  } catch (e) {
    return fatal(e);
  }
  if (S.pos.size) fit();
}

// the server is the only source of the map; if it is gone, say so plainly
function fatal(e) {
  const box = el('div', 'fatal');
  box.appendChild(icon('i-alert'));
  box.appendChild(el('b', null, 'Cannot reach the sitelines server'));
  const msg = el('span');
  msg.append('The viewer is open but ', el('code', null, 'sitelines serve'), ' is not answering. Restart it, then reload this page.');
  box.appendChild(msg);
  box.appendChild(el('code', null, String(e && e.message || e)));
  document.body.appendChild(box);
}

async function reload() {
  const grab = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u} -> ${r.status}`); return r.json(); });
  const [flow, edits, cfg] = await Promise.all([grab('/api/flow'), grab('/api/edits'), grab('/api/views')]);
  const first = !S.flow;
  paint(flow, cfg, edits);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ root: location.host + flow.root, flow, cfg, edits })); } catch { /* quota */ }
  if (first && flow.nodes.filter((n) => n.type === 'page').length > 60) {
    S.filters.preview = false;           // past ~60 iframes even script-less previews drag
    $('#fPreview').checked = false;
    render();
    toast('Large map, so previews are off. Turn them on under Layers, or click a page for its full preview.', true);
  }
}

function paint(flow, cfg, edits) {
  S.flow = flow; S.cfg = cfg; S.edits = edits;
  S.mode = S.cfg.views.some((v) => v.id === S.mode) ? S.mode : (S.cfg.active || S.cfg.views[0].id);
  S.nodes = new Map(S.flow.nodes.map((n) => [n.id, n]));
  for (const e of pending('add-page')) if (!S.nodes.has(e.route)) {
    S.nodes.set(e.route, { id: e.route, label: e.label || e.route, title: e.label || e.route, type: 'ghost', group: e.route.split('/').filter(Boolean)[0] || 'root', file: null });
  }
  $('#rootLabel').textContent = shortRoot(flow.root);
  renderTabs();
  recompute();
  render();
  renderRail();
  renderEdits();
  if (S.sel) select(S.sel, true);
}

/* ---------- view model ---------- */
const pending = (op) => S.edits.filter((e) => e.status !== 'applied' && (!op || e.op === op));
const view = () => S.cfg.views.find((v) => v.id === S.mode) || S.cfg.views[0];

// include/exclude rules are plain route patterns the user owns:
//   /admin/**   every route under it      /admin/    that exact route
//   /admin/*    one level under it        *report*   substring
function matches(id, pat) {
  if (!pat) return false;
  if (pat.endsWith('/**')) { const p = pat.slice(0, -2); return id === p || id.startsWith(p); }
  if (!pat.includes('*')) return id === pat || id === pat + '/';
  const re = new RegExp('^' + pat.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(id);
}
const excluded = (id) => {
  const v = view();
  if (v.include?.length && !v.include.some((p) => matches(id, p))) return true;
  return !!v.exclude?.some((p) => matches(id, p));
};

function inView(n) {
  if (n.type === 'api') return S.filters.api;
  if (n.type === 'external') return S.filters.ext;
  if (n.type === 'missing') return true;
  return !excluded(n.id);
}

async function saveViews() {
  S.cfg.active = S.mode;
  renderTabs(); recompute(); render(); renderRail();
  await fetch('/api/views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(S.cfg) });
}

/* ---------- views ---------- */
// "everything" is the base view. It always shows every page and never takes a
// rule, so filtering while it is active creates a new view rather than quietly
// turning the one complete picture of the site into a partial one.
const isBase = (v) => !!(v || view()).base;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'view';
const tidy = (pat) => String(pat).replace(/[/*]+/g, ' ').trim() || 'root';
const labelFor = (kind, pat) => (kind === 'include' ? tidy(pat) : `no ${tidy(pat)}`);

function newView(label, rule) {
  const taken = new Set(S.cfg.views.map((v) => v.id));
  let id = slug(label), i = 2;
  while (taken.has(id)) id = `${slug(label)}-${i++}`;
  const v = {
    id, label,
    include: rule && rule.kind === 'include' ? [rule.pat] : [],
    exclude: rule && rule.kind === 'exclude' ? [rule.pat] : [],
    collapsed: [],
  };
  S.cfg.views.push(v);
  S.mode = id;
  return v;
}

// one entry point for every "hide this" affordance, so the base-view rule holds
// no matter which control the user reached for
function addExcludeRule(pat, kind = 'exclude') {
  if (isBase()) {
    const v = newView(labelFor(kind, pat), { kind, pat });
    toast(`“everything” always shows every page, so this went into a new view: ${v.label}`);
  } else {
    const v = view();
    v[kind] = [...new Set([...(v[kind] || []), pat])];
    if (kind === 'exclude') v.include = (v.include || []).filter((p) => p !== pat);
    toast(`${view().label}: ${kind === 'include' ? 'only ' : 'hiding '}${pat}`);
  }
  saveViews();
}

async function promptNewView() {
  const v = await modal('New view', [
    { name: 'label', label: 'Name, for example “docs only” or “no admin”', value: '' },
    { name: 'kind', label: 'First rule', type: 'select', options: ['hide these routes', 'show only these routes'], value: 'hide these routes' },
    { name: 'pat', label: 'Route pattern (optional), for example /admin/**', value: '' },
  ], 'Create view');
  if (!v || !v.label.trim()) return;
  const kind = v.kind.startsWith('show only') ? 'include' : 'exclude';
  newView(v.label.trim(), v.pat.trim() ? { kind, pat: v.pat.trim() } : null);
  S.sel = null; $('#inspect').hidden = true;
  await saveViews();
  fit();
}

async function deleteView() {
  const v = view();
  if (isBase(v)) return;
  S.cfg.views = S.cfg.views.filter((x) => x !== v);
  S.mode = 'all';
  S.sel = null; $('#inspect').hidden = true;
  toast(`Deleted the view “${v.label}”`);
  await saveViews();
  fit();
}

function renderLayerCount() {
  const on = ['shared', 'api', 'ext'].filter((k) => S.filters[k]).length + (S.filters.js ? 1 : 0) + (S.filters.preview ? 0 : 1);
  const b = $('#layerCount');
  b.textContent = String(on);
  b.hidden = !on;
}

function renderTabs() {
  const box = $('#tabs'); box.textContent = '';
  S.cfg.views.forEach((v, i) => {
    const b = el('button', 'tab' + (v.id === S.mode ? ' on' : ''), v.label || v.id);
    b.type = 'button';
    b.dataset.view = v.id;
    b.setAttribute('aria-pressed', String(v.id === S.mode));
    b.title = v.base
      ? `Every page, always. Filtering here creates a new view.  (key ${i + 1})`
      : `${v.include?.length ? 'Only ' + v.include.join(', ') : 'All routes'}${v.exclude?.length ? ', minus ' + v.exclude.join(', ') : ''}  (key ${i + 1})`;
    box.appendChild(b);
  });
  const add = el('button', 'tab add');
  add.type = 'button';
  add.dataset.add = '1';
  add.appendChild(icon('i-plus', 'icon sm'));
  add.title = 'New view: a saved subset of the map';
  add.setAttribute('aria-label', 'New view');
  box.appendChild(add);
}

// A link that appears on more than a handful of pages is chrome: a header, a
// footer, a nav partial. It is real, but drawing it once per page hides
// everything that is specific to a page, so it folds away by default.
const sitewide = (e) => e.kind === 'js-shared' || e.repeated === true;

const visibleEdge = (e) => (!sitewide(e) || S.filters.shared)
  && S.nodes.has(e.from) && S.nodes.has(e.to) && inView(S.nodes.get(e.from)) && inView(S.nodes.get(e.to));

function allEdges() {
  const removed = new Set(pending('remove-link').map((e) => `${e.from}>${e.to}>${e.label}`));
  const base = S.flow.edges
    .filter((e) => !removed.has(`${e.from}>${e.to}>${e.label}`))
    .map((e) => {
      const rt = pending('retarget').find((r) => r.from === e.from && r.to === e.to && r.label === e.label);
      const rl = pending('relabel').find((r) => r.from === e.from && r.to === e.to && r.oldLabel === e.label);
      return rt || rl ? { ...e, to: rt ? rt.newTo : e.to, label: rl ? rl.label : e.label, status: 'edited' } : e;
    });
  const proposed = pending('add-link').map((e, i) => ({
    id: 'p' + i, from: e.from, to: e.to, label: e.label || 'new', via: e.via || 'link', kind: 'proposed', status: 'proposed', file: null, line: null,
  }));
  return [...base, ...proposed];
}

/* ---------- sections (group backdrops, collapsible) ---------- */
const groupOf = (n) => n.group || 'root';
const groupId = (g) => `section:${g}`;
const isGroup = (n) => n.type === 'section';
const collapsedSet = () => new Set(view().collapsed || []);

function toggleSection(g) {
  const v = view();
  const set = new Set(v.collapsed || []);
  set.has(g) ? set.delete(g) : set.add(g);
  v.collapsed = [...set];
  if (S.sel && (S.sel === groupId(g) || S.nodes.get(S.sel)?.group === g)) { S.sel = null; $('#inspect').hidden = true; }
  saveViews();
}

// every page in a collapsed section renders as one card; its internal links fold away
function renderId(id) {
  const n = S.nodes.get(id);
  if (!n || n.type !== 'page') return id;
  const g = groupOf(n);
  return S.collapsed.has(g) && inView(n) ? groupId(g) : id;
}

// collapse links into what a card actually shows: one wire per neighbour for a
// collapsed directory, one per control otherwise
function fold(list) {
  const seenEdge = new Map();
  const edges = [];
  for (const e of list) {
    const from = renderId(e.from), to = renderId(e.to);
    if (from === to) continue;                       // link inside a collapsed section
    const folded = from !== e.from || to !== e.to;
    const k = folded ? `${from}>${to}` : `${from}>${to}>${e.label}`;
    const hit = seenEdge.get(k);
    if (hit) { hit.details.push(e); continue; }
    const edge = folded
      ? { ...e, from, to, folded: true, kind: 'folded', details: [e] }
      : { ...e, details: [e] };
    seenEdge.set(k, edge);
    edges.push(edge);
  }
  for (const e of edges) {
    if (!e.folded) continue;
    const n = e.details.length;
    e.label = n === 1 ? e.details[0].label : `${n} links`;
  }
  return edges;
}

function ioOf(edges) {
  const io = new Map();
  for (const n of S.nodes.values()) if (inView(n) && renderId(n.id) === n.id) io.set(n.id, { in: [], out: [] });
  for (const s of S.groups.values()) io.set(s.id, { in: [], out: [] });
  for (const e of edges) { io.get(e.from)?.out.push(e); io.get(e.to)?.in.push(e); }
  return io;
}

function recompute() {
  S.collapsed = collapsedSet();
  S.groups = new Map();
  for (const n of S.nodes.values()) {
    if (n.type !== 'page' || !inView(n)) continue;
    const g = groupOf(n);
    if (!S.collapsed.has(g)) continue;
    if (!S.groups.has(g)) S.groups.set(g, { id: groupId(g), label: g, title: `/${g}/`, type: 'section', group: g, members: [], file: null });
    S.groups.get(g).members.push(n);
  }

  const all = allEdges().filter((e) => S.nodes.has(e.from) && S.nodes.has(e.to)
    && inView(S.nodes.get(e.from)) && inView(S.nodes.get(e.to)));

  // Two sets, deliberately. S.edges / S.io are what is DRAWN, so the wires and
  // the port dots agree with each other. S.ioAll is what EXISTS in this view,
  // and every judgement comes from it: a page reachable only through the footer
  // is reachable, and calling it an orphan because the footer is folded away
  // would be the tool lying about the site.
  S.edges = fold(all.filter(visibleEdge));
  S.io = ioOf(S.edges);
  S.ioAll = ioOf(fold(all));

  const entry = entryNode();
  S.depth = new Map();
  if (entry) {
    S.depth.set(entry, 0);
    const q = [entry];
    while (q.length) {
      const cur = q.shift();
      for (const e of S.ioAll.get(cur)?.out || []) if (!S.depth.has(e.to)) { S.depth.set(e.to, S.depth.get(cur) + 1); q.push(e.to); }
    }
  }
  layout();
}

// everything that gets its own card: visible nodes not folded into a section,
// plus one card per collapsed section
const renderNodes = () => [
  ...[...S.nodes.values()].filter((n) => inView(n) && renderId(n.id) === n.id),
  ...S.groups.values(),
];

// where a visit starts: the site root if it is in this view, else the shallowest
// route, tie-broken by how many exits it has
function entryNode() {
  const vis = renderNodes().filter((n) => (n.type === 'page' || n.type === 'ghost' || isGroup(n)));
  if (!vis.length) return null;
  if (view().entry && vis.some((n) => n.id === view().entry)) return view().entry;
  if (vis.some((n) => n.id === '/')) return '/';
  const depth = (id) => id.split('/').filter(Boolean).length;
  const io = S.ioAll || S.io;
  return vis.slice().sort((a, b) => depth(a.id) - depth(b.id)
    || (io.get(b.id)?.out.length || 0) - (io.get(a.id)?.out.length || 0))[0].id;
}

/* ---------- layout ---------- */
function layout() {
  S.pos = new Map();
  const saved = S.flow.layout || {};
  const cols = new Map();
  const nodes = renderNodes();
  const depths = nodes.filter((n) => n.type === 'page' || n.type === 'ghost' || isGroup(n)).map((n) => S.depth.get(n.id) ?? -1);
  const maxDepth = Math.max(0, ...depths);
  for (const n of nodes) {
    const d = S.depth.get(n.id);
    let c;
    if (n.type === 'page' || n.type === 'ghost' || isGroup(n)) c = d == null ? maxDepth + 1 : d;
    else c = maxDepth + 3 + (n.type === 'external' ? 1 : 0);
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c).push(n);
  }
  S.colX = new Map();
  S.maxPageCol = maxDepth;
  let x = PAD;
  for (const c of [...cols.keys()].sort((a, b) => a - b)) {
    // section members sit next to each other so a section's backdrop stays tidy
    const list = cols.get(c).sort((a, b) => groupOf(a).localeCompare(groupOf(b))
      || (S.io.get(b.id)?.in.length || 0) - (S.io.get(a.id)?.in.length || 0) || a.id.localeCompare(b.id));
    S.colX.set(c, x);
    const subs = Math.max(1, Math.ceil(list.length / PER_COL));
    list.forEach((n, i) => {
      const small = (n.type !== 'page' && n.type !== 'ghost' && !isGroup(n));
      const sub = Math.floor(i / PER_COL), row = i % PER_COL;
      const p = saved[n.id] || { x: x + sub * (W + 60), y: PAD + row * (small ? 108 : ROW) };
      S.pos.set(n.id, { ...p, w: small ? WS : W, h: small ? HS : H, col: c });
    });
    x += subs * (W + 60) + COL - W - 20;
  }
}

/* ---------- render ---------- */
function render() {
  const host = $('#nodes'), wires = $('#wires');
  host.textContent = ''; wires.textContent = '';
  S.dom = new Map();

  drawColumns(wires);
  drawSections(host);
  for (const [id, p] of S.pos) host.appendChild(pageCard(nodeOf(id), p));
  drawWires();
  applyView();
  applyFilterDim();
  $('#empty').hidden = S.pos.size > 0;
}

const nodeOf = (id) => S.nodes.get(id) || S.groups.get(String(id).replace(/^section:/, ''));

// the drafting rule: one guide and one label per depth column
function drawColumns(wires) {
  const bounds = new Map();
  for (const [, p] of S.pos) {
    const b = bounds.get(p.col) || { top: 1e9, bottom: -1e9 };
    b.top = Math.min(b.top, p.y); b.bottom = Math.max(b.bottom, p.y + p.h);
    bounds.set(p.col, b);
  }
  const ordered = [...S.colX.entries()].sort((a, b) => a[0] - b[0]);
  for (const [c, b] of bounds) {
    const x = S.colX.get(c) ?? 0;
    const next = ordered.find(([cc]) => cc > c);
    const room = (next ? next[1] : x + 420) - x - 24;
    const sample = [...S.pos.entries()].find(([, p]) => p.col === c);
    const n = sample && nodeOf(sample[0]);
    const full = n && (n.type === 'api' || n.type === 'external') ? n.type.toUpperCase()
      : c > S.maxPageCol ? 'UNREACHABLE BY CLICKING'
        : c === 0 ? 'DEPTH 0 · ENTRY' : `DEPTH ${c}`;

    wires.appendChild(svgEl('line', { class: 'col-guide', x1: x - 22, y1: b.top - 52, x2: x - 22, y2: b.bottom + 12 }));
    const t = svgEl('text', { class: 'col-label', x, y: b.top - 58 });
    t.textContent = full;
    wires.appendChild(t);
    // measure, then trim until the label fits its own column
    let text = full;
    while (text.length > 4 && t.getComputedTextLength() > room) {
      text = text.slice(0, -2);
      t.textContent = text + '…';
    }
    if (text !== full) t.appendChild(svgEl('title')).textContent = full;
  }
}

// Backdrop behind a directory's pages. One box per vertical run of same-directory
// cards, so a box only ever contains that directory. A single box spanning a
// group's full bounding rectangle would swallow every unrelated card standing
// between its first and last page.
function drawSections(host) {
  const boxes = new Map();   // `${group}|${x}` -> box, one per column of cards
  const total = new Map();   // group -> how many of its pages are on screen
  for (const [id, p] of S.pos) {
    const n = nodeOf(id);
    if (!n || isGroup(n) || (n.type !== 'page' && n.type !== 'ghost')) continue;
    const g = groupOf(n);
    total.set(g, (total.get(g) || 0) + 1);
    const k = `${g}|${Math.round(p.x)}`;
    const b = boxes.get(k) || { g, x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9, n: 0 };
    b.x1 = Math.min(b.x1, p.x); b.y1 = Math.min(b.y1, p.y);
    b.x2 = Math.max(b.x2, p.x + p.w); b.y2 = Math.max(b.y2, p.y + p.h); b.n++;
    boxes.set(k, b);
  }
  const drawn = [...boxes.values()].filter((b) => b.n > 1);
  // only the leftmost, then topmost, box of a directory carries its label
  const labelBox = new Map();
  for (const b of drawn) {
    const cur = labelBox.get(b.g);
    if (!cur || b.x1 < cur.x1 || (b.x1 === cur.x1 && b.y1 < cur.y1)) labelBox.set(b.g, b);
  }

  for (const b of drawn) {
    const z = el('div', 'section');
    z.style.cssText = `left:${b.x1 - 16}px;top:${b.y1 - 42}px;width:${b.x2 - b.x1 + 32}px;height:${b.y2 - b.y1 + 58}px`;
    if (labelBox.get(b.g) === b) {
      const head = el('button', 'section-head');
      head.type = 'button';
      head.appendChild(icon('i-chev-down', 'icon'));
      head.appendChild(el('span', null, `/${b.g === 'root' ? '' : b.g + '/'}`));
      head.appendChild(el('span', 'k', `${total.get(b.g)} pages`));
      head.title = 'Collapse this directory into one card';
      head.onclick = (ev) => { ev.stopPropagation(); toggleSection(b.g); };
      z.appendChild(head);
    }
    host.appendChild(z);
  }
}

function pageCard(n, p) {
  const io = S.io.get(n.id) || { in: [], out: [] };            // drawn: ports must match wires
  const tot = S.ioAll.get(n.id) || io;                          // real: counts and tags
  if (isGroup(n)) return groupCard(n, p, io, tot);
  const d = el('div', `node kind-${n.type}`);
  d.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;--in:${Math.min(p.col * 40, 320)}ms`;
  d.dataset.id = n.id;
  d.tabIndex = 0;
  d.setAttribute('aria-label', `${n.id}, ${tot.in.length} entrances, ${tot.out.length} exits`);

  const h = el('div', 'node-head');
  h.appendChild(el('span', 'node-route', n.type === 'page' || n.type === 'ghost' ? (n.label || '/') : n.id));
  h.appendChild(el('span', 'node-badge', n.type === 'page' || n.type === 'ghost' ? `${tot.in.length} in · ${tot.out.length} out` : n.type));
  d.appendChild(h);

  if (n.type === 'page' || n.type === 'ghost') {
    const t = el('div', 'node-thumb');
    if (n.type === 'ghost') t.appendChild(el('div', 'ph', 'Proposed page'));
    else if (S.filters.preview) { t.appendChild(el('div', 'ph skeleton')); lazyPreview(t, n.id); }
    else t.appendChild(el('div', 'ph', n.id));
    d.appendChild(t);
    const f = el('div', 'node-foot');
    f.appendChild(el('span', null, n.id));
    if (!tot.in.length && n.id !== entryNode()) f.appendChild(el('span', 'tag warn', 'orphan'));
    if (!tot.out.length) f.appendChild(el('span', 'tag', 'dead end'));
    d.appendChild(f);
    d.appendChild(ports(io.in, 'in'));
    d.appendChild(ports(io.out, 'out'));
  }
  S.dom.set(n.id, d);
  return d;
}

function groupCard(n, p, io, tot) {
  const d = el('div', 'node is-group');
  d.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;--in:${Math.min(p.col * 40, 320)}ms`;
  d.dataset.id = n.id;
  d.tabIndex = 0;
  const h = el('div', 'node-head');
  h.appendChild(icon('i-chev-right', 'icon sm'));
  h.appendChild(el('span', 'node-route', `/${n.label}/`));
  h.appendChild(el('span', 'node-badge', `${tot.in.length} in · ${tot.out.length} out`));
  d.appendChild(h);

  const body = el('div', 'group-body');
  body.appendChild(el('span', 'group-count', String(n.members.length)));
  body.appendChild(el('span', 'muted', 'pages\ncollapsed'));
  const btn = el('button', 'btn sm', 'Expand');
  btn.type = 'button';
  btn.onclick = (ev) => { ev.stopPropagation(); toggleSection(n.group); };
  body.appendChild(btn);
  d.appendChild(body);

  const f = el('div', 'node-foot');
  f.appendChild(el('span', null, n.members.slice(0, 3).map((m) => m.label).join(', ') + (n.members.length > 3 ? '…' : '')));
  d.appendChild(f);
  d.appendChild(ports(io.in, 'in'));
  d.appendChild(ports(io.out, 'out'));
  S.dom.set(n.id, d);
  return d;
}

// Port geometry, mirrored from .ports / .port in style.css. A wire ends exactly
// on the dot that represents it, so the dots are the wire's real terminals
// rather than decoration beside them. Keep these three in sync with the CSS.
const PORT_TOP = 30, PORT_STEP = 14, PORT_R = 4.5, PORT_CAP = 7;
const PORTED = new Set(['page', 'ghost', 'section']);

// where on a card's edge this particular link attaches
function anchor(id, list, edge, side) {
  const p = S.pos.get(id);
  const n = nodeOf(id);
  const x = side === 'out' ? p.x + p.w : p.x;
  if (!n || !PORTED.has(n.type)) return { x, y: p.y + p.h / 2 };   // api/external cards show no ports
  const i = Math.max(0, list.indexOf(edge));
  // everything past the cap collapses onto the small "more" dot, exactly as drawn
  if (i >= PORT_CAP) return { x, y: p.y + PORT_TOP + PORT_CAP * PORT_STEP + 2.5 };
  return { x, y: p.y + PORT_TOP + i * PORT_STEP + PORT_R };
}

// the dots down each side of a card: entrances on the left, exits on the right
function ports(list, dir) {
  const wrap = el('div', 'ports ' + dir);
  for (const e of list.slice(0, 7)) {
    const dot = el('button', 'port ' + dir + (e.status === 'proposed' ? ' proposed' : ''));
    dot.type = 'button';
    dot.dataset.tip = `${dir === 'out' ? 'EXIT' : 'ENTRANCE'} · “${e.label}”\n${e.from} → ${e.to}\n${e.via}${e.file ? ` · ${e.file}:${e.line}` : ''}`;
    dot.dataset.go = dir === 'out' ? e.to : e.from;
    dot.dataset.wire = `${e.from}>${e.to}`;
    dot.setAttribute('aria-label', `${dir === 'out' ? 'Exit' : 'Entrance'}: ${e.label}, ${e.from} to ${e.to}`);
    wrap.appendChild(dot);
  }
  if (list.length > 7) {
    const more = el('i', 'port more ' + dir);
    more.dataset.tip = `${list.length - 7} more`;
    wrap.appendChild(more);
  }
  return wrap;
}

// Thumbnails are real pages: mount few, drop the ones scrolled away from.
// Without the cap the browser composites 40+ documents on every pan.
const MOUNT_CAP = 12;
const io_ = new IntersectionObserver((es) => {
  for (const e of es) {
    if (e.isIntersecting) enqueuePreview(e.target);
    else unmountPreview(e.target);
  }
}, { root: null, rootMargin: '150px' });

const Q = { list: [], live: 0, max: 2, mounted: [] };

function unmountPreview(t) {
  Q.list = Q.list.filter((x) => x !== t);
  const f = t.querySelector('iframe');
  if (!f) return;
  if (t._done) t._done();          // still loading: free its slot or the queue stalls
  f.remove();
  Q.mounted = Q.mounted.filter((x) => x !== t);
  if (!t.querySelector('.ph')) t.appendChild(el('div', 'ph', t.dataset.route));
}

function evict() {
  while (Q.mounted.length > MOUNT_CAP) unmountPreview(Q.mounted.shift());
}
const sandbox = () => (S.filters.js ? 'allow-scripts allow-same-origin' : '');
function lazyPreview(t, route) { t.dataset.route = route; io_.observe(t); }
function enqueuePreview(t) {
  if (t.querySelector('iframe') || Q.list.includes(t)) return;
  Q.list.push(t); pump();
}
function pump() {
  while (Q.live < Q.max && Q.list.length) {
    const t = Q.list.shift();
    if (!t.isConnected || t.querySelector('iframe')) continue;
    Q.live++;
    Q.mounted.push(t); evict();
    const f = el('iframe');
    f.setAttribute('sandbox', sandbox());
    f.setAttribute('title', `Preview of ${t.dataset.route}`);
    f.setAttribute('tabindex', '-1');
    f.src = '/site' + t.dataset.route;
    let settled = false;
    const done = () => { if (settled) return; settled = true; t._done = null; t.querySelector('.ph')?.remove(); Q.live--; setTimeout(pump, 60); };
    t._done = done;
    f.addEventListener('load', done, { once: true });
    f.addEventListener('error', done, { once: true });
    setTimeout(done, 8000); // never let one slow page stall the queue
    t.appendChild(f);
  }
}

let wireRaf = 0;
const queueWires = () => { if (!wireRaf) wireRaf = requestAnimationFrame(() => { wireRaf = 0; drawWires(); }); };

function drawWires() {
  const wires = $('#wires');
  for (const w of wires.querySelectorAll('.wire,.wlabel,.hit')) w.remove();
  if (!wires.querySelector('defs')) {
    const defs = svgEl('defs');
    const m = svgEl('marker', { id: 'ah', viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse' });
    m.appendChild(svgEl('path', { d: 'M0,0 L8,4 L0,8', fill: 'none', stroke: 'context-stroke', 'stroke-width': '1.6' }));
    defs.appendChild(m);
    // a form submit gets a bar terminal at its source, so kind stays readable
    // without spending another hue on it
    const fb = svgEl('marker', { id: 'fb', viewBox: '0 0 4 8', refX: '1', refY: '4', markerWidth: '4', markerHeight: '6', orient: 'auto' });
    fb.appendChild(svgEl('path', { d: 'M1,0 L1,8', fill: 'none', stroke: 'context-stroke', 'stroke-width': '2' }));
    defs.appendChild(fb);
    wires.appendChild(defs);
  }
  const seen = new Map();
  for (const e of S.edges) {
    const a = S.pos.get(e.from), b = S.pos.get(e.to);
    if (!a || !b) continue;
    const key = `${e.from}>${e.to}`;
    const n = seen.get(key) || 0; seen.set(key, n + 1);
    // start and end on the ports themselves; no synthetic fan-out offset is
    // needed because two links out of one page already own two different dots
    const A = anchor(e.from, S.io.get(e.from)?.out || [], e, 'out');
    const B = anchor(e.to, S.io.get(e.to)?.in || [], e, 'in');
    const x1 = A.x, y1 = A.y, x2 = B.x, y2 = B.y;
    const dx = Math.max(60, Math.abs(x2 - x1) * 0.45);
    const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    const data = { 'data-from': e.from, 'data-to': e.to, 'data-wire': key };
    const attrs = { class: `wire ${cls(e)}`, d, 'marker-end': 'url(#ah)', ...data };
    if (e.via === 'form') attrs['marker-start'] = 'url(#fb)';
    wires.appendChild(svgEl('path', attrs));
    // fat transparent path on top so the thin wire is actually hoverable
    const hit = svgEl('path', { class: 'hit', d, ...data });
    hit.dataset.tip = e.folded
      ? `${e.label}: ${clean(e.from)} → ${clean(e.to)}\n` + e.details.slice(0, 6).map((x) => `· “${x.label}”  ${x.from} → ${x.to}`).join('\n')
        + (e.details.length > 6 ? `\n· ${e.details.length - 6} more` : '')
      : `“${e.label}”\n${e.from} → ${e.to}\n${e.via} · ${e.kind}${e.file ? ` · ${e.file}:${e.line}` : ''}`;
    wires.appendChild(hit);
    if (n < 2) {
      const lab = svgEl('text', { class: 'wlabel', x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, 'text-anchor': 'middle', ...data });
      lab.textContent = trunc(e.label, 26);
      wires.appendChild(lab);
    }
  }
}

// hue = state, stroke style = kind
function cls(e) {
  const out = [];
  if (e.kind === 'proposed') out.push('proposed');
  else if (S.nodes.get(e.to)?.type === 'missing') out.push('dead');
  if (e.via === 'form') out.push('form');
  else if (/js/.test(e.kind)) out.push('js');
  if (e.via === 'redirect') out.push('redirect');
  return out.join(' ');
}

function applyView() {
  $('#canvas').style.transform = `translate(${S.cam.x}px,${S.cam.y}px) scale(${S.cam.k})`;
  // zoomed out, wire labels and thumbnails are unreadable anyway - drop them
  // from the render tree instead of compositing them
  $('#stage').dataset.detail = S.cam.k < 0.26 ? 'low' : 'high';
}

function applyFilterDim() {
  const q = S.q.toLowerCase();
  for (const [id, d] of S.dom) {
    const n = nodeOf(id);
    const hit = !q || id.toLowerCase().includes(q) || (n?.title || '').toLowerCase().includes(q);
    d.classList.toggle('dim', !hit);
    d.classList.toggle('sel', id === S.sel);
  }
  for (const w of $('#wires').querySelectorAll('.wire,.wlabel')) {
    const hot = S.sel && (w.dataset.from === S.sel || w.dataset.to === S.sel);
    w.classList.toggle('hot', !!hot);
    w.classList.toggle('faint', !!S.sel && !hot);
  }
}

/* ---------- rail ---------- */
function renderRail() {
  const pages = [...S.nodes.values()].filter((n) => inView(n) && n.type === 'page' && renderId(n.id) === n.id);
  const depths = pages.map((n) => S.depth.get(n.id)).filter((d) => d != null);
  const box = $('#stats'); box.textContent = '';
  const hiddenChrome = S.filters.shared ? 0 : allEdges().filter(sitewide).length;
  const rows = [
    ['View', view().label || S.mode],
    ['Pages', `${pages.length} of ${S.flow.nodes.filter((n) => n.type === 'page').length}`],
    ['Links drawn', hiddenChrome ? `${S.edges.length} of ${S.edges.length + hiddenChrome}` : String(S.edges.length)],
    ['Deepest', depths.length ? `${Math.max(...depths)} clicks` : '0 clicks'],
    ['Scanned', (S.flow.generatedAt || '').slice(0, 16).replace('T', ' ')],
  ];
  for (const [k, v] of rows) {
    const r = el('div', 'stat');
    r.appendChild(el('span', null, k));
    r.appendChild(el('b', null, String(v)));
    box.appendChild(r);
  }

  // ENTRY POINTS - where a visit can start
  const entry = entryNode();
  const ins = pages.filter((n) => n.id === entry || !(S.ioAll.get(n.id)?.in.length));
  $('#inCount').textContent = ins.length;
  fillList('#inputs', ins.map((n) => ({
    label: n.id, sub: n.id === entry ? 'front door' : 'direct URL only', go: n.id, warn: n.id !== entry,
  })), 'Nothing can start a visit in this view.');

  // LEAVES THE SITE - off-site links, API calls, and broken targets
  const outs = new Map();
  for (const e of S.edges) {
    const t = S.nodes.get(e.to);
    if (!t || (t.type !== 'external' && t.type !== 'api' && t.type !== 'missing')) continue;
    if (!outs.has(e.to)) outs.set(e.to, { n: 0, type: t.type });
    outs.get(e.to).n++;
  }
  const outRows = [...outs.entries()].sort((a, b) => b[1].n - a[1].n);
  $('#outCount').textContent = outRows.length;
  fillList('#outputs', outRows.map(([id, v]) => ({
    label: id, sub: `${v.type} · ${v.n} link${v.n > 1 ? 's' : ''}`, go: id, warn: v.type === 'missing',
  })), 'Nothing leaves the site in this view. Turn on API endpoints or external links under Layers.');

  renderExcluded();
  renderIssues(pages, entry);
}

function renderIssues(pages, entry) {
  const i = S.flow.issues || {};
  const shown = new Set(pages.map((n) => n.id));
  const box = $('#issues'); box.textContent = '';
  let count = 0;
  const add = (bad, title, sub, go) => {
    count++;
    const d = el('button', 'issue' + (bad ? ' bad' : ''));
    d.type = 'button';
    d.appendChild(icon(bad ? 'i-broken' : 'i-alert', 'icon sm'));
    d.appendChild(el('b', null, title));
    d.appendChild(el('small', null, sub));
    if (go) d.onclick = () => select(go);
    box.appendChild(d);
  };
  for (const d of (i.deadLinks || []).filter((d) => shown.has(d.from)).slice(0, 12)) {
    add(true, `Dead link to ${d.to}`, `${d.from} · “${d.label}”${d.file ? ` · ${d.file}:${d.line}` : ''}`, d.from);
  }
  for (const n of pages.filter((n) => !(S.ioAll.get(n.id)?.in.length) && n.id !== entry).slice(0, 10)) {
    add(false, `Orphan ${n.id}`, 'No inbound link, unreachable by clicking', n.id);
  }
  for (const n of pages.filter((n) => S.depth.get(n.id) == null && n.id !== entry).slice(0, 10)) {
    add(false, `Unreachable ${n.id}`, `Not reachable from ${entry}`, n.id);
  }
  for (const n of pages.filter((n) => (S.depth.get(n.id) ?? 0) > 3).slice(0, 8)) {
    add(false, `Deep ${n.id}`, `${S.depth.get(n.id)} clicks from the entry`, n.id);
  }
  for (const n of pages.filter((n) => !(S.ioAll.get(n.id)?.out.length)).slice(0, 8)) {
    add(false, `Dead end ${n.id}`, 'No way out, not even back', n.id);
  }
  for (const n of pages.filter((n) => (S.ioAll.get(n.id)?.out.length || 0) > 12).slice(0, 5)) {
    add(false, `Hub ${n.id}`, `${S.ioAll.get(n.id).out.length} exits, consider grouping`, n.id);
  }
  $('#issueCount').textContent = count || '';
  if (!count) {
    const ok = el('div', 'empty-note');
    ok.append('No dead links, orphans, or dead ends in this view.');
    box.appendChild(ok);
  }
}

// what this view leaves out: the rules first (removable), then the pages they hide
function renderExcluded() {
  const v = view();
  const box = $('#excluded'); box.textContent = '';
  const hidden = S.flow.nodes.filter((n) => n.type === 'page' && excluded(n.id));
  $('#exCount').textContent = hidden.length;
  $('#viewDelete').hidden = isBase(v);
  if (isBase(v)) {
    box.appendChild(el('div', 'empty-note', 'The base view always shows every page. Add a rule below, or press + on the view tabs, to start a filtered view of your own.'));
    return;
  }

  for (const kind of ['include', 'exclude']) {
    for (const pat of v[kind] || []) {
      const row = el('div', 'row rule');
      row.appendChild(el('span', 'k', kind === 'include' ? 'only' : 'hide'));
      row.appendChild(el('span', null, pat));
      const x = iconBtn('i-close', 'x', `Remove rule ${pat}`);
      x.onclick = () => { v[kind] = v[kind].filter((p) => p !== pat); saveViews(); };
      row.appendChild(x);
      box.appendChild(row);
    }
  }
  if (!hidden.length && !(v.include || []).length && !(v.exclude || []).length) {
    box.appendChild(el('div', 'empty-note', 'Nothing hidden. This view shows every page.'));
    return;
  }
  const cap = S.showAllExcluded ? hidden.length : 6;
  for (const n of hidden.slice(0, cap)) {
    const row = el('div', 'row gone');
    row.appendChild(el('span', null, n.id));
    const back = iconBtn('i-plus', 'x add', `Show ${n.id} in this view`);
    back.onclick = () => includeBack(n.id);
    row.appendChild(back);
    box.appendChild(row);
  }
  if (hidden.length > cap) {
    const more = el('button', 'btn sm', `Show ${hidden.length - cap} more`);
    more.type = 'button';
    more.onclick = () => { S.showAllExcluded = true; renderExcluded(); };
    box.appendChild(more);
  } else if (S.showAllExcluded && hidden.length > 6) {
    const less = el('button', 'btn sm', 'Show fewer');
    less.type = 'button';
    less.onclick = () => { S.showAllExcluded = false; renderExcluded(); };
    box.appendChild(less);
  }
}

// re-including one page: drop the rules that hit it, and if an `only` list is
// in force, add the page to it
function includeBack(id, defer) {
  const v = view();
  v.exclude = (v.exclude || []).filter((p) => !matches(id, p));
  if (v.include?.length && !v.include.some((p) => matches(id, p))) v.include.push(id);
  if (!defer) saveViews();
}

function fillList(sel, rows, emptyMsg) {
  const box = $(sel); box.textContent = '';
  if (!rows.length) { box.appendChild(el('div', 'empty-note', emptyMsg)); return; }
  for (const r of rows) {
    const d = el('div', 'row' + (r.warn ? ' warn' : ''));
    d.appendChild(el('span', null, r.label));
    d.appendChild(el('span', 'k', r.sub));
    if (r.go && S.pos.has(r.go)) { d.dataset.go = r.go; d.onclick = () => select(r.go); }
    box.appendChild(d);
  }
}

/* ---------- inspector ---------- */
function select(id, keepScroll) {
  S.sel = id;
  const n = nodeOf(id);
  const ins = $('#inspect');
  if (!n || !S.pos.has(id)) { ins.hidden = true; S.sel = null; applyFilterDim(); return; }
  ins.hidden = false;
  const grouped = isGroup(n);
  $('#insTitle').textContent = grouped ? `${clean(n.id)} section` : (n.title || n.label || id);
  $('#insRoute').textContent = grouped ? `${n.members.length} pages collapsed` : id;
  $('#insFile').textContent = grouped ? '' : (n.file || '');
  $('#openTab').href = grouped ? '/site/' + (n.label === 'root' ? '' : n.label + '/') : '/site' + id;
  $('.devices').hidden = grouped;
  $('.preview-wrap').hidden = grouped;
  $('.viewctl').hidden = grouped;
  if (grouped) renderGroupMembers(n);
  else { $('#members')?.remove(); setPreview(id, Number(document.querySelector('.devices .on')?.dataset.w || 1280)); }

  // the inspector is an editing surface, so it lists every link on the page,
  // including the site-wide ones folded out of the drawing
  const io = S.ioAll.get(id) || { in: [], out: [] };
  $('#exitCount').textContent = io.out.length;
  $('#entCount').textContent = io.in.length;

  const exits = $('#exits'); exits.textContent = '';
  if (!io.out.length) exits.appendChild(el('div', 'empty-note', 'Dead end. Nothing on this page navigates anywhere.'));
  for (const e of io.out) exits.appendChild(exitRow(e));
  for (const r of pending('remove-link').filter((r) => r.from === id)) {
    const row = el('div', 'row gone');
    row.appendChild(el('span', null, `${r.label} → ${r.to}`));
    row.appendChild(el('span', 'k', 'queued delete'));
    exits.appendChild(row);
  }

  const ent = $('#entrances'); ent.textContent = '';
  if (!io.in.length) ent.appendChild(el('div', 'empty-note', 'Orphan. Nothing links here, so it is reachable only by typing the URL.'));
  for (const e of io.in) {
    const row = el('div', 'row');
    row.dataset.go = e.from;
    row.onclick = () => select(e.from);
    row.appendChild(el('span', null, clean(e.from)));
    row.appendChild(el('span', 'k', `“${trunc(e.label, 18)}” · ${e.via}${e.line ? ':' + e.line : ''}`));
    ent.appendChild(row);
  }

  $('#note').value = (S.flow.notes || {})[id] || '';
  applyFilterDim();
  if (!keepScroll) centerOn(id);
}

function renderGroupMembers(n) {
  $('#members')?.remove();
  const box = el('div', 'rows'); box.id = 'members';
  const btn = el('button', 'btn sm', 'Expand section');
  btn.type = 'button';
  btn.onclick = () => toggleSection(n.group);
  box.appendChild(btn);
  for (const m of n.members) {
    const row = el('div', 'row');
    row.dataset.go = m.id;
    row.appendChild(el('span', null, m.id));
    row.appendChild(el('span', 'k', m.title || ''));
    row.onclick = () => { toggleSection(n.group); setTimeout(() => select(m.id), 60); };
    box.appendChild(row);
  }
  $('.preview-wrap').after(box);
}

function exitRow(e) {
  if (e.folded || String(e.from).startsWith('section:') || String(e.to).startsWith('section:')) {
    const row = el('div', 'row');
    row.appendChild(el('span', null, `${e.label} → ${clean(e.to)}`));
    row.appendChild(el('span', 'k', 'expand to edit'));
    row.title = (e.details || []).map((x) => `“${x.label}”  ${x.from} → ${x.to}`).join('\n');
    row.addEventListener('mouseenter', () => hotWire(`${e.from}>${e.to}`, true));
    row.addEventListener('mouseleave', () => hotWire(`${e.from}>${e.to}`, false));
    return row;
  }
  const row = el('div', 'row' + (e.status === 'proposed' ? ' pending' : ''));
  const label = el('input');
  label.value = e.label;
  label.title = 'Button or link text';
  label.setAttribute('aria-label', `Text of the link to ${e.to}`);
  const sel = el('select');
  sel.setAttribute('aria-label', `Destination of “${e.label}”`);
  for (const n of [...S.nodes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const o = el('option', null, n.id); o.value = n.id; if (n.id === e.to) o.selected = true; sel.appendChild(o);
  }
  const k = el('span', 'k', e.status === 'proposed' ? 'queued' : `${e.via}${e.line ? ':' + e.line : ''}`);
  const x = iconBtn('i-close', 'x', `Remove “${e.label}”`);
  label.onchange = () => queue({ op: 'relabel', from: e.from, to: e.to, oldLabel: e.label, label: label.value, file: e.file, line: e.line, summary: `Rename “${e.label}” to “${label.value}” on ${e.from}` });
  sel.onchange = () => queue({ op: 'retarget', from: e.from, to: e.to, newTo: sel.value, label: e.label, file: e.file, line: e.line, summary: `“${e.label}” on ${e.from}: ${e.to} becomes ${sel.value}` });
  x.onclick = () => {
    if (e.status === 'proposed') return unqueueAddLink(e);
    queue({ op: 'remove-link', from: e.from, to: e.to, label: e.label, file: e.file, line: e.line, summary: `Remove “${e.label}” (${e.from} to ${e.to})` });
  };
  row.addEventListener('mouseenter', () => hotWire(`${e.from}>${e.to}`, true));
  row.addEventListener('mouseleave', () => hotWire(`${e.from}>${e.to}`, false));
  row.append(label, sel, k, x);
  return row;
}

function setPreview(id, w) {
  const f = $('#preview'), wrap = $('.preview-wrap');
  f.style.width = w + 'px';
  const scale = (wrap.clientWidth || 380) / w;
  f.style.transform = `scale(${scale})`;
  f.style.height = Math.ceil(236 / scale) + 'px';
  const src = '/site' + id;
  const key = src + w + sandbox();
  if (f.dataset.src !== key) { f.setAttribute('sandbox', sandbox()); f.src = src; f.dataset.src = key; }
}

/* ---------- change queue ---------- */
async function queue(edit) {
  await fetch('/api/edits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(edit) });
  toast(`Queued: ${edit.summary}`);
  await reload();
}
async function unqueue(id) { await fetch('/api/edits?id=' + encodeURIComponent(id), { method: 'DELETE' }); await reload(); }
function unqueueAddLink(e) {
  const m = pending('add-link').find((p) => p.from === e.from && p.to === e.to && (p.label || 'new') === e.label);
  if (m) unqueue(m.id);
}

function renderEdits() {
  const list = pending();
  $('#editCount').textContent = String(list.length);
  const box = $('#editList'); box.textContent = '';
  if (!list.length) {
    box.appendChild(el('div', 'empty-note', 'Nothing queued yet. Rename an exit, change where it points, add a link between two pages, or add a page. Nothing is written to your site until you ask an agent to apply it.'));
    return;
  }
  for (const e of list) {
    const row = el('div', 'row pending');
    row.appendChild(el('span', 'op', e.op));
    row.appendChild(el('span', 'grow', e.summary || JSON.stringify(e)));
    const x = iconBtn('i-close', 'x', 'Discard this change');
    x.onclick = () => unqueue(e.id);
    row.appendChild(x);
    box.appendChild(row);
  }
}

/* ---------- hover tooltip ---------- */
function showTip(text, ev) {
  const t = $('#tip');
  t.hidden = false;
  t.textContent = text;
  moveTip(ev);
}
function moveTip(ev) {
  const t = $('#tip');
  if (t.hidden) return;
  const r = t.getBoundingClientRect();
  t.style.left = Math.min(ev.clientX + 14, innerWidth - r.width - 12) + 'px';
  t.style.top = Math.min(ev.clientY + 16, innerHeight - r.height - 12) + 'px';
}
const hideTip = () => { $('#tip').hidden = true; };

function hotWire(key, on) {
  for (const w of $('#wires').querySelectorAll(`[data-wire="${CSS.escape(key)}"]`)) w.classList.toggle('trace', on);
  $('#wires').classList.toggle('tracing', on);
}

/* ---------- theme ---------- */
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode) root.dataset.theme = mode; else delete root.dataset.theme;
  const dark = mode ? mode === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#themeIcon').firstElementChild.setAttribute('href', dark ? '#i-sun' : '#i-moon');
  $('#btnTheme').title = dark ? 'Switch to light' : 'Switch to dark';
  $('#btnTheme').setAttribute('aria-label', $('#btnTheme').title);
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
  applyTheme(next);
  drawWires();   // wire strokes read from CSS variables that just changed
}

/* ---------- interactions ---------- */
function wireUI() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* private mode */ }
  applyTheme(saved === 'light' || saved === 'dark' ? saved : null);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!document.documentElement.dataset.theme) applyTheme(null);
  });
  $('#btnTheme').onclick = toggleTheme;

  const stage = $('#stage');

  let panning = null;
  stage.addEventListener('pointerdown', (ev) => {
    const card = ev.target.closest('.node');
    if (card && !ev.target.closest('.port,button')) return startDrag(ev, card);
    if (card) return;
    panning = { x: ev.clientX, y: ev.clientY, vx: S.cam.x, vy: S.cam.y };
    stage.classList.add('panning'); stage.setPointerCapture(ev.pointerId);
  });
  stage.addEventListener('pointermove', (ev) => {
    if (!panning) return;
    S.cam.x = panning.vx + (ev.clientX - panning.x);
    S.cam.y = panning.vy + (ev.clientY - panning.y);
    applyView();
  });
  stage.addEventListener('pointerup', () => { panning = null; stage.classList.remove('panning'); });
  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const k = Math.min(2, Math.max(0.15, S.cam.k * (ev.deltaY < 0 ? 1.12 : 0.89)));
    const r = stage.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    S.cam.x = mx - (mx - S.cam.x) * (k / S.cam.k);
    S.cam.y = my - (my - S.cam.y) * (k / S.cam.k);
    S.cam.k = k; applyView();
  }, { passive: false });

  // hover a wire or a port -> tooltip + trace
  stage.addEventListener('mouseover', (ev) => {
    const t = ev.target.closest('.hit,.port');
    if (!t || !t.dataset.tip) return;
    showTip(t.dataset.tip, ev);
    if (t.dataset.wire) hotWire(t.dataset.wire, true);
  });
  stage.addEventListener('mousemove', (ev) => moveTip(ev));
  stage.addEventListener('mouseout', (ev) => {
    const t = ev.target.closest('.hit,.port');
    if (!t) return;
    hideTip();
    if (t.dataset.wire) hotWire(t.dataset.wire, false);
  });

  stage.addEventListener('click', (ev) => {
    const port = ev.target.closest('.port');
    if (port && port.dataset.go) { hideTip(); return select(port.dataset.go); }
    const hit = ev.target.closest('.hit');
    if (hit) return select(hit.dataset.from, true);
    const card = ev.target.closest('.node');
    if (!card) return;
    if (S.linkFrom) return finishLink(card.dataset.id);
    select(card.dataset.id, true);
  });
  stage.addEventListener('keydown', (ev) => {
    const card = ev.target.closest?.('.node');
    if (!card || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    if (S.linkFrom) return finishLink(card.dataset.id);
    select(card.dataset.id, true);
  });

  $('#tabs').onclick = (ev) => {
    const b = ev.target.closest('.tab'); if (!b) return;
    if (b.dataset.add) return promptNewView();
    S.mode = b.dataset.view;
    S.sel = null; $('#inspect').hidden = true;
    renderTabs(); recompute(); render(); renderRail(); fit();
    S.cfg.active = S.mode;
    fetch('/api/views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(S.cfg) });
  };

  const addRule = (kind) => {
    const pat = $('#ruleInput').value.trim();
    if (!pat) return toast('Type a route pattern first, for example /docs/**');
    $('#ruleInput').value = '';
    addExcludeRule(pat, kind);
  };
  $('#ruleAdd').onclick = () => addRule('exclude');
  $('#ruleAddIn').onclick = () => addRule('include');
  $('#ruleInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRule('exclude'); } });
  $('#viewDelete').onclick = () => deleteView();

  $('#exPage').onclick = () => {
    if (!S.sel) return;
    const pat = S.sel;
    S.sel = null; $('#inspect').hidden = true;
    addExcludeRule(pat);
  };
  $('#exGroup').onclick = () => {
    if (!S.sel) return;
    const seg = S.sel.split('/').filter(Boolean)[0];
    if (!seg) return toast('The root page is not inside a directory.');
    S.sel = null; $('#inspect').hidden = true;
    addExcludeRule(`/${seg}/**`);
  };

  $('.zoom').onclick = (ev) => {
    const b = ev.target.closest('[data-z]'); if (!b) return;
    const z = b.dataset.z;
    if (z === '0') return fit();
    S.cam.k = Math.min(2, Math.max(0.15, S.cam.k * (z === '+' ? 1.2 : 0.83))); applyView();
  };

  $('#search').addEventListener('input', (e) => { S.q = e.target.value; applyFilterDim(); });

  const layers = $('#layers'), layersBtn = $('#btnLayers');
  const closeLayers = () => { layers.hidden = true; layersBtn.setAttribute('aria-expanded', 'false'); };
  layersBtn.onclick = (ev) => {
    ev.stopPropagation();
    layers.hidden = !layers.hidden;
    layersBtn.setAttribute('aria-expanded', String(!layers.hidden));
  };
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.pop-wrap')) closeLayers(); });
  for (const [id, key] of [['fShared', 'shared'], ['fApi', 'api'], ['fExt', 'ext'], ['fPreview', 'preview'], ['fJs', 'js']]) {
    $('#' + id).addEventListener('change', (e) => {
      S.filters[key] = e.target.checked;
      if (key === 'js' && e.target.checked) toast('Page JavaScript is on. Heavy pages can stall the map, so turn it back off if this gets slow.');
      recompute(); render(); renderRail(); renderLayerCount();
      if (S.sel) select(S.sel, true);
    });
  }
  renderLayerCount();

  $('#btnRescan').onclick = async () => {
    const b = $('#btnRescan');
    b.disabled = true;
    toast('Rescanning…', true);
    try {
      const r = await fetch('/api/rescan', { method: 'POST' }).then((x) => x.json());
      await reload();
      toast(r.ok ? 'Rescanned' : 'Rescan failed. Check the terminal running sitelines.');
    } catch {
      toast('Rescan failed. Is sitelines still running?');
    } finally {
      b.disabled = false;
    }
  };

  const drawer = $('#drawer');
  const setDrawer = (open) => { drawer.hidden = !open; $('#btnEdits').setAttribute('aria-expanded', String(open)); if (open) renderEdits(); };
  $('#btnEdits').onclick = () => setDrawer(drawer.hidden);
  $('#drawerClose').onclick = () => setDrawer(false);
  $('#copyPrompt').onclick = async () => {
    const list = pending();
    if (!list.length) return toast('Nothing queued to copy.');
    const txt = 'Apply my sitelines changes (.sitelines/edits.json):\n' + list.map((e) => `- [${e.op}] ${e.summary}`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Prompt copied'); }
    catch { toast('Could not reach the clipboard. Open .sitelines/edits.json instead.'); }
  };

  $('#insClose').onclick = () => { $('#inspect').hidden = true; S.sel = null; applyFilterDim(); };
  $('#addExit').onclick = () => startLink(S.sel);
  $('#delPage').onclick = async () => {
    const n = S.nodes.get(S.sel); if (!n) return;
    const v = await modal('Delete page', [{ name: 'confirm', label: `Type ${n.id} to confirm. This queues a change; nothing is deleted until an agent applies it.`, value: '' }], 'Queue deletion');
    if (!v || v.confirm.trim() !== n.id) return toast('Cancelled');
    queue({ op: 'delete-page', route: n.id, file: n.file, summary: `Delete page ${n.id} (${n.file || 'no file'}) and every link to it` });
  };
  $('#btnAdd').onclick = async () => {
    const v = await modal('New page', [
      { name: 'route', label: 'Route, for example /pricing/', value: '/' },
      { name: 'label', label: 'Page title', value: '' },
      { name: 'from', label: 'Linked from (optional route)', value: S.sel || '' },
      { name: 'trigger', label: 'Button text on that page', value: '' },
    ], 'Queue page');
    if (!v || !v.route) return;
    await queue({ op: 'add-page', route: v.route, label: v.label, summary: `New page ${v.route}${v.label ? ` - “${v.label}”` : ''}` });
    if (v.from) await queue({ op: 'add-link', from: v.from, to: v.route, label: v.trigger || v.label || v.route, via: 'link', summary: `Add “${v.trigger || v.label}” on ${v.from} to ${v.route}` });
  };
  $('#note').addEventListener('change', async (e) => {
    const notes = { ...(S.flow.notes || {}), [S.sel]: e.target.value };
    await fetch('/api/layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notes }) });
    S.flow.notes = notes;
  });
  $('.devices').onclick = (ev) => {
    const b = ev.target.closest('[data-w]'); if (!b || !b.dataset.w) return;
    for (const x of document.querySelectorAll('.devices .btn')) x.classList.remove('on');
    b.classList.add('on'); setPreview(S.sel, Number(b.dataset.w));
  };

  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches('input,textarea,select')) { if (ev.key === 'Escape') ev.target.blur(); return; }
    if (ev.key === '/') { ev.preventDefault(); $('#search').focus(); }
    if (ev.key === 'Escape') {
      S.linkFrom = null; $('#stage').classList.remove('linking');
      if (!$('#modal').hidden) $('#modalCancel').click();
      setDrawer(false); closeLayers(); hideTip(); toast('');
    }
    if (ev.key === 'e' && S.sel) startLink(S.sel);
    if (ev.key === 'f') fit();
    if (['1', '2', '3', '4', '5'].includes(ev.key)) document.querySelectorAll('.tab')[Number(ev.key) - 1]?.click();
  });
}

function startDrag(ev, card) {
  const id = card.dataset.id, p = S.pos.get(id);
  const start = { x: ev.clientX, y: ev.clientY, px: p.x, py: p.y };
  let moved = false;
  card.setPointerCapture(ev.pointerId);
  const move = (e) => {
    const dx = (e.clientX - start.x) / S.cam.k, dy = (e.clientY - start.y) / S.cam.k;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    p.x = start.px + dx; p.y = start.py + dy;
    card.style.left = p.x + 'px'; card.style.top = p.y + 'px';
    queueWires();
  };
  const up = () => {
    card.removeEventListener('pointermove', move);
    card.removeEventListener('pointerup', up);
    if (!moved) return;
    const layout_ = { [id]: { x: Math.round(p.x), y: Math.round(p.y) } };
    S.flow.layout = { ...S.flow.layout, ...layout_ };
    fetch('/api/layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: layout_ }) });
  };
  card.addEventListener('pointermove', move);
  card.addEventListener('pointerup', up);
}

function startLink(from) {
  if (!from) return;
  S.linkFrom = from;
  $('#stage').classList.add('linking');
  toast(`Click the destination page for a new link from ${from}. Escape cancels.`, true);
}

async function finishLink(to) {
  const from = S.linkFrom;
  S.linkFrom = null; $('#stage').classList.remove('linking');
  toast('');
  if (!from || from === to) return;
  const v = await modal('New link', [
    { name: 'label', label: `Button or link text on ${from}`, value: '' },
    { name: 'via', label: 'Kind', type: 'select', options: ['link', 'button', 'redirect', 'form'], value: 'link' },
    { name: 'where', label: 'Where on the page (optional)', value: '' },
  ], 'Queue link');
  if (!v) return;
  queue({ op: 'add-link', from, to, label: v.label || to, via: v.via, where: v.where, summary: `Add ${v.via} “${v.label || to}” on ${from} to ${to}${v.where ? ` (${v.where})` : ''}` });
}

/* ---------- misc ui ---------- */
function modal(title, fields, okLabel) {
  return new Promise((resolve) => {
    const m = $('#modal'), body = $('#modalBody');
    $('#modalTitle').textContent = title;
    $('#modalOk').textContent = okLabel || 'Confirm';
    body.textContent = ''; m.hidden = false;
    const inputs = {};
    for (const f of fields) {
      const l = el('label', null, f.label);
      let inp;
      if (f.type === 'select') { inp = el('select'); for (const o of f.options) { const op = el('option', null, o); op.value = o; inp.appendChild(op); } }
      else inp = el('input');
      inp.value = f.value ?? '';
      l.appendChild(inp); body.appendChild(l); inputs[f.name] = inp;
    }
    const first = body.querySelector('input,select');
    first?.focus();
    first?.select?.();
    const done = (v) => { m.hidden = true; $('#modalForm').onsubmit = null; resolve(v); };
    $('#modalForm').onsubmit = (e) => { e.preventDefault(); done(Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]))); };
    $('#modalCancel').onclick = () => done(null);
  });
}

function toast(msg, sticky) {
  const h = $('#toast');
  h.textContent = msg; h.classList.toggle('show', !!msg);
  clearTimeout(toast.t);
  if (msg && !sticky) toast.t = setTimeout(() => h.classList.remove('show'), 3200);
}

function centerOn(id) {
  const p = S.pos.get(id); if (!p) return;
  const r = $('#stage').getBoundingClientRect();
  S.cam.x = r.width / 2 - (p.x + p.w / 2) * S.cam.k;
  S.cam.y = r.height / 2 - (p.y + p.h / 2) * S.cam.k;
  applyView();
}

function fit() {
  const xs = [...S.pos.values()];
  if (!xs.length) return;
  const maxX = Math.max(...xs.map((p) => p.x + p.w)), maxY = Math.max(...xs.map((p) => p.y + p.h));
  const r = $('#stage').getBoundingClientRect();
  S.cam.k = Math.min(1, Math.max(0.3, Math.min((r.width - 40) / (maxX + 40), (r.height - 40) / (maxY + 40))));
  S.cam.x = 20; S.cam.y = 30 * S.cam.k;
  applyView();
}

const trunc = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));

// the scan root is stored relative to wherever the scan ran, which can be a
// ../../.. chain that tells the reader nothing. Show the tail that does.
function shortRoot(root) {
  if (!root || root === '.') return '';
  const seg = String(root).split('/').filter((s) => s && s !== '.' && s !== '..');
  if (!seg.length) return '';
  return (seg.length > 2 ? '…/' : '') + seg.slice(-2).join('/') + '/';
}
// "section:admin" reads as "/admin/" everywhere it is shown to a human
const clean = (id) => String(id).startsWith('section:')
  ? `/${String(id).slice(8) === 'root' ? '' : String(id).slice(8) + '/'}` : String(id);
