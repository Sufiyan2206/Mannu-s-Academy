import type { Config } from './api'

export const money = (v: number, cur: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, currencyDisplay: 'code' }).format(v).replace(/\u00a0/g, ' ')
export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const dayTz = (cfg: Config, offset = 0) => addDays(new Intl.DateTimeFormat('sv-SE', { timeZone: cfg.tz }).format(new Date()), offset)

export type Preset = 'today' | 'week' | 'd7' | 'd30' | 'month' | 'last'
export const PRESET_LABEL: Record<Preset, string> = { today: 'Today', week: 'This week', d7: 'Last 7 days', d30: 'Last 30 days', month: 'This month', last: 'Last month' }
export function presetRange(p: Preset, today: string): [string, string] {
  if (p === 'today') return [today, today]
  if (p === 'week') { const wd = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7; return [addDays(today, -wd), today] }
  if (p === 'd7') return [addDays(today, -6), today]
  if (p === 'd30') return [addDays(today, -29), today]
  if (p === 'month') return [today.slice(0, 8) + '01', today]
  const e = addDays(today.slice(0, 8) + '01', -1); return [e.slice(0, 8) + '01', e]
}

export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }   // also blocks spreadsheet formula injection
  const blob = new Blob(['\ufeff' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export const pctClass = (p: number | null) => p == null ? '' : p < 60 ? 'bad' : p < 80 ? 'warn' : 'ok'
