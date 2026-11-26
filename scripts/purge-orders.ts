/**
 * Retention purge. Usage: pnpm purge:orders [--dry-run]  (runs tsx scripts/purge-orders.ts)
 * Deletes print PDFs and unused uploads older than settings.retentionDays from DATA_DIR
 * (default ./data); orders and the designs they used are kept (orders from before KEEP_DESIGNS_FROM
 * are removed whole). Then the 7-day rule (owner 2026-11-26): designs no order used are removed
 * UNORDERED_DESIGN_DAYS after they were made, then plain uploads nothing uses. Same steps and order as
 * the cron purge: purgeOlderThan, aiPurgeUnordered, purgeUnusedUploads.
 */
import { UNORDERED_DESIGN_DAYS } from '../src/config/defaults';
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
  const unorderedCutoff = new Date(Date.now() - UNORDERED_DESIGN_DAYS * 24 * 60 * 60 * 1000);
  console.log(`${dryRun ? '[dry-run] ' : ''}Purging designs no order used, older than ${UNORDERED_DESIGN_DAYS} days (before ${unorderedCutoff.toISOString()})`);
  const designs = await storage.aiPurgeUnordered(unorderedCutoff, dryRun);
  for (const p of designs) console.log(`${dryRun ? 'would remove' : 'removed'}: ${p}`);
  const uploads = await storage.purgeUnusedUploads(unorderedCutoff, dryRun);
  for (const p of uploads) console.log(`${dryRun ? 'would remove' : 'removed'}: ${p}`);
  console.log(`${designs.length + uploads.length} item(s) ${dryRun ? 'would be removed' : 'removed'} by the 7-day rule.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
