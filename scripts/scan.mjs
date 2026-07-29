#!/usr/bin/env node
// sitelines scanner - builds .sitelines/flow.json (pages, navigation links, issues)
// Usage: node scan.mjs [--root public] [--out .sitelines] [--base http://localhost:8788]
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.sitelines', 'dist', 'build', 'out', 'coverage', 'vendor',
  '.next', '.nuxt', '.output', '.svelte-kit', '.astro', '.cache', '.turbo', '.parcel-cache',
  '.vercel', '.netlify', '.wrangler', 'target', 'tmp',
]);
const ROOT_CANDIDATES = ['public', 'site', 'www', 'static', 'src/pages', 'src/routes', 'src/app', 'app/pages', 'pages', 'app', 'docs', '.'];

const args = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const root = path.resolve(cwd, args.root || detectRoot(cwd));
const outDir = path.resolve(cwd, args.out || '.sitelines');
const flowPath = path.join(outDir, 'flow.json');
const base = args.base || '';
let ROUTES = null;

function main() {
  if (!fs.existsSync(root)) die(`root not found: ${root}`);
  const files = walk(root);
  const htmlFiles = files.filter((f) => /\.html?$/i.test(f));
  const jsFiles = files.filter((f) => /\.(m|c)?jsx?$|\.tsx?$/i.test(f));

  const pages = htmlFiles.length
    ? htmlFiles.map((f) => makeNode(f, 'page'))
    : jsFiles.filter(isFrameworkPage).map((f) => makeNode(f, 'page'));

  const byRoute = new Map(pages.map((n) => [n.id, n]));
  ROUTES = new Set(pages.map((n) => n.id));

  // which pages include which scripts
  const includedBy = new Map(); // absFile -> Set(route)
  const edges = [];
  const extra = new Map(); // synthetic nodes (api/external/missing)

  for (const page of pages) {
    const abs = path.join(root, page.file);
    let text = '';
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    page.bytes = Buffer.byteLength(text);
    page.title = titleOf(text) || page.label;

    for (const raw of scanHtml(text)) push(page.id, raw);

    // inline <script> bodies
    for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const src = attr(m[1], 'src');
      if (src) {
        const target = resolveFile(src, page.id);
        if (target) {
          if (!includedBy.has(target)) includedBy.set(target, new Set());
          includedBy.get(target).add(page.id);
        }
        continue;
      }
      const off = m.index + m[0].indexOf(m[2]);
      for (const raw of scanJs(m[2], page.file)) {
        push(page.id, { ...raw, line: lineAt(text, off + raw.offset), kind: 'js-inline' });
      }
    }
  }

  // shared / per-page JS files
  for (const [absFile, routes] of includedBy) {
    let text = '';
    try { text = fs.readFileSync(absFile, 'utf8'); } catch { continue; }
    const rel = posix(path.relative(root, absFile));
    const shared = routes.size > 4;
    for (const raw of scanJs(text, rel)) {
      const line = lineAt(text, raw.offset);
      for (const route of routes) push(route, { ...raw, file: rel, line, kind: shared ? 'js-shared' : 'js' });
    }
  }

  function push(from, raw) {
    const t = resolveTarget(raw.href, from);
    if (!t) return;
    if (t.type !== 'page' && !extra.has(t.id) && !byRoute.has(t.id)) {
      extra.set(t.id, { id: t.id, label: t.label, title: t.label, file: null, group: t.type, type: t.type, bytes: 0 });
    }
    edges.push({
      id: `${from}|${t.id}|${raw.trigger}|${edges.length}`,
      from, to: t.id,
      label: raw.trigger || 'link',
      via: raw.via || 'link',
      kind: raw.kind || 'html',
      file: raw.file || byRoute.get(from)?.file || null,
      line: raw.line || null,
      status: 'code',
    });
  }

  const nodes = [...pages, ...extra.values()];
  dedupeEdges(edges);
  markRepeated(edges);
  const flow = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: posix(path.relative(cwd, root)) || '.',
    base,
    nodes, edges,
    layout: {},
    notes: {},
  };
  analyze(flow);
  mergePrevious(flow);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(flowPath, JSON.stringify(flow, null, 2));
  const issues = flow.issues;
  console.log(`sitelines: ${flow.nodes.length} nodes, ${flow.edges.length} links -> ${posix(path.relative(cwd, flowPath))}`);
  console.log(`issues: ${issues.deadLinks.length} dead links, ${issues.orphans.length} orphans, ${issues.deadEnds.length} dead ends, ${issues.deep.length} deep (>3), ${issues.hubs.length} hubs`);
}

/* ---------- discovery ---------- */

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.well-known') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, acc); }
    else acc.push(p);
  }
  return acc;
}

function detectRoot(base_) {
  for (const c of ROOT_CANDIDATES) {
    const p = path.join(base_, c);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return c;
  }
  return '.';
}

function isFrameworkPage(f) {
  const r = posix(f);
  return /\/(pages|routes|app)\//.test(r) && !/\.(test|spec|d)\./.test(r) && !/\/(components|lib|utils)\//.test(r);
}

