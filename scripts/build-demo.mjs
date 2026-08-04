#!/usr/bin/env node
// Builds the hosted demo: a static copy of the viewer, already holding a scan of
// the bundled example site, that runs with no server at all. GitHub Pages
// publishes the result, so "click around in your browser" works before anyone
// installs anything.
//
// Usage: node scripts/build-demo.mjs [--out _site]
//
// The viewer itself is not forked for this. It reads `data-base` off <html> for
// its server URLs, and scripts/demo-static.js answers the API calls from static
// JSON plus localStorage. Everything here is copy, scan, and rewrite.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyTree, childCommand } from './portable.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const args = parseArgs(process.argv.slice(2));
const outRoot = path.resolve(process.cwd(), args.out || '_site');
const demoDir = path.join(outRoot, 'demo');
const siteSrc = path.join(pkgRoot, 'examples', 'demo-site');

// what the map calls the scan root. `sitelines demo` copies the example site to
// ./sitelines-demo, so the hosted map should name the same directory.
const ROOT_LABEL = 'sitelines-demo';

const IMG = 'https://raw.githubusercontent.com/Jkaos725/sitelines/main/docs/map.jpg';
const DESC = 'Every page on a site, every link between them, and everything broken - live in your browser, '
  + 'no install. This is the bundled 20-page example site, mapped by sitelines.';
const META = `<meta name="description" content="${DESC}">
<meta property="og:type" content="website">
<meta property="og:title" content="sitelines - live demo">
<meta property="og:description" content="${DESC}">
<meta property="og:image" content="${IMG}">
<meta name="twitter:card" content="summary_large_image">`;

// Pages serves the whole output directory; the demo is the only thing in it.
// The bare URL is the one people paste, so it carries the card meta too -
// a crawler reading it never follows the refresh.
const REDIRECT = `<!doctype html>
<meta charset="utf-8">
<title>sitelines - live demo</title>
${META}
<meta http-equiv="refresh" content="0; url=./demo/">
<link rel="canonical" href="./demo/">
<p><a href="./demo/">sitelines demo</a></p>
`;

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(demoDir, 'api'), { recursive: true });

/* ---------- the scan ---------- */
// Scan the example site where it sits, then relabel the root. Node and edge
// paths are already relative to the root, so nothing else has to move.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sitelines-build-'));
const [exe, argv] = childCommand(path.join(here, 'scan.mjs'), ['--root', siteSrc, '--out', tmp]);
const scan = spawnSync(exe, argv, { cwd: pkgRoot, encoding: 'utf8' });
if (scan.status !== 0) {
  console.error(scan.stdout || '', scan.stderr || '');
  die('scan failed');
}
const flow = JSON.parse(fs.readFileSync(path.join(tmp, 'flow.json'), 'utf8'));
flow.root = ROOT_LABEL;
write(path.join(demoDir, 'api', 'flow.json'), JSON.stringify(flow));
write(path.join(demoDir, 'api', 'views.json'), JSON.stringify({
  active: 'all',
  views: [{ id: 'all', label: 'everything', base: true, include: [], exclude: [] }],
}));
fs.rmSync(tmp, { recursive: true, force: true });

/* ---------- the site being previewed ---------- */
// The example site links with root-absolute paths (`/pricing/`), which is right
// for a site served at an origin root and wrong for one served from a subpath.
// Previews are iframes of these files, so rewrite them to depth-relative paths.
// The scan above already ran against the untouched source, so the map still
// reports the routes the author wrote.
copyTree(siteSrc, path.join(demoDir, 'site'));
for (const file of walk(path.join(demoDir, 'site'))) {
  if (!/\.(html?|css)$/i.test(file)) continue;
  const rel = path.relative(path.join(demoDir, 'site'), file).split(path.sep);
  const up = rel.length - 1;
  const prefix = up === 0 ? './' : '../'.repeat(up);
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text
    .replace(/\b(href|src)="\/(?!\/)([^"]*)"/g, (_, a, p) => `${a}="${prefix}${p}"`)
    .replace(/url\(\s*\/(?!\/)([^)]*)\)/g, (_, p) => `url(${prefix}${p})`));
}

/* ---------- the viewer ---------- */
for (const f of ['app.js', 'style.css']) {
  fs.copyFileSync(path.join(pkgRoot, 'viewer', f), path.join(demoDir, f));
}
fs.copyFileSync(path.join(here, 'demo-static.js'), path.join(demoDir, 'static.js'));

let html = fs.readFileSync(path.join(pkgRoot, 'viewer', 'index.html'), 'utf8');
html = replaceOnce(html, '<html lang="en">', '<html lang="en" data-base=".">');
html = replaceOnce(html, '<title>sitelines</title>', '<title>sitelines - live demo</title>');
html = replaceOnce(html, 'href="/style.css"', 'href="style.css"');
html = replaceOnce(html, '<script type="module" src="/app.js"></script>',
  '<script src="static.js"></script>\n<script type="module" src="app.js"></script>');
html = replaceOnce(html, '</head>', `${META}\n</head>`);
write(path.join(demoDir, 'index.html'), html);

/* ---------- the Pages root ---------- */
write(path.join(outRoot, '.nojekyll'), '');
write(path.join(outRoot, 'index.html'), REDIRECT);

console.log(`sitelines: demo built -> ${path.relative(process.cwd(), outRoot) || '.'}`);
console.log(`  ${flow.nodes.filter((n) => n.type === 'page').length} pages, ${flow.edges.length} links`);
console.log('  preview it with any static server, e.g. `npx serve _site`');

/* ---------- helpers ---------- */
function replaceOnce(s, find, sub) {
  if (!s.includes(find)) die(`viewer/index.html no longer contains ${JSON.stringify(find)} - update scripts/build-demo.mjs`);
  return s.replace(find, sub);
}
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
function write(f, s) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); }
function die(m) { console.error(`sitelines: ${m}`); process.exit(1); }
function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; }
  return o;
}
