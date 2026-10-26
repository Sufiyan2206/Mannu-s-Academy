import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { getPool } from './db.js'

export interface AuthedUser { id: number; role: 'admin' | 'teacher' | 'student'; name: string }
declare module 'express-serve-static-core' { interface Request { user?: AuthedUser } }

/** Accepts the token issued by the Flask API and re-checks the account in MySQL on every request. */
export function requireRole(...roles: AuthedUser['role'][]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const h = req.header('Authorization') ?? ''
    if (!h.startsWith('Bearer ')) return void res.status(401).json({ error: 'Please sign in.' })
    try {
      const p = jwt.verify(h.slice(7), config.jwtSecret, { algorithms: ['HS256'] }) as { sub: string }
      const [rows] = await getPool().query('SELECT id, role, name, active FROM users WHERE id = ?', [Number(p.sub)])
      const u = (rows as { id: number; role: AuthedUser['role']; name: string; active: number }[])[0]
      if (!u || !u.active) return void res.status(401).json({ error: 'This account is not active.' })
      if (roles.length && !roles.includes(u.role)) return void res.status(403).json({ error: 'You do not have permission to do that.' })
      req.user = { id: u.id, role: u.role, name: u.name }
      next()
    } catch {
      res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
    }
  }
}
