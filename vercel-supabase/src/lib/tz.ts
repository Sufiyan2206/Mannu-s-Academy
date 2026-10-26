// Time-zone helpers. All timestamps are stored in UTC; people see and type them in the academy time zone.
export function tzOffsetMs(tz: string, ts: number): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ts)).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}

/** "2026-03-01T17:00" typed in the given zone -> UTC ISO string (null when the text is not a date-time). */
export function zonedToUtc(local: string | null | undefined, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || '');
  if (!m) return null;
  const g = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ts = g - tzOffsetMs(tz, g);
  ts = g - tzOffsetMs(tz, ts);
  return new Date(ts).toISOString();
}

/** "2026-03-01" plus n days (calendar arithmetic, no time zone involved). */
export function addDays(d: string, n: number): string {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

export function dateInTz(iso: string | number | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function isValidTz(tz: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}
