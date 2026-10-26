// The background worker: once a minute, continue any recording that has work to do (YouTube upload, clip, Instagram).
// It runs inside the app's own Node process, so the app must be run as a long-lived server (npm start / systemd / pm2),
// not on a serverless platform. Set PIPELINE_WORKER=0 to switch it off (for example on a second copy of the app).
import { env } from './env';
import { runTick } from './runtime';

const g = globalThis as unknown as { __worker?: { timer: ReturnType<typeof setInterval>; running: boolean } };

export function startWorker() {
  if (g.__worker || !env.workerEnabled || !process.env.DATABASE_URL) return;
  const w: { timer: ReturnType<typeof setInterval>; running: boolean } = { running: false, timer: setInterval(() => { void tick(); }, 60_000) };
  g.__worker = w;
  w.timer.unref?.();
  async function tick() {
    if (w.running) return;
    w.running = true;
    try { await runTick(20 * 60_000); } catch (e) { console.error('pipeline worker:', e instanceof Error ? e.message : e); }
    finally { w.running = false; }
  }
  setTimeout(() => { void tick(); }, 5_000).unref?.();
  console.log('pipeline worker started (every minute)');
}
