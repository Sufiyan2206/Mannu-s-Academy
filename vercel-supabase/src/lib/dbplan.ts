// A tiny query builder with the same shape as the one the screens were written against (from().select().eq()...).
// It does not touch the database itself: it only records WHAT is wanted as a plain "plan". In the browser the plan is sent
// to /api/db; on the server it is turned into SQL (see server/sqlplan.ts). The browser never sends SQL.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Row = Record<string, any>;
export type FilterOp = 'eq' | 'neq' | 'in' | 'lt' | 'lte' | 'gt' | 'gte' | 'ilike' | 'isnull' | 'notnull';
export interface Filter { col: string; op: FilterOp; val?: any }
export interface Plan {
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc';
  table?: string; rpc?: string; args?: Row;
  filters: Filter[]; payload?: Row | Row[]; orders: [string, boolean][];
  limit?: number; range?: [number, number]; one?: 'single' | 'maybe'; returning: boolean; onConflict?: string;
}
export interface DbError { message: string; code?: string }
export interface Result { data: any; error: DbError | null }
export type Exec = (plan: Plan) => Promise<Result>;

export class Query implements PromiseLike<Result> {
  private plan: Plan;
  constructor(table: string, private exec: Exec) { this.plan = { op: 'select', table, filters: [], orders: [], returning: false }; }
  select(_columns?: string) { this.plan.returning = true; return this; }
  insert(payload: Row | Row[]) { this.plan.op = 'insert'; this.plan.payload = payload; return this; }
  update(payload: Row) { this.plan.op = 'update'; this.plan.payload = payload; return this; }
  upsert(payload: Row | Row[], opts?: { onConflict?: string }) { this.plan.op = 'upsert'; this.plan.payload = payload; this.plan.onConflict = opts?.onConflict; return this; }
  delete() { this.plan.op = 'delete'; return this; }
  eq(col: string, val: any) { return this.f(col, 'eq', val); }
  neq(col: string, val: any) { return this.f(col, 'neq', val); }
  in(col: string, val: any[]) { return this.f(col, 'in', val); }
  lt(col: string, val: any) { return this.f(col, 'lt', val); }
  lte(col: string, val: any) { return this.f(col, 'lte', val); }
  gt(col: string, val: any) { return this.f(col, 'gt', val); }
  gte(col: string, val: any) { return this.f(col, 'gte', val); }
  ilike(col: string, val: string) { return this.f(col, 'ilike', val); }
  not(col: string, op: 'is', val: null) { void op; void val; return this.f(col, 'notnull'); }
  is(col: string, val: null) { void val; return this.f(col, 'isnull'); }
  order(col: string, o?: { ascending?: boolean }) { this.plan.orders.push([col, o?.ascending !== false]); return this; }
  limit(n: number) { this.plan.limit = n; return this; }
  range(a: number, b: number) { this.plan.range = [a, b]; return this; }
  single() { this.plan.one = 'single'; this.plan.returning = true; return this; }
  maybeSingle() { this.plan.one = 'maybe'; this.plan.returning = true; return this; }
  private f(col: string, op: FilterOp, val?: any) { this.plan.filters.push({ col, op, val }); return this; }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.exec(this.plan).then(ok, bad);
  }
}

export const rpcPlan = (name: string, args: Row): Plan => ({ op: 'rpc', rpc: name, args, filters: [], orders: [], returning: true });
