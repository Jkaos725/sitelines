#!/usr/bin/env node
// Installs sitelines as a Claude Code skill by copying the skill payload into a
// skills directory. Nothing here is sitelines-specific magic: a Claude Code skill
// is just a folder containing SKILL.md, so this is a copy with a manifest check.
//
// Usage: node install-skill.mjs [--global|--project] [--dir <path>] [--force] [--uninstall]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');

// what a working skill folder needs: the manifest, the docs it links to, and the
// two runtimes SKILL.md tells the agent to run
const PAYLOAD = [
  ['skill/SKILL.md', 'SKILL.md'],
  ['skill/references', 'references'],
  ['scripts', 'scripts'],
  ['viewer', 'viewer'],
  ['DESIGN.md', 'DESIGN.md'],
  ['LICENSE', 'LICENSE'],
];

export function skillDir(scope, custom) {
  if (custom) return path.resolve(process.cwd(), custom);
  if (scope === 'project') return path.resolve(process.cwd(), '.claude', 'skills', 'sitelines');
  return path.join(os.homedir(), '.claude', 'skills', 'sitelines');
}

export function installSkill({ scope = 'global', dir = null, force = false } = {}) {
  const dest = skillDir(scope, dir);
  const manifest = path.join(pkgRoot, 'skill', 'SKILL.md');
  if (!fs.existsSync(manifest)) {
    throw new Error(`skill payload missing at ${manifest} - is this a complete checkout?`);
  }
  if (fs.existsSync(dest) && !force) {
    const existing = path.join(dest, 'SKILL.md');
    if (fs.existsSync(existing)) {
      console.log(`sitelines: skill already installed at ${dest}`);
      console.log('sitelines: pass --force to overwrite it');
      return { dest, changed: false };
    }
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const [from, to] of PAYLOAD) {
    const src = path.join(pkgRoot, from);
    if (!fs.existsSync(src)) continue;
    const target = path.join(dest, to);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(src, target, { recursive: true });
  }
  return { dest, changed: true };
}

/* ---------- AGENTS.md, for every agent that is not Claude Code ---------- */
// Codex, opencode, Cursor, Zed and Gemini CLI read AGENTS.md from the project
// root. Most projects already have one, so this appends a fenced block rather
// than overwriting, and replaces that block in place on a re-install.
const BEGIN = '<!-- sitelines:begin -->';
const END = '<!-- sitelines:end -->';

export function installAgents({ dir = null } = {}) {
  const target = path.resolve(process.cwd(), dir || '.', 'AGENTS.md');
  const src = path.join(pkgRoot, 'skill', 'AGENTS.md');
  if (!fs.existsSync(src)) throw new Error(`AGENTS.md template missing at ${src}`);
  const block = fs.readFileSync(src, 'utf8').trim();

  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, block + '\n');
    return { target, action: 'created' };
  }
  const cur = fs.readFileSync(target, 'utf8');
  const i = cur.indexOf(BEGIN), j = cur.indexOf(END);
  if (i > -1 && j > i) {
    fs.writeFileSync(target, cur.slice(0, i) + block + cur.slice(j + END.length));
    return { target, action: 'updated' };
  }
  fs.writeFileSync(target, cur.replace(/\s*$/, '') + '\n\n' + block + '\n');
  return { target, action: 'appended' };
}

export function uninstallAgents({ dir = null } = {}) {
  const target = path.resolve(process.cwd(), dir || '.', 'AGENTS.md');
  if (!fs.existsSync(target)) return { target, action: 'absent' };
  const cur = fs.readFileSync(target, 'utf8');
  const i = cur.indexOf(BEGIN), j = cur.indexOf(END);
  if (i < 0 || j < i) return { target, action: 'absent' };
  const next = (cur.slice(0, i) + cur.slice(j + END.length)).replace(/\n{3,}/g, '\n\n').trim();
  if (next) fs.writeFileSync(target, next + '\n');
  else fs.rmSync(target);
  return { target, action: next ? 'removed the block' : 'removed the file' };
}

export function uninstallSkill({ scope = 'global', dir = null } = {}) {
  const dest = skillDir(scope, dir);
  if (!fs.existsSync(dest)) return { dest, changed: false };
  fs.rmSync(dest, { recursive: true, force: true });
  return { dest, changed: true };
}

// Run directly: node scripts/install-skill.mjs [flags]
// Compare resolved paths rather than string-matching a file:// URL. The naive
// form breaks on Windows drive letters, and under bun or a pnpm .bin shim
// argv[1] is not always spelled the way import.meta.url is.
const runDirectly = (() => {
  try {
    return !!process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  } catch { return false; }
})();

if (runDirectly) {
  const a = process.argv.slice(2);
  const flag = (n) => a.includes(`--${n}`);
  const val = (n) => { const i = a.indexOf(`--${n}`); return i > -1 ? a[i + 1] : null; };
  const scope = flag('project') ? 'project' : 'global';
  const opts = { scope, dir: val('dir'), force: flag('force') };
  try {
    if (flag('agents')) {
      // every agent that is not Claude Code
      if (flag('uninstall')) {
        const r = uninstallAgents(opts);
        console.log(`sitelines: ${r.action} in ${r.target}`);
      } else {
        const r = installAgents(opts);
        console.log(`sitelines: ${r.action} ${r.target}`);
        console.log('sitelines: Codex, opencode, Cursor, Zed and Gemini CLI read this file automatically');
      }
    } else if (flag('uninstall')) {
      const r = uninstallSkill(opts);
      console.log(r.changed ? `sitelines: removed ${r.dest}` : `sitelines: nothing installed at ${r.dest}`);
    } else {
      const r = installSkill(opts);
      if (r.changed) {
        console.log(`sitelines: skill installed -> ${r.dest}`);
        console.log('sitelines: restart Claude Code, then use /sitelines');
      }
    }
  } catch (e) {
    console.error(`sitelines: ${e.message}`);
    process.exit(1);
  }
}
