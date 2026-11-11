import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { SUPABASE_MAX_UPLOAD_BYTES } from '@/lib/storage/supabase';

const DIR = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(DIR).filter((f) => f.includes('upload_15mb')).sort();
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
/** SQL without `--` comment lines, so the prose cannot satisfy or break an assertion. */
const sql = (f: string) =>
  read(f)
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

describe('15 MB upload migrations', () => {
  it('are two files: the bucket first, the settings row second', () => {
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/_upload_15mb_bucket\.sql$/);
    expect(files[1]).toMatch(/_upload_15mb_settings\.sql$/);
  });

  it('the bucket step only touches the bucket, the settings step only the settings row', () => {
    const [bucket, settings] = files.map(sql);
    expect(bucket).toContain('storage.buckets');
    expect(bucket).not.toContain('public.settings');
    expect(settings).toContain('public.settings');
    expect(settings).not.toContain('storage.buckets');
  });

  it('both use the same bytes as the code', () => {
    expect(DEFAULT_SETTINGS.maxUploadBytes).toBe(15_728_640);
    expect(SUPABASE_MAX_UPLOAD_BYTES).toBe(15_728_640);
    for (const f of files) expect(sql(f)).toContain(String(SUPABASE_MAX_UPLOAD_BYTES));
  });

  it('the settings step only ever raises the stored limit', () => {
    expect(sql(files[1])).toMatch(/< 15728640/);
  });

  it('the rollout order is written in both files', () => {
    for (const f of files) expect(read(f)).toMatch(/after the deploy|AFTER/i);
  });
});
