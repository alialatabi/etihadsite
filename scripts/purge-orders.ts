/**
 * Retention purge. Usage: pnpm purge:orders [--dry-run]  (runs tsx scripts/purge-orders.ts)
 * Deletes print PDFs and unused uploads older than settings.retentionDays from DATA_DIR
 * (default ./data); orders and their designs are kept (orders from before KEEP_DESIGNS_FROM
 * are removed whole). Same rules as the cron purge: LocalStorage.purgeOlderThan.
 */
import { LocalStorage } from '../src/lib/storage/local';

try {
  process.loadEnvFile('.env.local');
} catch {
  /* no .env.local */
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const storage = new LocalStorage(process.env.DATA_DIR?.trim() || './data');
  const settings = await storage.getSettings();
  const cutoff = new Date(Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000);
  console.log(`${dryRun ? '[dry-run] ' : ''}Purging files older than ${settings.retentionDays} days (before ${cutoff.toISOString()})`);
  const removed = await storage.purgeOlderThan(cutoff, dryRun);
  for (const p of removed) console.log(`${dryRun ? 'would remove' : 'removed'}: ${p}`);
  console.log(`${removed.length} file(s) ${dryRun ? 'would be removed' : 'removed'}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
