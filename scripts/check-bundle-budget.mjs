// Fails when a route's first-load JavaScript grows past its budget in scripts/bundle-budget.json.
// Run it after `pnpm build` (the build is what writes the numbers):   pnpm build && pnpm budget
//
// Reads .next/diagnostics/route-bundle-stats.json, an UNDOCUMENTED Next.js internal written by
// node_modules/next/dist/build/route-bundle-stats.js. Its name or shape can change on a Next upgrade, so every
// way this script cannot read it (file missing, not JSON, wrong shape, field missing) is a hard failure with a
// message. It never passes silently.
//
// Options:
//   --update          rewrite scripts/bundle-budget.json from the current build: each route's first-load
//                     uncompressed JS + 5 %, rounded up to a whole KiB. Use it only for a growth the owner accepted.
//   --stats <file>    read another stats file (tests).
//   --budget <file>   read/write another budget file (tests).
//
// Plain Node ESM, no dependency.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HEADROOM_PERCENT = 5;
export const KIB = 1024;
const STATS_FIELD = 'firstLoadUncompressedJsBytes';
const DEFAULT_STATS = fileURLToPath(new URL('../.next/diagnostics/route-bundle-stats.json', import.meta.url));
const DEFAULT_BUDGET = fileURLToPath(new URL('./bundle-budget.json', import.meta.url));

/** A problem with the inputs (as opposed to a route over budget). main() prints the message and exits 1. */
export class BudgetError extends Error {}

/** Parses the Next stats text into [{ route, bytes }]. Throws BudgetError when the shape is not the expected one. */
export function parseStats(text, where = 'route-bundle-stats.json') {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new BudgetError(`${where} is not valid JSON (${e.message}). Run \`pnpm build\` again.`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new BudgetError(`${where} is not a non-empty array of routes. Next may have changed this internal file; update scripts/check-bundle-budget.mjs.`);
  }
  return data.map((entry, i) => {
    const route = entry && entry.route;
    const bytes = entry && entry[STATS_FIELD];
    if (typeof route !== 'string' || !route) {
      throw new BudgetError(`${where} entry ${i} has no "route" string. Next may have changed this internal file.`);
    }
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
      throw new BudgetError(`${where} route ${route} has no numeric "${STATS_FIELD}" field. Next may have renamed it; update scripts/check-bundle-budget.mjs.`);
    }
    return { route, bytes };
  });
}

/** Parses scripts/bundle-budget.json into Map<route, bytes>. */
export function parseBudget(text, where = 'bundle-budget.json') {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new BudgetError(`${where} is not valid JSON (${e.message}).`);
  }
  const routes = data && data.routes;
  if (!routes || typeof routes !== 'object' || Array.isArray(routes) || Object.keys(routes).length === 0) {
    throw new BudgetError(`${where} has no "routes" object. Regenerate it with \`pnpm budget --update\`.`);
  }
  const out = new Map();
  for (const [route, kib] of Object.entries(routes)) {
    if (typeof kib !== 'number' || !Number.isFinite(kib) || kib <= 0) {
      throw new BudgetError(`${where} route ${route} must be a positive number of KiB.`);
    }
    out.set(route, kib * KIB);
  }
  return out;
}

/** Current + 5 % rounded up to a whole KiB. Integer arithmetic, so no float noise at an exact boundary. */
export function budgetKib(bytes) {
  return Math.ceil((bytes * (100 + HEADROOM_PERCENT)) / (100 * KIB));
}

/** The budget file contents for a set of current route sizes. */
export function buildBudget(stats) {
  const routes = {};
  for (const { route, bytes } of [...stats].sort((a, b) => a.route.localeCompare(b.route))) routes[route] = budgetKib(bytes);
  return { unit: 'KiB', headroomPercent: HEADROOM_PERCENT, routes };
}

/** Compares current sizes with the budget. Returns table rows plus one message per problem. */
export function compare(stats, budget) {
  const failures = [];
  const rows = [];
  const seen = new Set();
  for (const { route, bytes } of [...stats].sort((a, b) => b.bytes - a.bytes)) {
    seen.add(route);
    const limit = budget.get(route);
    if (limit === undefined) {
      rows.push({ route, current: bytes, budget: null, status: 'NO BUDGET' });
      failures.push(`${route} has no budget (new route). Run \`pnpm budget --update\` once the size is accepted.`);
    } else if (bytes > limit) {
      rows.push({ route, current: bytes, budget: limit, status: 'OVER' });
      failures.push(`${route} is ${fmt(bytes)} KiB, ${fmt(bytes - limit)} KiB over its ${fmt(limit)} KiB budget.`);
    } else {
      rows.push({ route, current: bytes, budget: limit, status: 'ok' });
    }
  }
  for (const [route, limit] of budget) {
    if (seen.has(route)) continue;
    rows.push({ route, current: null, budget: limit, status: 'MISSING' });
    failures.push(`${route} is in the budget but not in the build output (route removed or renamed?). Run \`pnpm budget --update\`.`);
  }
  return { rows, failures };
}

const fmt = (bytes) => (bytes / KIB).toFixed(1);

/** Plain-text table: route, current, budget. */
export function formatTable(rows) {
  const head = ['route', 'current KiB', 'budget KiB', 'status'];
  const body = rows.map((r) => [r.route, r.current == null ? '-' : fmt(r.current), r.budget == null ? '-' : fmt(r.budget), r.status]);
  const widths = head.map((h, c) => Math.max(h.length, ...body.map((row) => row[c].length)));
  const line = (cells) => cells.map((cell, c) => (c === 0 || c === 3 ? cell.padEnd(widths[c]) : cell.padStart(widths[c]))).join('  ').trimEnd();
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}

function readFile(file, hint) {
  if (!existsSync(file)) throw new BudgetError(`${file} not found. ${hint}`);
  return readFileSync(file, 'utf8');
}

/** Runs the check. Returns the process exit code. `log`/`err` are injectable for tests. */
export function run(argv, log = console.log, err = console.error) {
  const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const statsFile = opt('--stats') || DEFAULT_STATS;
  const budgetFile = opt('--budget') || DEFAULT_BUDGET;
  try {
    const stats = parseStats(readFile(statsFile, 'Run `pnpm build` first (or Next renamed this internal file).'), statsFile);
    if (argv.includes('--update')) {
      writeFileSync(budgetFile, JSON.stringify(buildBudget(stats), null, 2) + '\n');
      log(`Wrote ${budgetFile} for ${stats.length} routes (current + ${HEADROOM_PERCENT} %, rounded up to KiB).`);
      return 0;
    }
    const budget = parseBudget(readFile(budgetFile, 'Create it with `pnpm budget --update`.'), budgetFile);
    const { rows, failures } = compare(stats, budget);
    log(formatTable(rows));
    if (failures.length) {
      err(`\nBundle budget FAILED (${failures.length}):`);
      for (const f of failures) err(`  - ${f}`);
      return 1;
    }
    log(`\nBundle budget passed (${rows.length} routes).`);
    return 0;
  } catch (e) {
    if (!(e instanceof BudgetError)) throw e;
    err(`Bundle budget FAILED: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run(process.argv.slice(2));
}
