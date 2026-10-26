import mysql from 'mysql2/promise'
import { config } from './config.js'

let pool: mysql.Pool | null = null
export function getPool(): mysql.Pool {
  if (!pool) pool = mysql.createPool({ uri: config.databaseUrl, connectionLimit: 8, timezone: 'Z', dateStrings: false, charset: 'utf8mb4' })
  return pool
}
export async function closePool(): Promise<void> { if (pool) { await pool.end(); pool = null } }
export async function ping(): Promise<boolean> { const [r] = await getPool().query('SELECT 1 AS ok'); return (r as { ok: number }[])[0].ok === 1 }
