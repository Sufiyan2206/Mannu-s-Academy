// Typed client for the Flask API. The sign-in token is kept in this browser only.
export type Role = 'admin' | 'teacher' | 'student'
export interface User { id: number; email: string; name: string; role: Role; phone: string; student_id: number | null }
export interface Subject { id: number; code: string; name: string }
export interface Batch { id: number; name: string; active?: boolean | number; students?: number }
export interface Config { academy: string; tz: string; currency: string; subjects: Subject[]; batches: Batch[]; late_after_min: number; min_percent: number; zoom?: boolean }
export interface Student {
  id: number; name: string; email: string; zoom_email: string; mobile: string; guardian_name: string; guardian_mobile: string; guardian_email: string
  school: string; batch_id: number; batch: string; currency: string; active: boolean; subjects: { id: number; name: string }[]; has_login: boolean; reel_consent: string
}
export type AStatus = 'present' | 'late' | 'absent'
export interface ClassRow {
  id: number; title: string; agenda: string; batch_id: number; batch: string; subject_id: number; subject: string; teacher_id: number | null; teacher_name: string | null
  start_at: string; end_at: string; duration_min: number; status: 'scheduled' | 'cancelled'; cancel_reason: string; join_url: string; started: boolean; finished: boolean
  attendance_taken: boolean; can_edit: boolean; present?: number; late?: number; recorded?: number
}
export interface AttRow { student_id: number; student_name: string; status: AStatus; join_time: string | null; leave_time: string | null; duration_sec: number | null; source: 'zoom' | 'manual'; note: string
  created_by_name: string | null; updated_by_name: string | null; created_at: string; updated_at: string }
export interface ZoomRow { student_id: number; status: AStatus; join_time: string | null; leave_time: string | null; duration_sec: number | null; synced_at: string }
export interface AuditRow { id: number; student_name: string; changed_by_name: string; changed_at: string; old_value: { status: AStatus } | null; new_value: { status: AStatus; note?: string }; reason: string }
export interface ClassDetail extends ClassRow {
  students?: { id: number; name: string; email: string }[]; attendance?: AttRow[]; zoom_attendance?: ZoomRow[]; audit?: AuditRow[]; late_after_min?: number; unmatched?: { name: string; email: string; duration_sec: number }[]; has_zoom?: boolean
  my_attendance?: { status: AStatus; note: string } | null
}
export interface Dashboard {
  role: Role; today?: ClassRow[]; pending_attendance?: number; students?: number; week_classes?: number
  upcoming?: ClassRow[]; attendance?: { held: number; attended: number; percent: number | null }
}

