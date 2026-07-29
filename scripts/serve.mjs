#!/usr/bin/env node
// sitelines server - serves the viewer, the site (for live previews), and the change queue.
// Usage: node serve.mjs [--root public] [--out .sitelines] [--port 4370]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const viewerDir = path.join(here, '..', 'viewer');
const args = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const outDir = path.resolve(cwd, args.out || '.sitelines');
const flowPath = path.join(outDir, 'flow.json');
const editsPath = path.join(outDir, 'edits.json');
const viewsPath = path.join(outDir, 'views.json');
const port = Number(args.port || 4370);

if (!fs.existsSync(flowPath)) {
  console.error(`sitelines: no scan at ${flowPath}`);
  console.error('sitelines: run `sitelines scan` first (or `node scripts/scan.mjs`)');
  process.exit(1);
}
const flow0 = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
const siteRoot = path.resolve(cwd, args.root || flow0.root || 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const p = decodeURIComponent(url.pathname);
  try {
    if (p === '/api/flow' && req.method === 'GET') return json(res, read(flowPath));
    if (p === '/api/edits' && req.method === 'GET') return json(res, readEdits());
    if (p === '/api/views' && req.method === 'GET') return json(res, readViews());
    if (p === '/api/views' && req.method === 'POST') {
      const body = await readBody(req);
      const next = withBase(body);
      write(viewsPath, next);
      return json(res, next);
    }
    if (p === '/api/edits' && req.method === 'POST') {
      const body = await readBody(req);
      const edits = readEdits();
      const edit = { id: `e${Date.now().toString(36)}${Math.floor(performance.now() * 1000 % 999)}`, at: new Date().toISOString(), status: 'pending', ...body };
      edits.push(edit);
      write(editsPath, edits);
      log(`queued ${edit.op}: ${edit.summary || ''}`);
      return json(res, edit);
    }
    if (p === '/api/edits' && req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      const edits = readEdits().filter((e) => (id ? e.id !== id : false));
      write(editsPath, edits);
      return json(res, { ok: true, remaining: edits.length });
    }
    if (p === '/api/layout' && req.method === 'POST') {
      const body = await readBody(req);
      const flow = read(flowPath);
      flow.layout = { ...flow.layout, ...(body.layout || {}) };
      if (body.notes) flow.notes = { ...flow.notes, ...body.notes };
      write(flowPath, flow);
      return json(res, { ok: true });
    }
    if (p === '/api/rescan' && req.method === 'POST') {
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync(process.execPath, [path.join(here, 'scan.mjs'), '--root', siteRoot, '--out', outDir], { cwd, encoding: 'utf8' });
      return json(res, { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') });
    }
    if (p.startsWith('/site/') || p === '/site') {
      const sub = p.replace(/^\/site/, '') || '/';
      // a previewed page must never install a service worker: it would cache the
      // preview responses and then serve them back for every later preview.
      if (/\/(sw|service-worker)\.js$/i.test(sub)) {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        return res.end("self.addEventListener('install',()=>self.skipWaiting());try{self.registration.unregister()}catch(e){}\n");
      }
      return serveStatic(res, siteRoot, sub, true, req);
    }
    return serveStatic(res, viewerDir, p === '/' ? '/index.html' : p, false, req);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e && e.stack || e));
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`sitelines: port ${port} is already in use - try \`sitelines serve --port ${port + 1}\``);
    process.exit(1);
  }
  throw e;
});

// Loopback only. This server hands out every file under the scan root and has
// endpoints that write to disk and spawn a rescan, so it must not be reachable
// from the network just because you are on shared wifi. --host is opt-in.
const host = args.host === true ? '0.0.0.0' : (args.host || '127.0.0.1');

server.listen(port, host, () => {
  console.log(`sitelines  http://localhost:${port}`);
  console.log(`  previews from ${posix(path.relative(cwd, siteRoot)) || '.'}  |  changes -> ${posix(path.relative(cwd, editsPath))}`);
  if (host !== '127.0.0.1') console.log(`  WARNING: listening on ${host}, so anyone on this network can read your source`);
});

