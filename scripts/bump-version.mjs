// Sets the app version everywhere it's stored: npm run bump -- 0.9.0
// (tauri.conf.json reads it from package.json.) Plain text edits, so it needs
// neither cargo nor network access. Merging the change into main publishes
// the Windows release (see .github/workflows/desktop.yml).
import { readFileSync, writeFileSync } from 'node:fs';

const next = process.argv[2]?.replace(/^v/, '');
if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('Usage: npm run bump -- X.Y.Z');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const name = pkg.name;
const prev = pkg.version;

/** Replace exactly one match of `re` in `file`, or stop with an error. */
function edit(file, re, to) {
  const text = readFileSync(file, 'utf8');
  const hits = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) ?? [];
  if (hits.length !== 1) {
    console.error(`${file}: expected 1 version entry, found ${hits.length}. Nothing changed in it.`);
    process.exit(1);
  }
  writeFileSync(file, text.replace(re, to));
  console.log(`  ${file}`);
}

console.log(`${name}: ${prev} -> ${next}`);
const q = prev.replace(/\./g, '\\.');
// package.json: the top-level "version".
edit('package.json', new RegExp(`^(  "version": )"${q}"`, 'm'), `$1"${next}"`);
// package-lock.json: the top-level entry and the root package entry.
edit('package-lock.json', new RegExp(`^(  "name": "${name}",\\n  "version": )"${q}"`, 'm'), `$1"${next}"`);
edit('package-lock.json', new RegExp(`^(    "": \\{\\n      "name": "${name}",\\n      "version": )"${q}"`, 'm'), `$1"${next}"`);
// Cargo.toml: version in [package].
edit('src-tauri/Cargo.toml', new RegExp(`^(name = "${name}"\\nversion = )"${q}"`, 'm'), `$1"${next}"`);
// Cargo.lock: this crate's entry.
edit('src-tauri/Cargo.lock', new RegExp(`^(name = "${name}"\\nversion = )"${q}"`, 'm'), `$1"${next}"`);
console.log('Done. Commit this; merging it into main publishes the release.');
