import express from 'express'
import { requireRole } from './auth.js'
import { config } from './config.js'
import { ping } from './db.js'

export function createApp(): express.Express {
  const app = express()
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', async (_req, res) => {
    try { res.json({ ok: await ping(), service: 'integrations' }) } catch { res.status(503).json({ ok: false, service: 'integrations', error: 'Database is not reachable.' }) }
  })

  // Reports which integrations are switched on. Filled in as each stage lands.
  app.get('/internal/status', requireRole('admin', 'teacher'), (req, res) => {
    res.json({ academy: config.academy, you: req.user, integrations: { whatsapp: 'stage 3', youtube: 'stage 3', instagram: 'stage 4', video: 'stage 4' } })
  })

  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }))
  return app
}
