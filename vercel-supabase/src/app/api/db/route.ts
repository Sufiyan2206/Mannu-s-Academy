import { HttpError, jsonError, requireUser } from '@/lib/server/admin';
import { runPlan } from '@/lib/server/sqlplan';
import type { Plan } from '@/lib/dbplan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPS = new Set(['select', 'insert', 'update', 'delete', 'upsert', 'rpc']);
const FILTERS = new Set(['eq', 'neq', 'in', 'lt', 'lte', 'gt', 'gte', 'ilike', 'isnull', 'notnull']);

/** The browser sends a query plan (never SQL). It runs as the signed-in person, so row level security decides what is allowed. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const p = (await req.json()) as Plan;
    if (!p || !OPS.has(p.op) || !Array.isArray(p.filters) || !Array.isArray(p.orders) || p.filters.some(f => !FILTERS.has(f.op) || typeof f.col !== 'string')) throw new HttpError(400, 'Bad request.');
    return Response.json(await runPlan({ ...p, filters: p.filters, orders: p.orders }, { userId: me.id, browser: true }));
  } catch (e) { return jsonError(e); }
}
