// Fails when physical (left/right) Tailwind utilities appear in src/ outside components/ui.
// Use logical utilities instead: ms-/me-/ps-/pe-/start-/end-/text-start/text-end/rounded-s-/rounded-e-/border-s-/border-e-.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const SKIP = [join('components', 'ui')];
const PHYSICAL = /(?<![\w-])(?:-?(?:ml|mr|pl|pr|left|right|inset-x-\d|scroll-ml|scroll-mr|scroll-pl|scroll-pr|rounded-[lr](?:-[a-z0-9]+)?|border-[lr](?:-[a-z0-9]+)?|text-left|text-right|float-left|float-right|clear-left|clear-right)(?:-[^\s"'`]+)?)(?=[\s"'`}])/g;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p);
    if (SKIP.some((s) => rel.startsWith(s))) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx|ts|jsx|js|css)$/.test(name) && !/\.test\./.test(name)) files.push(p);
  }
})(ROOT);

let failures = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!/className|class=|@apply|cva\(|cn\(/.test(line) && !/^\s*["'`]/.test(line)) return;
    const hits = [...line.matchAll(PHYSICAL)].map((m) => m[0]).filter((h) => !/^-?(?:left|right)$/.test(h) || /(?:^|\s)(?:left|right)(?:\s|$)/.test(line));
    if (hits.length) {
      failures++;
      console.log(`${relative(ROOT, f)}:${i + 1}: ${hits.join(', ')}`);
    }
  });
}
if (failures) {
  console.error(`\nRTL check failed: ${failures} line(s) use physical utilities. Use ms-/me-/ps-/pe-/start-/end- instead.`);
  process.exit(1);
}
console.log(`RTL check passed (${files.length} files).`);