function makeNode(abs, type) {
  const rel = posix(path.relative(root, abs));
  const id = routeOf(rel);
  const seg = id.split('/').filter(Boolean);
  return {
    id,
    label: seg.length ? seg[seg.length - 1] : 'home',
    title: '',
    file: rel,
    group: seg[0] || 'root',
    type,
    bytes: 0,
  };
}

function routeOf(rel) {
  const b = path.posix.basename(rel);
  const d = path.posix.dirname(rel);
  if (/^index\.html?$/i.test(b) || /^(index|page|\+page)\.(jsx?|tsx?|svelte|vue)$/i.test(b)) {
    return d === '.' ? '/' : `/${d}/`;
  }
  return `/${rel}`;
}

/* ---------- HTML link extraction ---------- */

function scanHtml(text) {
  const out = [];
  for (const m of text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], 'href');
    if (!href) continue;
    out.push({ href, trigger: label(m[2]) || href, via: 'link', kind: 'html', line: lineAt(text, m.index) });
  }
  for (const m of text.matchAll(/<(button|div|li|span|img)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const a = m[2];
    const href = attr(a, 'data-href') || attr(a, 'data-nav') || attr(a, 'formaction') || hrefFromOnclick(attr(a, 'onclick'));
    if (!href) continue;
    out.push({ href, trigger: label(m[3]) || attr(a, 'aria-label') || attr(a, 'id') || 'button', via: 'button', kind: 'html', line: lineAt(text, m.index) });
  }
  for (const m of text.matchAll(/<form\b([^>]*)>/gi)) {
    const action = attr(m[1], 'action');
    if (!action) continue;
    out.push({ href: action, trigger: `${(attr(m[1], 'method') || 'get').toUpperCase()} form`, via: 'form', kind: 'html', line: lineAt(text, m.index) });
  }
  for (const m of text.matchAll(/<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^;]*;\s*url=([^"']+)["']/gi)) {
    out.push({ href: m[1], trigger: 'meta refresh', via: 'redirect', kind: 'html', line: lineAt(text, m.index) });
  }
  return out;
}

function hrefFromOnclick(v) {
  if (!v) return null;
  const m = v.match(/location\.(?:href|assign|replace)\s*(?:=|\()\s*['"]([^'"]+)/);
  return m ? m[1] : null;
}

/* ---------- JS link extraction ---------- */

const JS_PATTERNS = [
  [/location\s*\.\s*(?:href|assign|replace)\s*(?:=|\(\s*)\s*(['"`])([^'"`\n]{1,120})\1/g, 'redirect'],
  [/window\.open\(\s*(['"`])([^'"`\n]{1,120})\1/g, 'new tab'],
  [/(?:router\.(?:push|replace)|navigate|goto|redirect)\(\s*(['"`])([^'"`\n]{1,120})\1/g, 'route'],
  [/href\s*=\s*\\?["'`]([^"'`\\\n$]{1,120})["'`]/g, 'link'],
];

function scanJs(text, file) {
  const out = [];
  for (const [re, via] of JS_PATTERNS) {
    const capture = re.source.startsWith('href') ? 1 : 2;
    for (const m of text.matchAll(re)) {
      const href = m[capture];
      if (!href || href.includes('${')) continue;
      if (!/^([./#]|https?:|\w[\w-]*\/)/.test(href) && !href.startsWith('/')) continue;
      out.push({ href, trigger: triggerNear(text, m.index) || via, via, offset: m.index, file });
    }
  }
  return out;
}

// look backwards for the control that fires this navigation
function triggerNear(text, idx) {
  const win = text.slice(Math.max(0, idx - 600), idx);
  const pats = [
    /(?:getElementById|querySelector(?:All)?)\(\s*['"`]([^'"`]{1,40})['"`]/g,
    /\bid\s*[:=]\s*['"`]([^'"`]{1,40})['"`]/g,
    /textContent\s*=\s*['"`]([^'"`]{1,40})['"`]/g,
  ];
  let best = null;
  for (const p of pats) for (const m of win.matchAll(p)) best = m[1];
  if (!best) return null;
  return best.replace(/^[#.]/, '').slice(0, 40);
}

/* ---------- target resolution ---------- */

function resolveTarget(href, fromRoute) {
  let h = String(href).trim();
  if (!h || h.startsWith('#') || h.startsWith('javascript:')) return null;
  if (/^(mailto|tel|sms):/i.test(h)) return { id: h, label: h.split(':')[0], type: 'external' };
  if (/^https?:\/\//i.test(h)) {
    try {
      const u = new URL(h);
      return { id: `${u.origin}${u.pathname}`.replace(/\/$/, '') || u.origin, label: u.host, type: 'external' };
    } catch { return null; }
  }
  h = h.split('#')[0].split('?')[0];
  if (!h) return null;
  if (!h.startsWith('/')) {
    const dir = fromRoute.endsWith('/') ? fromRoute : path.posix.dirname(fromRoute) + '/';
    h = path.posix.resolve(dir, h);
  }
  if (/\.(css|js|mjs|png|jpe?g|svg|ico|webp|woff2?|json|xml|txt|map|webmanifest|pdf)$/i.test(h)) return null;
  if (h.startsWith('/api/')) return { id: h, label: h, type: 'api' };

  const known = knownRoute(h);
  if (known) return { id: known, label: known, type: 'page' };
  return { id: h, label: h, type: 'missing' };
}

function knownRoute(h) {
  if (!ROUTES) ROUTES = new Set();
  if (ROUTES.has(h)) return h;
  const withSlash = h.endsWith('/') ? h : h + '/';
  if (ROUTES.has(withSlash)) return withSlash;
  const noSlash = h.replace(/\/$/, '');
  if (ROUTES.has(noSlash)) return noSlash;
  // fall back to disk check
  const candidates = [
    path.join(root, h, 'index.html'),
    path.join(root, h.replace(/\/$/, '') + '.html'),
    path.join(root, h),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      const rel = posix(path.relative(root, c));
      const r = routeOf(rel);
      ROUTES.add(r);
      return r;
    }
  }
  return null;
}

/* ---------- analysis ---------- */

function dedupeEdges(edges) {
  const seen = new Set();
  for (let i = edges.length - 1; i >= 0; i--) {
    const k = `${edges[i].from}>${edges[i].to}>${edges[i].label}>${edges[i].kind}`;
    if (seen.has(k)) edges.splice(i, 1); else seen.add(k);
  }
}

// A header or footer repeated on every page emits one link per page, and those
// hundreds of identical wires bury the handful of links that are specific to a
// page. Tag anything that appears from more than REPEAT_MIN pages so the viewer
// can fold it away, the same way it already folds links wired by shared scripts.
const REPEAT_MIN = 4;
function markRepeated(edges) {
  const sources = new Map();   // "label\0target" -> Set(page it appears on)
  for (const e of edges) {
    const k = `${e.label} ${e.to}`;
    if (!sources.has(k)) sources.set(k, new Set());
    sources.get(k).add(e.from);
  }
  for (const e of edges) {
    if (sources.get(`${e.label} ${e.to}`).size > REPEAT_MIN) e.repeated = true;
  }
}

function analyze(flow) {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const out = new Map(), inn = new Map();
  for (const n of flow.nodes) { out.set(n.id, []); inn.set(n.id, []); }
  for (const e of flow.edges) {
    out.get(e.from)?.push(e);
    inn.get(e.to)?.push(e);
  }
  const entry = byId.get('/') || flow.nodes[0];
  const depth = new Map();
  if (entry) {
    depth.set(entry.id, 0);
    const q = [entry.id];
    while (q.length) {
      const cur = q.shift();
      for (const e of out.get(cur) || []) {
        if (!depth.has(e.to)) { depth.set(e.to, depth.get(cur) + 1); q.push(e.to); }
      }
    }
  }
  for (const n of flow.nodes) {
    n.inbound = (inn.get(n.id) || []).length;
    n.outbound = (out.get(n.id) || []).length;
    n.depth = depth.has(n.id) ? depth.get(n.id) : -1;
  }
  const pages = flow.nodes.filter((n) => n.type === 'page');
  flow.issues = {
    deadLinks: flow.edges.filter((e) => byId.get(e.to)?.type === 'missing')
      .map((e) => ({ from: e.from, to: e.to, label: e.label, file: e.file, line: e.line })),
    orphans: pages.filter((n) => n.inbound === 0 && n.id !== '/').map((n) => n.id),
    deadEnds: pages.filter((n) => n.outbound === 0).map((n) => n.id),
    deep: pages.filter((n) => n.depth > 3).map((n) => ({ id: n.id, depth: n.depth })),
    unreachable: pages.filter((n) => n.depth === -1 && n.id !== '/').map((n) => n.id),
    hubs: pages.filter((n) => n.outbound > 12).map((n) => ({ id: n.id, outbound: n.outbound })),
  };
}

function mergePrevious(flow) {
  if (!fs.existsSync(flowPath)) return;
  try {
    const prev = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
    flow.layout = prev.layout || {};
    flow.notes = prev.notes || {};
    if (!flow.base && prev.base) flow.base = prev.base;
  } catch { /* ignore */ }
}

/* ---------- utils ---------- */

function attr(s, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(s || '');
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : null;
}
function label(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 44);
}
function titleOf(t) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(t) || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(t);
  return m ? label(m[1]) : '';
}
function lineAt(text, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
function resolveFile(src, fromRoute) {
  let s = src.split('?')[0];
  if (/^https?:/i.test(s)) return null;
  if (!s.startsWith('/')) {
    const dir = fromRoute.endsWith('/') ? fromRoute : path.posix.dirname(fromRoute) + '/';
    s = path.posix.resolve(dir, s);
  }
  const abs = path.join(root, s);
  return fs.existsSync(abs) ? abs : null;
}
function posix(p) { return p.split(path.sep).join('/'); }
function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; }
  }
  return o;
}
function die(m) { console.error('sitelines: ' + m); process.exit(1); }

main();
