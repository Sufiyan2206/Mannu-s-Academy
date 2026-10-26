import { config } from './config.js'

/**
 * Background workers. The Flask API never calls WhatsApp, Instagram or YouTube itself: it writes a row
 * (for example into the message outbox) and these workers pick it up from MySQL, send it, and record the result.
 * Stage 3 adds the WhatsApp and YouTube workers, stage 4 the Reels and video workers.
 */
export function startWorkers(): () => void {
  if (!config.workersEnabled) return () => {}
  const timers: NodeJS.Timeout[] = []
  return () => timers.forEach(clearInterval)
}
