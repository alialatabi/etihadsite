import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'supabase', 'migrations');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
/** SQL without `--` comment lines, so the prose cannot satisfy or break an assertion. */
const sql = (f: string) =>
  read(f)
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .toLowerCase();

const FILE = '20261126000000_staff_designer.sql';

describe('staff designer migration', () => {
  const s = sql(FILE);

  it('creates the account table with RLS on, no policies and nothing for the public roles', () => {
    expect(s).toContain('create table if not exists public.staff_accounts');
    expect(s).toContain('phone               text not null unique');
    expect(s).toContain('password_hash       text not null');
    expect(s).toContain('enable row level security');
    expect(s).toContain('revoke all on public.staff_accounts from anon, authenticated');
    expect(s).not.toContain('create policy');
  });

  it('widens the ai_usage kind check to the four kinds', () => {
    expect(s).toContain('drop constraint if exists ai_usage_kind_check');
    expect(s).toContain("check (kind in ('image', 'brief', 'staff_image', 'staff_brief'))");
  });

  it('adds the generation columns and the staff index idempotently', () => {
    expect(s).toContain('add column if not exists instructions');
    expect(s).toContain('add column if not exists staff_id');
    expect(s).toContain('ai_generations_staff_id_idx');
  });

  it('leaves the applied AI designer migration untouched', () => {
    expect(sql('20261121000000_ai_designer.sql')).toContain("check (kind in ('image', 'brief'))");
  });
});
