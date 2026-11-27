import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  budgetKib,
  buildBudget,
  compare,
  parseBudget,
  parseStats,
  run,
} from '../../../scripts/check-bundle-budget.mjs';

const stat = (route: string, bytes: number) => ({ route, firstLoadUncompressedJsBytes: bytes, firstLoadChunkPaths: [] });

describe('parseStats', () => {
  it('reads route and first-load bytes', () => {
    expect(parseStats(JSON.stringify([stat('/', 1000), stat('/a', 2000)]))).toEqual([
      { route: '/', bytes: 1000 },
      { route: '/a', bytes: 2000 },
    ]);
  });

  it('fails loudly on invalid JSON, a non-array and an empty array', () => {
    expect(() => parseStats('{nope')).toThrow(/not valid JSON/);
    expect(() => parseStats('{"routes":[]}')).toThrow(/non-empty array/);
    expect(() => parseStats('[]')).toThrow(/non-empty array/);
  });

  it('fails loudly when the first-load field is missing or not a number (never passes silently)', () => {
    expect(() => parseStats(JSON.stringify([{ route: '/' }]))).toThrow(/firstLoadUncompressedJsBytes/);
    expect(() => parseStats(JSON.stringify([{ route: '/', firstLoadUncompressedJsBytes: '12' }]))).toThrow(/firstLoadUncompressedJsBytes/);
    expect(() => parseStats(JSON.stringify([{ route: '/', firstLoadUncompressedJsBytes: null }]))).toThrow(/firstLoadUncompressedJsBytes/);
    expect(() => parseStats(JSON.stringify([{ firstLoadUncompressedJsBytes: 5 }]))).toThrow(/"route"/);
  });
});

describe('budget maths', () => {
  it('is current + 5 % rounded up to a whole KiB', () => {
    expect(budgetKib(1024 * 100)).toBe(105); // exact
    expect(budgetKib(1024 * 100 + 1)).toBe(106); // one byte more rounds up
    expect(budgetKib(1010975)).toBe(1037);
  });

  it('buildBudget sorts routes and records unit and headroom', () => {
    const b = buildBudget([
      { route: '/z', bytes: 1024 * 100 },
      { route: '/a', bytes: 1024 * 200 },
    ]);
    expect(Object.keys(b.routes)).toEqual(['/a', '/z']);
    expect(b).toMatchObject({ unit: 'KiB', headroomPercent: 5, routes: { '/a': 210, '/z': 105 } });
  });

  it('parseBudget converts KiB to bytes and rejects bad files', () => {
    expect(parseBudget(JSON.stringify({ routes: { '/': 2 } })).get('/')).toBe(2048);
    expect(() => parseBudget('x')).toThrow(/not valid JSON/);
    expect(() => parseBudget('{}')).toThrow(/routes/);
    expect(() => parseBudget(JSON.stringify({ routes: { '/': 0 } }))).toThrow(/positive/);
  });
});

describe('compare', () => {
  const budget = new Map([
    ['/', 1000],
    ['/b', 500],
  ]);

  it('passes when every route is at or under its budget', () => {
    const { failures, rows } = compare(
      [
        { route: '/', bytes: 1000 },
        { route: '/b', bytes: 10 },
      ],
      budget,
    );
    expect(failures).toEqual([]);
    expect(rows.map((r) => r.status)).toEqual(['ok', 'ok']);
  });

  it('fails a route over its budget', () => {
    const { failures } = compare(
      [
        { route: '/', bytes: 1001 },
        { route: '/b', bytes: 10 },
      ],
      budget,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^\/ is /);
  });

  it('fails a new route without a budget and a budgeted route missing from the build', () => {
    const { failures, rows } = compare([{ route: '/', bytes: 10 }, { route: '/new', bytes: 10 }], budget);
    expect(failures).toHaveLength(2);
    expect(rows.map((r) => r.status).sort()).toEqual(['MISSING', 'NO BUDGET', 'ok']);
  });
});

describe('run (end to end, temp files)', () => {
  let dir = '';
  let out: string[] = [];
  let errs: string[] = [];
  const log = (s: string) => out.push(s);
  const err = (s: string) => errs.push(s);
  const statsFile = () => join(dir, 'stats.json');
  const budgetFile = () => join(dir, 'budget.json');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'budget-'));
    out = [];
    errs = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('--update writes the budget, and the check then passes', () => {
    writeFileSync(statsFile(), JSON.stringify([stat('/', 1024 * 100), stat('/a', 1024 * 50)]));
    expect(run(['--stats', statsFile(), '--budget', budgetFile(), '--update'], log, err)).toBe(0);
    expect(JSON.parse(readFileSync(budgetFile(), 'utf8')).routes).toEqual({ '/': 105, '/a': 53 });
    expect(run(['--stats', statsFile(), '--budget', budgetFile()], log, err)).toBe(0);
    expect(out.join('\n')).toMatch(/route\s+current KiB\s+budget KiB/);
    expect(errs).toEqual([]);
  });

  it('exits 1 when a route grows past the budget', () => {
    writeFileSync(budgetFile(), JSON.stringify({ routes: { '/': 100 } }));
    writeFileSync(statsFile(), JSON.stringify([stat('/', 1024 * 100 + 1)]));
    expect(run(['--stats', statsFile(), '--budget', budgetFile()], log, err)).toBe(1);
    expect(errs.join('\n')).toMatch(/over its 100\.0 KiB budget/);
  });

  it('exits 1 when the stats file is missing', () => {
    writeFileSync(budgetFile(), JSON.stringify({ routes: { '/': 100 } }));
    expect(run(['--stats', statsFile(), '--budget', budgetFile()], log, err)).toBe(1);
    expect(errs.join('\n')).toMatch(/not found\. Run `pnpm build`/);
  });

  it('exits 1 when the first-load field is missing from the stats', () => {
    writeFileSync(budgetFile(), JSON.stringify({ routes: { '/': 100 } }));
    writeFileSync(statsFile(), JSON.stringify([{ route: '/', firstLoadChunkPaths: [] }]));
    expect(run(['--stats', statsFile(), '--budget', budgetFile()], log, err)).toBe(1);
    expect(errs.join('\n')).toMatch(/firstLoadUncompressedJsBytes/);
  });

  it('exits 1 when the budget file is missing', () => {
    writeFileSync(statsFile(), JSON.stringify([stat('/', 10)]));
    expect(run(['--stats', statsFile(), '--budget', budgetFile()], log, err)).toBe(1);
    expect(errs.join('\n')).toMatch(/--update/);
  });
});
