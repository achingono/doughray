import cron from 'node-cron';
import { enqueueBankSync } from '@doughray/shared';
import prisma from './lib/prisma';
import { startSyncQueue } from './jobs/sync-queue';
import { categorizeTransactions } from './jobs/categorize-transactions';
import { generateMonthlyReport, takeNetWorthSnapshot } from './jobs/generate-reports';
import { valuateAssets } from './jobs/valuate-assets';
import { updateGoalProgress } from './jobs/update-goal-progress';
import { backfillHistoricalSnapshots } from './jobs/backfill-snapshots';

console.log('[Worker] Starting cron scheduler...');

// Keep strong references to scheduled tasks so cron timers are not
// garbage-collected and the worker process remains alive between runs.
const scheduledTasks = [] as ReturnType<typeof cron.schedule>[];
startSyncQueue();

// Import transactions every 6 hours
scheduledTasks.push(cron.schedule('0 */6 * * *', async () => {
  console.log('[Worker] Running: Import Transactions');
  try {
    await enqueueBankSync(prisma, { jobType: 'SIMPLEFIN_IMPORT', trigger: 'SCHEDULED' });
  } catch (err) {
    console.error('[Worker] Import job failed:', err);
  }
}));

scheduledTasks.push(cron.schedule('0 */6 * * *', async () => {
  try {
    const connections = await prisma.bankConnection.findMany({ where: { provider: 'PLAID', status: 'HEALTHY', pausedAt: null }, select: { id: true } });
    for (const connection of connections) await enqueueBankSync(prisma, { jobType: 'CONNECTION_SYNC', trigger: 'SCHEDULED', connectionId: connection.id });
  } catch (err) { console.error('[Worker] Failed to schedule bank sync:', err); }
}));

// Categorize transactions 15 minutes after each import
scheduledTasks.push(cron.schedule('15 */6 * * *', async () => {
  console.log('[Worker] Running: Categorize Transactions');
  try {
    await categorizeTransactions();
  } catch (err) {
    console.error('[Worker] Categorize job failed:', err);
  }
}));

// Generate monthly report on the 1st of each month at 6 AM
scheduledTasks.push(cron.schedule('0 6 1 * *', async () => {
  console.log('[Worker] Running: Generate Monthly Report');
  try {
    await generateMonthlyReport();
  } catch (err) {
    console.error('[Worker] Report job failed:', err);
  }
}));

// Backfill one 90-day window per account every 6 hours
scheduledTasks.push(cron.schedule('30 */6 * * *', async () => {
  console.log('[Worker] Running: Backfill Transactions');
  try {
    await enqueueBankSync(prisma, { jobType: 'SIMPLEFIN_BACKFILL', trigger: 'SCHEDULED' });
  } catch (err) {
    console.error('[Worker] Backfill job failed:', err);
  }
}));

// Categorize backfilled transactions 15 minutes after each backfill run
scheduledTasks.push(cron.schedule('45 */6 * * *', async () => {
  console.log('[Worker] Running: Categorize Backfilled Transactions');
  try {
    await categorizeTransactions();
  } catch (err) {
    console.error('[Worker] Backfill categorize job failed:', err);
  }
}));

// Take net worth snapshot daily at midnight
scheduledTasks.push(cron.schedule('0 0 * * *', async () => {
  console.log('[Worker] Running: Net Worth Snapshot');
  try {
    await takeNetWorthSnapshot();
  } catch (err) {
    console.error('[Worker] Snapshot job failed:', err);
  }
}));

// Update goal progress daily at 12:05 AM (after snapshot)
scheduledTasks.push(cron.schedule('5 0 * * *', async () => {
  console.log('[Worker] Running: Update Goal Progress');
  try {
    await updateGoalProgress();
  } catch (err) {
    console.error('[Worker] Goal progress job failed:', err);
  }
}));

// Valuate assets weekly on Sundays at 3 AM
scheduledTasks.push(cron.schedule('0 3 * * 0', async () => {
  console.log('[Worker] Running: Valuate Assets');
  try {
    await valuateAssets();
  } catch (err) {
    console.error('[Worker] Asset valuation job failed:', err);
  }
}));

// Run initial import on startup (after 10 second delay)
setTimeout(async () => {
  console.log('[Worker] Running initial import...');
  try {
    await enqueueBankSync(prisma, { jobType: 'SIMPLEFIN_IMPORT', trigger: 'STARTUP' });
    await enqueueBankSync(prisma, { jobType: 'SIMPLEFIN_BACKFILL', trigger: 'STARTUP' });
    await backfillHistoricalSnapshots();
    await takeNetWorthSnapshot();
    await updateGoalProgress();
  } catch (err) {
    console.error('[Worker] Initial run failed:', err);
  }
}, 10000);

console.log('[Worker] Cron jobs scheduled:');
console.log('  - Import transactions: every 6 hours (0 */6 * * *)');
console.log('  - Categorize: 15 min after import (15 */6 * * *)');
console.log('  - Monthly report: 1st of month at 6AM (0 6 1 * *)');
console.log('  - Backfill (90-day windows): every 6 hours at :30 (30 */6 * * *)');
console.log('  - Categorize backfilled transactions: every 6 hours at :45 (45 */6 * * *)');
console.log('  - Net worth snapshot: daily at midnight (0 0 * * *)');
console.log('  - Snapshot backfill: one-time on startup (last 90-365 days)');
console.log('  - Update goal progress: daily at 12:05 AM (5 0 * * *)');
console.log('  - Valuate assets: weekly on Sundays at 3 AM (0 3 * * 0)');
console.log(`[Worker] Registered ${scheduledTasks.length} cron task(s)`);

// node-cron can leave the event loop empty between scheduled runs depending on
// timer internals. Keep one lightweight ref'ed timer alive so the worker stays
// resident and cron callbacks continue to fire.
const keepAliveTimer = setInterval(() => {
  // Intentionally empty.
}, 60 * 60 * 1000);

void keepAliveTimer;

// Keep process alive
process.on('SIGTERM', () => {
  console.log('[Worker] Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Worker] Received SIGINT, shutting down...');
  process.exit(0);
});
