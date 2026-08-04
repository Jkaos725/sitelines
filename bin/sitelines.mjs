#!/usr/bin/env node
// sitelines CLI - scan a site's navigation, then browse and edit it in a map.
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyTree, childCommand } from '../scripts/portable.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const scripts = path.join(pkgRoot, 'scripts');
const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);

const version = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).version; }
  catch { return '0.0.0'; }
})();

const HELP = `sitelines ${version} - map, audit, and edit a site's navigation

  sitelines scan [--root DIR] [--out DIR]
      Read every page and every link between them. Writes .sitelines/flow.json.
      --root defaults to the first of public, site, www, static, src/pages,
      src/routes, src/app, app/pages, pages, app, docs that exists.

  sitelines serve [--root DIR] [--out DIR] [--port N] [--open]
      Open the map in a browser. Requires a scan first.

  sitelines open [--root DIR] [--port N]
      Scan, then serve, then open the browser. The usual entry point.

  sitelines demo [--dir sitelines-demo] [--port N]
      Copy the bundled 20-page example site into ./sitelines-demo, map it, and
      open it. Nothing outside that directory is touched. Use this to see what
      sitelines does before pointing it at your own project.

  sitelines skill install [--global|--project] [--dir PATH] [--force]
  sitelines skill uninstall [--global|--project] [--dir PATH]
      Install sitelines as a Claude Code skill so /sitelines works and Claude can
      apply the changes you queue in the map. --global is ~/.claude/skills,
      --project is ./.claude/skills. Defaults to --global.

  sitelines agents [install|uninstall] [--dir PATH]
      Same instructions, as an AGENTS.md block in your project root. Codex,
      opencode, Cursor, Zed and Gemini CLI read that file, so this is how those
      agents learn to apply your queued changes. Appends to an existing
      AGENTS.md rather than overwriting it.

  sitelines version
  sitelines help

State lives in .sitelines/ next to where you run it. Add it to .gitignore, or
commit it to share the map's layout and notes with your team.`;

function run(file, args, opts = {}) {
  const [exe, argv] = childCommand(path.join(scripts, file), args);
  const r = spawnSync(exe, argv, { stdio: 'inherit', ...opts });
  if (r.error) { console.error(`sitelines: ${r.error.message}`); process.exit(1); }
  return r.status ?? 0;
}

function flagValue(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}

function openBrowser(url) {
  const cmds = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  try { spawn(cmds[0], cmds[1], { stdio: 'ignore', detached: true }).unref(); }
  catch { /* no browser here; the URL is already printed */ }
}

switch (cmd) {
  case 'scan':
    process.exit(run('scan.mjs', rest));
    break;

  case 'serve': {
    const wantOpen = rest.includes('--open');
    const args = rest.filter((a) => a !== '--open');
    if (wantOpen) setTimeout(() => openBrowser(`http://localhost:${flagValue(args, 'port', '4370')}`), 700);
    process.exit(run('serve.mjs', args));
    break;
  }

  case 'open': {
    const code = run('scan.mjs', rest);
    if (code !== 0) process.exit(code);
    setTimeout(() => openBrowser(`http://localhost:${flagValue(rest, 'port', '4370')}`), 700);
    process.exit(run('serve.mjs', rest));
    break;
  }

  case 'demo': {
    const dest = path.resolve(process.cwd(), flagValue(rest, 'dir', 'sitelines-demo'));
    const src = path.join(pkgRoot, 'examples', 'demo-site');
    if (!fs.existsSync(src)) { console.error(`sitelines: the bundled example is missing at ${src}`); process.exit(1); }
    if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
      console.log(`sitelines: reusing the existing ${path.basename(dest)}/`);
    } else {
      copyTree(src, dest);
      console.log(`sitelines: copied the example site to ${path.basename(dest)}/ (20 pages)`);
    }
    const port = flagValue(rest, 'port', '4370');
    // keep the demo's state inside the demo, so it never mixes with the map of
    // whatever real project the user runs this from
    const args = ['--root', dest, '--out', path.join(dest, '.sitelines'), '--port', port];
    const code = run('scan.mjs', args);
    if (code !== 0) process.exit(code);
    console.log('sitelines: this example has deliberate faults - 2 dead links, 3 orphans, a dead end, and a page 4 clicks deep');
    setTimeout(() => openBrowser(`http://localhost:${port}`), 700);
    process.exit(run('serve.mjs', args));
    break;
  }

  case 'skill': {
    const sub = rest[0];
    const args = rest.slice(1);
    if (sub === 'install') process.exit(run('install-skill.mjs', args));
    if (sub === 'uninstall') process.exit(run('install-skill.mjs', ['--uninstall', ...args]));
    console.error('sitelines: expected `sitelines skill install` or `sitelines skill uninstall`');
    process.exit(1);
    break;
  }

  case 'agents': {
    const sub = rest[0] === 'uninstall' ? ['--uninstall'] : [];
    const args = rest.filter((a) => a !== 'install' && a !== 'uninstall');
    process.exit(run('install-skill.mjs', ['--agents', ...sub, ...args]));
    break;
  }

  case 'version':
  case '--version':
  case '-v':
    console.log(version);
    break;

  case undefined:
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    break;

  default:
    console.error(`sitelines: unknown command "${cmd}"\n`);
    console.log(HELP);
    process.exit(1);
}
