#!/usr/bin/env node
// routemap CLI — scan a site's navigation, then browse and edit it in a map.
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

const HELP = `routemap ${version} — map, audit, and edit a site's navigation

  routemap scan [--root DIR] [--out DIR]
      Read every page and every link between them. Writes .routemap/flow.json.
      --root defaults to the first of public, site, www, static, src/pages,
      src/routes, src/app, app/pages, pages, app, docs that exists.

  routemap serve [--root DIR] [--out DIR] [--port N] [--open]
      Open the map in a browser. Requires a scan first.

  routemap open [--root DIR] [--port N]
      Scan, then serve, then open the browser. The usual entry point.

  routemap skill install [--global|--project] [--dir PATH] [--force]
  routemap skill uninstall [--global|--project] [--dir PATH]
      Install routemap as a Claude Code skill so /routemap works and Claude can
      apply the changes you queue in the map. --global is ~/.claude/skills,
      --project is ./.claude/skills. Defaults to --global.

  routemap version
  routemap help

State lives in .routemap/ next to where you run it. Add it to .gitignore, or
commit it to share the map's layout and notes with your team.`;

function run(file, args, opts = {}) {
  const r = spawnSync(process.execPath, [path.join(scripts, file), ...args], { stdio: 'inherit', ...opts });
  if (r.error) { console.error(`routemap: ${r.error.message}`); process.exit(1); }
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

  case 'skill': {
    const sub = rest[0];
    const args = rest.slice(1);
    if (sub === 'install') process.exit(run('install-skill.mjs', args));
    if (sub === 'uninstall') process.exit(run('install-skill.mjs', ['--uninstall', ...args]));
    console.error('routemap: expected `routemap skill install` or `routemap skill uninstall`');
    process.exit(1);
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
    console.error(`routemap: unknown command "${cmd}"\n`);
    console.log(HELP);
    process.exit(1);
}
