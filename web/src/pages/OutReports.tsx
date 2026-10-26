import { useEffect, useState } from 'react'
import { api, METHODS, OutReport as R, PayReport, Student } from '../api'
import { useAuth } from '../auth'
import { Chip, Spinner, fmt } from '../ui'
import { dayTz, downloadCsv, money, Preset, PRESET_LABEL, presetRange } from '../lib'
import { OUT, ReportShell } from './Reports'
import { StudentFees } from './Fees'

const PAY_PRESETS: Preset[] = ['today', 'week', 'd30', 'month', 'last']

export default function OutReport({ view }: { view: string }) {
  const { cfg } = useAuth()
  const f = fmt(cfg)
  const isPay = view === 'out-payments'
  const today = dayTz(cfg!)
  const [st, setSt] = useState({ batch: '', subject: '', currency: '', school: '', student: '', period: '', method: '', from: presetRange('d30', today)[0], to: today, preset: 'd30' as Preset | 'custom' })
  const [data, setData] = useState<R | null>(null)
  const [pay, setPay] = useState<PayReport | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [schools, setSchools] = useState<{ name: string }[]>([])
  const [periods, setPeriods] = useState<string[]>([])
  const [nonce, setNonce] = useState(0)
  useEffect(() => { api<Student[]>('/students').then(setStudents); api<{ name: string }[]>('/students/schools').then(setSchools) }, [])
  useEffect(() => {
    setErr('')
    const p = new URLSearchParams(isPay ? { from: st.from, to: st.to, batch: st.batch, currency: st.currency, student_id: st.student, method: st.method } : { batch: st.batch, subject: st.subject, currency: st.currency, school: st.school, student_id: st.student, period: st.period })
    for (const [k, v] of [...p]) if (!v) p.delete(k)
    if (isPay) { setPay(null); api<PayReport>('/reports/payments?' + p).then(setPay).catch(e => setErr((e as Error).message)) }
    else { setData(null); api<R>('/reports/outstanding?' + p).then(d => { setData(d); if (d.periods.length) setPeriods(d.periods) }).catch(e => setErr((e as Error).message)) }
  }, [st.batch, st.subject, st.currency, st.school, st.student, st.period, st.method, st.from, st.to, isPay, nonce])
  const title = OUT.find(o => o[0] === view)![1]
  const filterText = [st.batch && cfg!.batches.find(b => String(b.id) === st.batch)?.name, st.subject && cfg!.subjects.find(s => String(s.id) === st.subject)?.name, st.currency, st.school && (st.school === '__none' ? 'no school entered' : st.school), st.period && 'billing month ' + st.period, st.student && students.find(s => String(s.id) === st.student)?.name, st.method && METHODS[st.method]].filter(Boolean).join(' · ') || 'All batches, subjects and students'
  const head: (string | number | null)[][] = [['Report', title], [isPay ? 'Range' : 'As of', isPay ? `${st.from} to ${st.to}` : today], ['Filters', filterText], []]
  const tbl = (h: string[], rows: JSX.Element[], right = false) => <div className="tbl"><table className="cmp"><thead><tr>{h.map((x, i) => <th key={x} style={right && i === h.length - 1 ? { textAlign: 'right' } : undefined}>{x}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>
  const dl = (name: string, rows: (string | number | null)[][]) => <div className="row wrap mt"><button className="btn" onClick={() => downloadCsv(name + '.csv', [...head, ...rows])}>Download this report (CSV)</button></div>
  const dd = (iso: string) => f.dateY(iso + 'T12:00:00Z')
  const empty = <div className="empty">Nothing is outstanding for these filters. 🎉</div>

  let body: JSX.Element | null = null, totals: JSX.Element | null = null
  if (isPay && pay) {
    body = <>
      {pay.totals.map(t => <div className="stat" style={{ marginBottom: 8 }} key={t.currency}><b style={{ fontSize: '1.2rem' }}>{money(t.amount, t.currency)}</b><span>{t.count} {t.count === 1 ? 'payment' : 'payments'} received ({t.currency})</span></div>)}
      {pay.by_method.length > 0 && <><div className="sec"><h2>By method</h2></div>{tbl(['Method', 'Payments', 'Amount'], pay.by_method.map(m => <tr key={m.currency + m.method}><td><b>{METHODS[m.method] ?? m.method}</b></td><td>{m.count}</td><td>{money(m.amount, m.currency)}</td></tr>))}</>}
      <div className="sec"><h2>Payments</h2><span className="mute small">{pay.payments.length}</span></div>
      {pay.payments.length ? <>{tbl(['Student', 'Amount'], pay.payments.map(p => <tr key={p.id}><td><b>{p.student}</b><div className="mute small">{p.receipt_no} · {f.date(p.paid_at)} · {METHODS[p.method]}{p.reference ? ' · ' + p.reference : ''}</div></td><td><b>{money(p.paid_amount, p.paid_currency)}</b>{p.paid_currency !== p.currency && <div className="mute small">= {money(p.amount, p.currency)}</div>}</td></tr>))}<p className="mute small">Voided payments are not included.</p>
        {dl(`payments-received-${st.from}-to-${st.to}`, [['Receipt', 'Date', 'Student', 'Batch', 'Method', 'Reference', 'Paid currency', 'Amount paid', 'Credited currency', 'Credited amount', 'Received by'], ...pay.payments.map(p => [p.receipt_no, f.dateY(p.paid_at), p.student, p.batch, METHODS[p.method], p.reference, p.paid_currency, p.paid_amount, p.currency, p.amount, p.received_by])])}</> : <div className="empty">No payments in this date range.</div>}
    </>
  } else if (data) {
    const o = data
    totals = view === 'out-credit' ? null : o.totals.length ? <>{o.totals.map(t => <div className="card" style={{ marginBottom: 8 }} key={t.currency}><div className="mute small">{t.currency}</div><div className="stats" style={{ margin: '6px 0 0' }}><div className="stat"><b style={{ fontSize: '1.1rem' }}>{money(t.outstanding, t.currency)}</b><span>Outstanding</span></div><div className="stat"><b style={{ fontSize: '1.1rem', color: 'var(--bad)' }}>{money(t.overdue, t.currency)}</b><span>Overdue</span></div><div className="stat"><b style={{ fontSize: '1.1rem' }}>{money(t.due_soon, t.currency)}</b><span>Due in 7 days</span></div><div className="stat"><b style={{ fontSize: '1.1rem' }}>{t.students_owing}</b><span>Students owing</span></div></div></div>)}</> : empty
    if (view === 'out-student') {
      const rows = o.students.filter(s => s.outstanding > 0).sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding || a.name.localeCompare(b.name))
      body = rows.length ? <>{tbl(['Student', 'Outstanding'], rows.map(s => <tr key={s.id} className="tap" onClick={() => setOpen(s.id)}><td><b>{s.name}</b><div className="mute small">{s.batch}{s.school ? ' · ' + s.school : ''}{s.oldest_due ? ' · oldest due ' + dd(s.oldest_due) : ''}</div></td><td><b>{money(s.outstanding, s.currency)}</b>{s.overdue > 0 ? <div><Chip kind="bad">{money(s.overdue, s.currency)} overdue</Chip></div> : s.due_soon > 0 ? <div><Chip kind="warn">Due soon</Chip></div> : null}</td></tr>), true)}<p className="mute small">Tap a student to see their fees and record a payment.</p>
        {dl('outstanding-by-student', [['Student', 'Batch', 'School', 'Guardian', 'Guardian mobile', 'Currency', 'Charged', 'Paid', 'Outstanding', 'Overdue', 'Due in 7 days', 'Oldest due date', 'Days overdue'], ...rows.map(s => [s.name, s.batch, s.school, s.guardian_name, s.guardian_mobile, s.currency, s.charged, s.paid, s.outstanding, s.overdue, s.due_soon, s.oldest_due, s.days_overdue])])}</> : <div className="empty">Nobody owes anything for these filters. 🎉</div>
    } else if (view === 'out-overdue' || view === 'out-soon') {
      const over = view === 'out-overdue'
      const rows = o.lines.filter(l => over ? l.overdue : l.due_soon).sort(over ? (a, b) => b.days_overdue - a.days_overdue || a.student.localeCompare(b.student) : (a, b) => a.due_date.localeCompare(b.due_date) || a.student.localeCompare(b.student))
      body = rows.length ? <>{tbl(['Fee', 'Outstanding'], rows.map(l => <tr key={l.charge_id} className="tap" onClick={() => setOpen(l.student_id)}><td><b>{l.student}</b><div className="mute small">{l.subject}{l.period ? ' · ' + l.period : ''} · due {dd(l.due_date)}</div></td><td><b>{money(l.outstanding, l.currency)}</b>{over && <div><Chip kind="bad">{l.days_overdue} {l.days_overdue === 1 ? 'day' : 'days'}</Chip></div>}</td></tr>), true)}
        {dl(over ? 'overdue-fees' : 'fees-due-soon', [['Student', 'Batch', 'Guardian', 'Guardian mobile', 'Fee', 'Month', 'Due date', 'Days overdue', 'Currency', 'Fee amount', 'Outstanding'], ...rows.map(l => [l.student, l.batch, l.guardian_name, l.guardian_mobile, l.subject, l.period, l.due_date, l.days_overdue, l.currency, l.amount, l.outstanding])])}</> : <div className="empty">{over ? 'No overdue fees. 🎉' : 'Nothing falls due in the next 7 days.'}</div>
    } else if (view === 'out-ageing') {
      body = o.ageing.length ? <>{o.ageing.map(ag => { const t = ag.buckets.reduce((a, b) => a + b.amount, 0) || 1; return <div key={ag.currency}><div className="sec"><h2>{ag.currency}</h2></div>{tbl(['Age', 'Students', 'Amount'], ag.buckets.map(b => <tr key={b.key}><td><b>{b.label}</b></td><td>{b.students}</td><td>{money(b.amount, ag.currency)}<div className="mute small">{Math.round(b.amount * 100 / t)}%</div></td></tr>))}</div> })}
        {dl('overdue-ageing', [['Currency', 'Age', 'Students', 'Fees', 'Amount'], ...o.ageing.flatMap(ag => ag.buckets.map(b => [ag.currency, b.label, b.students, b.lines, b.amount]))])}</> : empty
    } else if (view === 'out-batch' || view === 'out-subject' || view === 'out-month') {
      const g = view === 'out-batch' ? o.by_batch : view === 'out-subject' ? o.by_subject : o.by_period, lab = view === 'out-batch' ? 'Batch' : view === 'out-subject' ? 'Subject' : 'Month'
      body = g.length ? <>{tbl([lab, 'Outstanding'], g.map(x => <tr key={x.key + x.currency}><td><b>{x.name}</b><div className="mute small">{x.students} {x.students === 1 ? 'student' : 'students'} · {x.lines} {x.lines === 1 ? 'fee' : 'fees'}</div></td><td><b>{money(x.outstanding, x.currency)}</b>{x.overdue > 0 && <div><Chip kind="bad">{money(x.overdue, x.currency)} overdue</Chip></div>}</td></tr>), true)}
        {dl(`outstanding-by-${view.slice(4)}`, [[lab, 'Currency', 'Students', 'Fees', 'Outstanding', 'Overdue'], ...g.map(x => [x.name, x.currency, x.students, x.lines, x.outstanding, x.overdue])])}</> : empty
    } else if (view === 'out-credit') {
      const rows = o.students.filter(s => s.credit > 0).sort((a, b) => b.credit - a.credit)
      body = rows.length ? <>{o.credits.map(c => <div className="stat" style={{ marginBottom: 8 }} key={c.currency}><b style={{ fontSize: '1.2rem' }}>{money(c.credit, c.currency)}</b><span>{c.students} {c.students === 1 ? 'student has' : 'students have'} paid in advance ({c.currency})</span></div>)}
        {tbl(['Student', 'Credit'], rows.map(s => <tr key={s.id} className="tap" onClick={() => setOpen(s.id)}><td><b>{s.name}</b><div className="mute small">{s.batch} · paid {money(s.paid, s.currency)} of {money(s.charged, s.currency)} charged</div></td><td><b>{money(s.credit, s.currency)}</b></td></tr>), true)}
        {dl('credit-balances', [['Student', 'Batch', 'Currency', 'Charged', 'Paid', 'Credit'], ...rows.map(s => [s.name, s.batch, s.currency, s.charged, s.paid, s.credit])])}</> : <div className="empty">Nobody has paid more than they were charged.</div>
    }
  }
  const ready = isPay ? !!pay : !!data
  const setPreset = (p: Preset) => { const [a, b] = presetRange(p, today); setSt(s => ({ ...s, from: a, to: b, preset: p })) }
  return (
    <ReportShell id={view}>
      {isPay && <div className="seg wrapseg" role="group" aria-label="Date range">{PAY_PRESETS.map(p => <button key={p} aria-pressed={st.preset === p} onClick={() => setPreset(p)}>{PRESET_LABEL[p]}</button>)}<button aria-pressed={st.preset === 'custom'} onClick={() => setSt(s => ({ ...s, preset: 'custom' }))}>Custom</button></div>}
      <details className="fdet"><summary>Filters</summary><div className="filters" style={{ marginTop: 10 }}>
        {isPay && <><div><label htmlFor="g1">From</label><input id="g1" type="date" value={st.from} onChange={e => setSt({ ...st, from: e.target.value, preset: 'custom' })} /></div><div><label htmlFor="g2">To</label><input id="g2" type="date" value={st.to} onChange={e => setSt({ ...st, to: e.target.value, preset: 'custom' })} /></div>
          <div className="wide"><label htmlFor="g8">Payment method</label><select id="g8" value={st.method} onChange={e => setSt({ ...st, method: e.target.value })}><option value="">All methods</option>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div></>}
        <div><label htmlFor="g3">Batch</label><select id="g3" value={st.batch} onChange={e => setSt({ ...st, batch: e.target.value })}><option value="">All batches</option>{cfg!.batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        {!isPay && <div><label htmlFor="g4">Subject</label><select id="g4" value={st.subject} onChange={e => setSt({ ...st, subject: e.target.value })}><option value="">All subjects</option>{cfg!.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
        {!isPay && <div><label htmlFor="g6">School</label><select id="g6" value={st.school} onChange={e => setSt({ ...st, school: e.target.value })}><option value="">All schools</option><option value="__none">No school entered</option>{schools.map(x => <option key={x.name} value={x.name}>{x.name}</option>)}</select></div>}
        {!isPay && <div><label htmlFor="g7">Billing month</label><select id="g7" value={st.period} onChange={e => setSt({ ...st, period: e.target.value })}><option value="">All months</option>{periods.map(p => <option key={p} value={p}>{p}</option>)}</select></div>}
        <div className="wide"><label htmlFor="g9">Student</label><select id="g9" value={st.student} onChange={e => setSt({ ...st, student: e.target.value })}><option value="">All students</option>{students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      </div></details>
      {err ? <div className="alert bad">{err}</div> : !ready ? <Spinner /> : <>
        <div className="card" style={{ marginBottom: 10 }}><b>{isPay ? `${f.dateY(st.from + 'T12:00:00Z')} – ${f.dateY(st.to + 'T12:00:00Z')}` : `As of ${f.dateY(today + 'T12:00:00Z')}`}</b><div className="mute small">{filterText}</div></div>
        {totals}<div style={{ marginTop: 12 }}>{body}</div></>}
      {open && <StudentFees id={open} onClose={() => setOpen(null)} onChange={() => setNonce(n => n + 1)} />}
    </ReportShell>
  )
}