const KEY = 'mannus.token'
export const token = { get: () => localStorage.getItem(KEY), set: (t: string) => localStorage.setItem(KEY, t), clear: () => localStorage.removeItem(KEY) }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const t = token.get()
  let r: Response
  try {
    r = await fetch('/api' + path, { method: opts.method ?? 'GET', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.')
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    if (r.status === 401 && t) { token.clear(); window.dispatchEvent(new Event('mannus:signed-out')) }
    throw new ApiError(r.status, (j as { error?: string }).error ?? `Something went wrong (${r.status}).`)
  }
  return j as T
}

// ---------- stage 2 ----------
export interface FeeSummary { id: number; name: string; batch: string; currency: string; charged: number; paid: number; balance: number; overdue: number; due_soon: number; next_due: string | null }
export interface ChargeLine { id: number; subject_id: number | null; period: string | null; description: string; due_date: string; amount: number; paid: number; outstanding: number }
export interface Payment { id: number; receipt_no: string; student_id: number; currency: string; amount: number; paid_currency: string; paid_amount: number; rate: number; method: string; reference: string; note: string; paid_at: string; received_by: string | null; voided: boolean; void_reason: string; student?: string; batch?: string }
export interface Statement { student: { id: number; name: string; batch: string }; currency: string; charged: number; paid: number; balance: number; overdue: number; due_soon: number; next_due: string | null; charges: ChargeLine[]; payments: Payment[] }
export interface Rate { id: number; subject_id: number; subject: string; batch_id: number | null; batch: string | null; student_id: number | null; student: string | null; currency: string; amount: number }
export const METHODS: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', card: 'Card', online: 'Online', cheque: 'Cheque', other: 'Other' }

export interface AttSummary { classes: number; records: number; present: number; late: number; absent: number; percent: number | null }
export interface AttStudent { student_id: number; name: string; school: string; batch: string; held: number; present: number; late: number; absent: number; percent: number | null }
export interface AttByClass { class_id: number; start_at: string; subject: string; batch: string; present: number; late: number; absent: number; percent: number | null }
export interface AttRecord { class_id: number; student: string; school: string; start_at: string; subject: string; batch: string; status: AStatus; join_time: string | null; leave_time: string | null; duration_sec: number | null; source: string; note: string }
export interface AttReport {
  summary: AttSummary; students: AttStudent[]; by_class: AttByClass[]; records?: AttRecord[]; absences?: AttRecord[]
  register?: { classes: { class_id: number; start_at: string; subject: string }[]; rows: { student_id: number; name: string; percent: number | null; cells: Record<string, AStatus> }[]; truncated: boolean }
  missing?: { class_id: number; start_at: string; subject: string; batch: string }[]
}
export interface OutLine { charge_id: number; student_id: number; student: string; batch: string; subject: string; period: string; due_date: string; currency: string; amount: number; outstanding: number; days_overdue: number; overdue: boolean; due_soon: boolean; guardian_name: string; guardian_mobile: string }
export interface OutStudent { id: number; name: string; batch: string; school: string; currency: string; charged: number; paid: number; balance: number; credit: number; outstanding: number; overdue: number; due_soon: number; oldest_due: string | null; days_overdue: number; guardian_name: string; guardian_mobile: string }
export interface OutGroup { key: string | number; name: string; currency: string; outstanding: number; overdue: number; lines: number; students: number }
export interface OutReport {
  today: string; students: OutStudent[]; lines: OutLine[]; periods: string[]; by_batch: OutGroup[]; by_subject: OutGroup[]; by_period: OutGroup[]
  ageing: { currency: string; buckets: { key: string; label: string; amount: number; lines: number; students: number }[] }[]
  totals: { currency: string; outstanding: number; overdue: number; due_soon: number; students_owing: number }[]; credits: { currency: string; credit: number; students: number }[]
}
export interface PayReport { payments: (Payment & { student: string; batch: string })[]; totals: { currency: string; amount: number; count: number }[]; by_method: { currency: string; method: string; amount: number; count: number }[] }

export interface ParentFee { subject_id: number; subject: string; current: boolean; billed: boolean; amount: number | null; outstanding: number | null; due_date: string | null; state: string; label: string }
export interface ParentData {
  academy: string; contact: string; month: string; month_label: string; student: { id: number; name: string; batch: string }; subject: { id: number; name: string }; teacher: string
  rows: { class_id: number; date: string; time: string; status: string; label: string }[]
  summary: { planned: number; held: number; attended: number; missed: number; late: number; cancelled: number; pending: number; not_recorded: number; upcoming: number; percent: number | null }
  fee: { currency: string; classes: number; month_fees: ParentFee[]; month: { subjects: number; billed: number; total: number; paid: number; outstanding: number; state: string; label: string; due_date: string | null }
    owed: { total: number; previous: number; this_month: number; later: number; as_of: string; lines: { period_label: string; subject: string; outstanding: number; due_date: string; overdue: boolean }[] } }
  note: string; hash: string; generated_label: string
}
export interface ParentSend { id: number; channel: 'whatsapp' | 'email'; recipient: string; mode: string; status: string; error: string | null; sent_by: string | null; created_at: string; summary: { held: number; attended: number } | null }
export interface ParentPreview { data: ParentData; warnings: string[]; recipients: { whatsapp: { to: string; registered: boolean; ok: boolean; note: string }; email: { to: string; registered: boolean; ok: boolean; note: string } }; pdf_url: string; file_name: string; history: ParentSend[] }
export interface ParentRow { student_id: number; name: string; batch: string; subject_id: number; subject: string; summary: ParentData['summary']; fee_state: string; fee_label: string; owes: number; owes_previous: number; currency: string; warnings: number; last_send: { channel: string; status: string; created_at: string; sent_by: string | null } | null; can_whatsapp: boolean; can_email: boolean }
