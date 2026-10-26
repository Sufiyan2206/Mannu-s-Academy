import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET = 'e2e-secret'
process.env.DATABASE_URL_NODE = process.env.TEST_DATABASE_URL_NODE ?? 'mysql://mannus:mannus@127.0.0.1:3306/mannus_node_test'

const { createApp } = await import('./app.js')
const { getPool, closePool } = await import('./db.js')
let server: Server, base = ''

before(async () => {
  const root = (await import('mysql2/promise')).default
  const c = await root.createConnection('mysql://mannus:mannus@127.0.0.1:3306/')
  await c.query('CREATE DATABASE IF NOT EXISTS mannus_node_test CHARACTER SET utf8mb4')
  await c.query('USE mannus_node_test')
  await c.query('DROP TABLE IF EXISTS users')
  await c.query("CREATE TABLE users (id INT PRIMARY KEY, role VARCHAR(10), name VARCHAR(50), active TINYINT)")
  await c.query("INSERT INTO users VALUES (1,'admin','Admin',1),(2,'teacher','Teacher',1),(3,'student','Student',1),(4,'teacher','Off',0)")
  await c.end()
  server = createApp().listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => { server.close(); await closePool() })

const token = (id: number, secret = 'e2e-secret') => jwt.sign({ sub: String(id), role: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' })
const get = (p: string, t?: string) => fetch(base + p, { headers: t ? { Authorization: `Bearer ${t}` } : {} })

test('health reports the MySQL connection', async () => {
  const r = await get('/health'); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, service: 'integrations' })
})
test('tokens issued by the Flask API are accepted, and roles are enforced from the database', async () => {
  assert.equal((await get('/internal/status')).status, 401)
  assert.equal((await get('/internal/status', token(1, 'wrong-secret'))).status, 401)
  assert.equal((await get('/internal/status', token(1))).status, 200)
  assert.equal((await get('/internal/status', token(2))).status, 200)
  assert.equal((await get('/internal/status', token(3))).status, 403)
  assert.equal((await get('/internal/status', token(4))).status, 401)
  assert.equal((await get('/internal/status', token(99))).status, 401)
})
test('unknown routes return a clear JSON error', async () => { const r = await get('/nope'); assert.equal(r.status, 404); assert.deepEqual(await r.json(), { error: 'Not found.' }) })
test('pool can run queries', async () => { const [r] = await getPool().query('SELECT COUNT(*) AS n FROM users'); assert.equal((r as { n: number }[])[0].n, 4) })
