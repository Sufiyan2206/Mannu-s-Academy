// Runs once when the server starts: switch on the background worker for the video pipeline.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWorker } = await import('./lib/server/worker');
    startWorker();
  }
}
