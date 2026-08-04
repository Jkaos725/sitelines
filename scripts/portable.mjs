// Bits that differ between the runtimes and installers sitelines has to run
// under: node, bun and deno, installed by npm, pnpm, yarn (both node_modules
// and Plug'n'Play), or bun.

/* ---------- recursive directory copy ---------- */
//
// fs.cpSync would do this in one call, but it drops into a native binding that
// only knows about real files on disk. Under Yarn Plug'n'Play the package lives
// inside a .zip and is served by a patched fs, so cpSync throws ENOENT on paths
// that readdirSync/readFileSync read happily. This walks with the patched-fs
// calls instead, which every runtime and every installer implements.
import fs from 'node:fs';
import path from 'node:path';

export function copyTree(src, dest) {
  const st = fs.statSync(src);
  if (!st.isDirectory()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    copyFile(src, dest);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) copyTree(from, to);
    else if (e.isSymbolicLink()) copyFile(from, to); // follow it; the target is what we want on disk
    else copyFile(from, to);
  }
}

function copyFile(from, to) {
  try { fs.copyFileSync(from, to); }
  catch { fs.writeFileSync(to, fs.readFileSync(from)); }
}

/* ---------- re-running one of our own scripts ---------- */
// The CLI runs the scanner and the server as child processes of whatever
// launched it, so `bunx sitelines` keeps using bun and a deno run keeps using
// deno. node and bun both take a bare script path; deno needs an explicit
// subcommand, and a child deno starts with no permissions of its own.
export function childCommand(script, args = []) {
  const exe = process.execPath;
  const isDeno = typeof globalThis.Deno !== 'undefined' || /(^|[\\/])deno(\.exe)?$/i.test(exe);
  return [exe, isDeno ? ['run', '-A', script, ...args] : [script, ...args]];
}
