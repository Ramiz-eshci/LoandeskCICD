'use strict';

const portfolio = require('../services/portfolio.service');

const DAY_MS = 24 * 60 * 60 * 1000;

function nextEightUtc() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

async function run() {
  const out = await portfolio.markPendingOverdue();
  if (out.updated) console.log(`[portfolio] marked ${out.updated} follow-ups overdue; notifications=${out.notified}`);
  try {
    const sched = await portfolio.notifyDueContactMilestones();
    if (sched.notified) console.log(`[portfolio] contact-milestone prompts sent=${sched.notified}`);
  } catch (err) {
    console.error('[portfolio] contact-milestone prompt failed:', err.message);
  }
  return out;
}

function startPortfolioFollowupJob() {
  const scheduleNext = () => {
    const wait = nextEightUtc().getTime() - Date.now();
    const timer = setTimeout(async () => {
      try { await run(); } catch (err) { console.error('[portfolio] follow-up job failed:', err.message); }
      const daily = setInterval(() => run().catch((err) => console.error('[portfolio] follow-up job failed:', err.message)), DAY_MS);
      if (daily.unref) daily.unref();
    }, wait);
    if (timer.unref) timer.unref();
  };
  scheduleNext();
  console.log('[portfolio] follow-up job scheduled daily at 08:00 UTC');
}

module.exports = { startPortfolioFollowupJob, run };
