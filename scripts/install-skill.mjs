#!/usr/bin/env node
// Installs routemap as a Claude Code skill by copying the skill payload into a
// skills directory. Nothing here is routemap-specific magic: a Claude Code skill
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
  if (scope === 'project') return path.resolve(process.cwd(), '.claude', 'skills', 'routemap');
  return path.join(os.homedir(), '.claude', 'skills', 'routemap');
}

export function installSkill({ scope = 'global', dir = null, force = false } = {}) {
  const dest = skillDir(scope, dir);
  const manifest = path.join(pkgRoot, 'skill', 'SKILL.md');
  if (!fs.existsSync(manifest)) {
    throw new Error(`skill payload missing at ${manifest} — is this a complete checkout?`);
  }
  if (fs.existsSync(dest) && !force) {
    const existing = path.join(dest, 'SKILL.md');
    if (fs.existsSync(existing)) {
      console.log(`routemap: skill already installed at ${dest}`);
      console.log('routemap: pass --force to overwrite it');
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

export function uninstallSkill({ scope = 'global', dir = null } = {}) {
  const dest = skillDir(scope, dir);
  if (!fs.existsSync(dest)) return { dest, changed: false };
  fs.rmSync(dest, { recursive: true, force: true });
  return { dest, changed: true };
}

// run directly: node scripts/install-skill.mjs [flags]
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const flag = (n) => a.includes(`--${n}`);
  const val = (n) => { const i = a.indexOf(`--${n}`); return i > -1 ? a[i + 1] : null; };
  const scope = flag('project') ? 'project' : 'global';
  const opts = { scope, dir: val('dir'), force: flag('force') };
  try {
    if (flag('uninstall')) {
      const r = uninstallSkill(opts);
      console.log(r.changed ? `routemap: removed ${r.dest}` : `routemap: nothing installed at ${r.dest}`);
    } else {
      const r = installSkill(opts);
      if (r.changed) {
        console.log(`routemap: skill installed -> ${r.dest}`);
        console.log('routemap: restart Claude Code, then use /routemap');
      }
    }
  } catch (e) {
    console.error(`routemap: ${e.message}`);
    process.exit(1);
  }
}
