import { createApp } from './app.js'
import { assertConfig, config } from './config.js'
import { closePool } from './db.js'
import { startWorkers } from './workers.js'

assertConfig()
const server = createApp().listen(config.port, () => console.log(`Integrations service on :${config.port}`))
const stop = startWorkers()
const shutdown = async () => { stop(); server.close(); await closePool(); process.exit(0) }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown)