const SW_GUARD = `<script>(function(){try{var n=navigator;if(!n.serviceWorker)return;
n.serviceWorker.getRegistrations&&n.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})}).catch(function(){});
Object.defineProperty(n,'serviceWorker',{configurable:true,get:function(){return{register:function(){return Promise.resolve({unregister:function(){return Promise.resolve(true)},addEventListener:function(){}})},getRegistration:function(){return Promise.resolve(undefined)},getRegistrations:function(){return Promise.resolve([])},ready:new Promise(function(){}),controller:null,addEventListener:function(){}}}});}catch(e){}})();</script>`;

// shown inside a preview frame when the route has no file on disk
const MISSING_PAGE = `<!doctype html><meta charset="utf-8"><title>Not on disk</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;height:100vh;display:grid;place-content:center;gap:.4rem;text-align:center;
    font:13px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:#f6f7f9;color:#454c59}
  b{color:#10131a;font-size:14px}
  code{font-family:ui-monospace,"Cascadia Mono",Menlo,Consolas,monospace}
  @media (prefers-color-scheme:dark){
    body{background:#101317;color:#9aa1ad} b{color:#eceef2}
  }
</style>
<b>No file on disk</b>
<span>This route is a dynamic route or a dead link.</span>`;

// `resolved.startsWith(base)` is not a containment check: with base /srv/public a
// request resolving to /srv/public-private/secret passes it. Compare the relative
// path instead, which is empty or a plain descendant only when truly inside.
function inside(base, file) {
  const rel = path.relative(path.resolve(base), path.resolve(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function serveStatic(res, base, p, isSite, req) {
  let file = path.join(base, p);
  if (!inside(base, file)) { res.writeHead(403); return res.end('forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    const alt = file.replace(/\/$/, '') + '.html';
    if (fs.existsSync(alt)) file = alt;
    else { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); return res.end(MISSING_PAGE); }
  }
  // preview assets are hit once per page card and again every time the map reloads,
  // so let the browser keep them: revalidate cheaply against mtime+size
  const st = fs.statSync(file);
  const etag = `W/"${st.size.toString(36)}-${st.mtimeMs.toString(36)}${isSite ? '-s' : ''}"`;
  if (req && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': 'public, max-age=30, must-revalidate' });
    return res.end();
  }
  let body = fs.readFileSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  if (isSite && type.startsWith('text/html')) {
    const html = body.toString('utf8');
    body = Buffer.from(/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + SW_GUARD) : SW_GUARD + html, 'utf8');
  }
  res.writeHead(200, { 'content-type': type, etag, 'cache-control': 'public, max-age=30, must-revalidate' });
  res.end(body);
}

function readEdits() { return fs.existsSync(editsPath) ? JSON.parse(fs.readFileSync(editsPath, 'utf8')) : []; }

// Views are user-editable include/exclude sets. Exactly one is seeded: the base
// view, which always shows every page and never carries rules. Users add their
// own from the viewer, and agents add them by appending to this file.
function readViews() {
  if (fs.existsSync(viewsPath)) return withBase(read(viewsPath));
  const v = withBase({ active: 'all', views: [] });
  write(viewsPath, v);
  return v;
}

// the base view is a guarantee, not a default: restore it if a hand-edit drops it
function withBase(cfg) {
  const views = Array.isArray(cfg.views) ? cfg.views.filter((v) => v && v.id) : [];
  const i = views.findIndex((v) => v.base || v.id === 'all');
  const base = { ...(i > -1 ? views[i] : {}), id: 'all', label: 'everything', base: true, include: [], exclude: [] };
  if (i > -1) views.splice(i, 1);
  const out = { active: cfg.active || 'all', views: [base, ...views] };
  if (!out.views.some((v) => v.id === out.active)) out.active = 'all';
  return out;
}
function read(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function write(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); }
function json(res, v) { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(v)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function log(m) { console.log(`sitelines: ${m}`); }
function posix(p) { return p.split(path.sep).join('/'); }
function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; }
  return o;
}
