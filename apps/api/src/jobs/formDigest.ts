import { runDigestTick } from '../services/formNotifications.js';

/**
 * Forms daily-digest sweep. Ticks every 15 minutes; services/formNotifications
 * decides per form whether its workspace-local digest hour has arrived and
 * claims the window with a compare-and-set on `forms.last_digest_at`, so
 * multiple API containers never double-send. Same setInterval + `.unref()`
 * pattern as jobs/timeReminders.
 */
const TICK_INTERVAL_MS = 15 * 60 * 1000;

async function tick(): Promise<void> {
  try {
    const r = await runDigestTick();
    if (r.emails > 0) console.log(`[forms-digest] ${r.forms} forms · ${r.emails} emails`);
  } catch (e) {
    console.error('[forms-digest] tick failed', e);
  }
}

export function startFormDigestSweep(): void {
  setTimeout(() => {
    void tick();
  }, 25_000).unref();
  setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS).unref();
}
