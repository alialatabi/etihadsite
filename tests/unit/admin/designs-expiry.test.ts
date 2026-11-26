import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { daysUntilDeletion } from '@/app/admin/designs/expiry';
import { PURGE_CRON_UTC, UNORDERED_DESIGN_DAYS } from '@/config/defaults';

describe('PURGE_CRON_UTC', () => {
  it('matches the cron schedule in vercel.json', () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as { crons: { path: string; schedule: string }[] };
    const cron = vercel.crons.find((c) => c.path === '/api/cron/purge');
    expect(cron?.schedule).toBe(`${PURGE_CRON_UTC.minute} ${PURGE_CRON_UTC.hour} * * *`);
  });
});

describe('daysUntilDeletion (Baghdad calendar days to the first purge run at or after created + 7 days)', () => {
  it('the retention is the 7 days the tests below assume', () => {
    expect(UNORDERED_DESIGN_DAYS).toBe(7);
  });

  it('counts the days to the daily run, not whole 24 h periods', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    // due 12-03 11:00Z, the next run is 12-04 01:30Z (04:30 Baghdad) = 8 shop days away
    expect(daysUntilDeletion('2026-11-26T11:00:00Z', now)).toBe(8);
    // due 11-30 12:00Z -> run 12-01 01:30Z = 5 days away
    expect(daysUntilDeletion('2026-11-23T12:00:00Z', now)).toBe(5);
  });

  it('due just before the run hour goes at that run; due just after it waits for the next day', () => {
    // Hobby cron may fire anywhere in 01:00-01:59 UTC: the earliest instant (01:00Z) is used.
    // created 11-19 00:59Z: due 11-26 00:59Z, run 11-26 01:00Z
    expect(daysUntilDeletion('2026-11-19T00:59:00Z', new Date('2026-11-25T12:00:00Z'))).toBe(1);
    // created 11-19 01:01Z: due 11-26 01:01Z, run 11-27 01:00Z
    expect(daysUntilDeletion('2026-11-19T01:01:00Z', new Date('2026-11-25T12:00:00Z'))).toBe(2);
    // exactly at the run hour counts as that run
    expect(daysUntilDeletion('2026-11-19T01:00:00Z', new Date('2026-11-25T12:00:00Z'))).toBe(1);
  });

  it('the last day reads 0, also before the run time of that very day', () => {
    // run 11-26 01:30Z; now is 11-26 00:10Z (03:10 Baghdad) = still before it
    expect(daysUntilDeletion('2026-11-19T01:00:00Z', new Date('2026-11-26T00:10:00Z'))).toBe(0);
    // due 11-26 02:00Z -> run 11-27 01:30Z; asked on 11-26 12:00Z it is tomorrow
    expect(daysUntilDeletion('2026-11-19T02:00:00Z', new Date('2026-11-26T12:00:00Z'))).toBe(1);
  });

  it('compares Baghdad calendar days: after 21:00 UTC "today" is already the next shop day', () => {
    // run 11-27 01:30Z = Baghdad 11-27 04:30. At 11-26 20:59Z it is Baghdad 11-26 23:59 -> 1 day;
    // at 11-26 21:00Z Baghdad has turned to 11-27 -> 0 days.
    const created = '2026-11-20T01:00:00Z'; // due 11-27 01:00Z -> run 11-27 01:30Z
    expect(daysUntilDeletion(created, new Date('2026-11-26T20:59:00Z'))).toBe(1);
    expect(daysUntilDeletion(created, new Date('2026-11-26T21:00:00Z'))).toBe(0);
  });

  it('overdue stays 0; an invalid date has no pill', () => {
    expect(daysUntilDeletion('2026-01-01T00:00:00Z', new Date('2026-11-26T12:00:00Z'))).toBe(0);
    expect(daysUntilDeletion('not a date', new Date('2026-11-26T12:00:00Z'))).toBeNull();
  });

  it('honours another retention', () => {
    // due 11-27 11:00Z -> run 11-28 01:30Z
    expect(daysUntilDeletion('2026-11-26T11:00:00Z', new Date('2026-11-26T12:00:00Z'), 1)).toBe(2);
  });
});
