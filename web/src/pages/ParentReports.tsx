import { FormEvent, useCallback, useEffect, useState } from 'react'
import { api, ParentData, ParentPreview, ParentRow, ParentSend } from '../api'
import { useAuth } from '../auth'
import { Chip, Modal, Spinner, fmt, useToast } from '../ui'
import { dayTz, money } from '../lib'
import { ReportShell } from './Reports'

const FEE_CHIP: Record<string, string> = { paid: 'ok', part: 'warn', due: 'bad', not_billed: '' }
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()
const shortDue = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'))

export function ReportCard({ d }: { d: ParentData }) {
  const { cfg } = useAuth()
  const f = fmt(cfg)
  const cur = d.fee.currency, m = d.fee.month, multi = m.subjects > 1, s = d.summary, o = d.fee.owed
  const extra = [s.cancelled && `${s.cancelled} ${s.cancelled === 1 ? 'class was' : 'classes were'} cancelled and ${s.cancelled === 1 ? 'is' : 'are'} not counted.`, s.late && `${s.late} of the attended classes ${s.late === 1 ? 'was' : 'were'} joined late.`, s.pending && `${s.pending} ${s.pending === 1 ? 'class is' : 'classes are'} not yet recorded or still to come.`].filter(Boolean).join(' ')
  const fnote = m.state === 'part' ? `${money(m.paid, cur)} received · ${money(m.outstanding, cur)} due` : m.state === 'due' ? `${money(m.outstanding, cur)} due${m.due_date ? ' · ' + shortDue(m.due_date) : ''}` : m.state === 'paid' ? 'Thank you' : ''
  const bits = [o.previous > 0 && `${money(o.previous, cur)} is from earlier months`, o.later > 0 && `${money(o.later, cur)} is for later months`].filter(Boolean).join(' · ')
  return (
    <div className="prv">
      <div className="prv-h"><img src="/brand/logo-emblem-64.webp" alt="" width={40} height={36} /><div><b>{d.academy}</b><span>Monthly Attendance Report</span></div></div>
      <div className="prv-b">
        <div className="prv-l">Student</div><div className="prv-n">{d.student.name}</div>
        <dl className="prv-i"><dt>Month</dt><dd>{d.month_label}</dd><dt>Subject</dt><dd>{d.subject.name}</dd><dt>Class</dt><dd>{d.student.batch}</dd>{d.teacher && <><dt>Teacher</dt><dd>{d.teacher}</dd></>}</dl>
        <h4>Summary</h4>
        <div className="prv-t"><div><b>{s.held}</b><span>Classes held</span></div><div><b style={{ color: 'var(--ok)' }}>{s.attended}</b><span>Attended</span></div><div><b style={{ color: s.missed ? 'var(--bad)' : 'inherit' }}>{s.missed}</b><span>Missed</span></div><div><b>{s.percent == null ? '—' : s.percent + '%'}</b><span>Attendance</span></div></div>
        {extra && <p className="prv-x">{extra}</p>}
        <div className="prv-fee"><div><div className="prv-l">{multi ? 'Fees' : 'Fee'} for {d.month_label}</div><div className="prv-amt">{!m.billed && !m.total ? '—' : money(m.total, cur)}</div><div className="prv-x" style={{ margin: '2px 0 0' }}>{multi ? `${m.subjects} subjects · ${d.fee.classes} classes each · paid in advance` : `for ${d.fee.classes} classes · collected in advance`}</div></div>
          <div className="prv-pay"><div className="prv-l">Payment status</div><span className={`prv-pill fee-${m.state}`}>{m.label}</span>{fnote && <div className="prv-x" style={{ margin: '4px 0 0' }}>{fnote}</div>}</div></div>
        <h4>Outstanding fees <span className="prv-asof">as of {f.dateY(o.as_of + 'T12:00:00Z')}</span></h4>
        {o.lines.length ? <><table className="prv-tb"><thead><tr><th>Fee</th><th>Due</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead><tbody>{o.lines.map((l, i) => <tr key={i}><td>{l.period_label} · {l.subject}</td><td style={{ whiteSpace: 'nowrap', ...(l.overdue ? { color: '#b91c1c', fontWeight: 700 } : {}) }}>{shortDue(l.due_date)}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(l.outstanding, cur)}</td></tr>)}<tr className="prv-tot"><td colSpan={2}>Total outstanding</td><td style={{ textAlign: 'right' }}>{money(o.total, cur)}</td></tr></tbody></table>{bits && <p className="prv-x">{bits}.</p>}</> : <div className="prv-ok">No outstanding fees. Thank you.</div>}
        {d.fee.month_fees.length > 1 && <><h4>All subjects – {d.month_label}</h4><table className="prv-tb"><thead><tr><th>Subject</th><th>Fee</th><th>Payment</th></tr></thead><tbody>{d.fee.month_fees.map(x => <tr key={x.subject_id}><td style={x.current ? { fontWeight: 700 } : undefined}>{x.subject}</td><td>{x.amount == null ? '—' : money(x.amount, cur)}</td><td><span className={`fee-txt fee-c-${x.state}`}>● {x.state === 'not_billed' ? 'Not yet recorded' : cap(x.label)}</span></td></tr>)}</tbody></table></>}
        <h4>Class by class</h4>
        {d.rows.length ? <table className="prv-tb prv-class"><thead><tr><th>Date</th><th>Time</th><th>Status</th></tr></thead><tbody>{d.rows.map(r => <tr key={r.class_id}><td>{r.date}</td><td>{r.time}</td><td className={`st-${r.status}`}><i />{r.label}</td></tr>)}</tbody></table> : <p className="prv-x">No classes were scheduled this month.</p>}
        <div className="prv-note">{d.note}{d.contact && <div className="prv-x" style={{ margin: '4px 0 0' }}>{d.contact}</div>}<b>{d.academy}</b></div>
      </div>
    </div>
  )
}

function Preview({ sid, sub, month, onClose, onDone }: { sid: number; sub: number; month: string; onClose: () => void; onDone: () => void }) {
  const { cfg } = useAuth()
  const { toast } = useToast()
  const f = fmt(cfg)
  const [pv, setPv] = useState<ParentPreview | null>(null)
  const [rec, setRec] = useState<'whatsapp' | 'email' | null>(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const load = useCallback(() => api<ParentPreview>(`/parent-reports/preview?student_id=${sid}&subject_id=${sub}&month=${month}`).then(setPv).catch(e => setErr((e as Error).message)), [sid, sub, month])
  useEffect(() => { void load() }, [load])
  async function save(e: FormEvent) {
    e.preventDefault(); if (!pv) return
    const inc = pv.data.summary.not_recorded + pv.data.summary.upcoming
    if (inc && !ok) return setErr('Tick the box to confirm.')
    try { await api('/parent-reports/record', { method: 'POST', body: { student_id: sid, subject_id: sub, month, channel: rec, hash: pv.data.hash, confirm_incomplete: inc ? true : undefined } }); toast('Recorded'); setRec(null); setErr(''); await load(); onDone() }
    catch (x) { setErr((x as Error).message); if (/changed since/.test((x as Error).message)) { setRec(null); await load() } }
  }
  const d = pv?.data
  const msg = d ? `${d.academy}: Monthly attendance report for ${d.student.name} (${d.subject.name}, ${d.month_label}) is attached. ${d.note}${d.contact ? ' ' + d.contact : ''}` : ''
  const wnum = pv ? pv.recipients.whatsapp.to.replace(/\D/g, '') : ''
  return (
    <Modal title="Report preview" onClose={onClose}>
      {!pv || !d ? (err ? <div className="alert bad">{err}</div> : <Spinner />) : (
        <div className="stack">
          {pv.warnings.length ? <div className="alert" style={{ display: 'block' }}><b>Check before sending</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{pv.warnings.map(w => <li key={w}>{w}</li>)}</ul></div> : <div className="alert info" style={{ display: 'block' }}>This is exactly what the parent will receive. Read it through, then download the PDF and send it.</div>}
          {err && <div className="alert bad">{err}</div>}
          <ReportCard d={d} />
          <div className="row wrap"><a className="btn" href={pv.pdf_url} target="_blank" rel="noopener noreferrer">Open PDF</a><a className="btn primary" href={pv.pdf_url + '?download=1'} download={pv.file_name}>Download PDF</a></div>
          <div className="card stack"><h3>Send to parent or guardian</h3><div className="small mute">Download the PDF, open WhatsApp or your email app (the message is ready), attach the PDF and send it, then record it here. Automatic sending is added in stage 3.</div>
            {pv.recipients.whatsapp.registered ? <a className="btn" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${wnum}?text=${encodeURIComponent(msg)}`}>Open WhatsApp ({pv.recipients.whatsapp.to})</a> : <div className="small mute">No valid guardian mobile number is registered.</div>}
            {pv.recipients.email.registered ? <a className="btn" href={`mailto:${encodeURIComponent(pv.recipients.email.to)}?subject=${encodeURIComponent(`Monthly attendance report - ${d.student.name} - ${d.month_label}`)}&body=${encodeURIComponent(`Dear Parent/Guardian,\n\nPlease find attached the monthly attendance report for ${d.student.name} (${d.subject.name}, ${d.month_label}).\n\n${d.note}\n\nKind regards,\n${d.academy}`)}`}>Open email ({pv.recipients.email.to})</a> : <div className="small mute">No guardian email address is registered.</div>}
            <div className="row wrap"><button className="btn" disabled={!pv.recipients.whatsapp.registered} onClick={() => { setErr(''); setOk(false); setRec('whatsapp') }}>Record: sent by WhatsApp</button><button className="btn" disabled={!pv.recipients.email.registered} onClick={() => { setErr(''); setOk(false); setRec('email') }}>Record: sent by email</button></div></div>
          <div className="card"><h3>Sent record</h3>{pv.history.length ? <div className="list small">{pv.history.map((h: ParentSend) => <div key={h.id} style={{ alignItems: 'flex-start' }}><div className="grow"><b>{h.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</b> to {h.recipient}<div className="mute">{f.dt(h.created_at)}{h.sent_by ? ' · ' + h.sent_by : ''}</div>{h.summary && <div className="mute">Report then: {h.summary.attended} of {h.summary.held} attended</div>}</div><Chip kind={h.status === 'failed' ? 'bad' : 'ok'}>{h.status === 'recorded' ? 'Recorded' : h.status === 'delivered' ? 'Delivered' : 'Sent'}</Chip></div>)}</div> : <div className="mute small">Not sent yet.</div>}</div>
        </div>
      )}
      {rec && pv && d && (
        <Modal title={`Record as sent by ${rec === 'whatsapp' ? 'WhatsApp' : 'email'}`} onClose={() => setRec(null)}>
          <form className="stack" onSubmit={save}><p>Only record this after you have really sent the PDF to <b>{rec === 'whatsapp' ? pv.recipients.whatsapp.to : pv.recipients.email.to}</b>. The record shows who sent it and when.</p>
            {pv.history.some(h => h.channel === rec) && <div className="alert" style={{ display: 'block' }}>This report was already recorded as sent this way.</div>}
            {d.summary.not_recorded + d.summary.upcoming > 0 && <label className="row" style={{ fontWeight: 500, alignItems: 'flex-start' }}><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> <span>{d.summary.not_recorded + d.summary.upcoming} classes are not recorded or still to come. I sent the report as it was.</span></label>}
            {err && <div className="alert bad">{err}</div>}
            <div className="foot"><button type="button" className="btn" onClick={() => setRec(null)}>Cancel</button><button className="btn primary">Yes, I sent it</button></div></form>
        </Modal>
      )}
    </Modal>
  )
}

export default function ParentReports() {
  const { cfg } = useAuth()
  const [month, setMonth] = useState(() => { const d = new Date(dayTz(cfg!).slice(0, 8) + '01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) })
  const [f, setF] = useState({ batch: '', subject: '', q: '' })
  const [rows, setRows] = useState<ParentRow[] | null>(null)
  const [label, setLabel] = useState('')
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<{ s: number; sub: number } | null>(null)
  const fm = fmt(cfg)
  const load = useCallback(() => {
    if (!month) return
    const p = new URLSearchParams({ month, ...f }); for (const [k, v] of [...p]) if (!v) p.delete(k)
    api<{ label: string; rows: ParentRow[] }>('/parent-reports?' + p).then(r => { setRows(r.rows); setLabel(r.label); setErr('') }).catch(e => setErr((e as Error).message))
  }, [month, f])
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t) }, [load, f.q])
  const sent = rows?.filter(r => r.last_send && r.last_send.status !== 'failed').length ?? 0
  return (
    <ReportShell id="parent">
      <div style={{ marginBottom: 6 }}><label htmlFor="pm">Month</label><input id="pm" type="month" value={month} max={dayTz(cfg!).slice(0, 7)} onChange={e => setMonth(e.target.value)} /></div>
      <details className="fdet"><summary>Filters</summary><div className="filters" style={{ marginTop: 10 }}>
        <div><label htmlFor="pb">Batch</label><select id="pb" value={f.batch} onChange={e => setF({ ...f, batch: e.target.value })}><option value="">All batches</option>{cfg!.batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div><label htmlFor="ps">Subject</label><select id="ps" value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })}><option value="">All subjects</option>{cfg!.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="wide"><label htmlFor="pq">Search student</label><input id="pq" type="search" placeholder="Student name" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /></div></div></details>
      {err ? <div className="alert bad">{err}</div> : !rows ? <Spinner /> : <>
        <div className="card" style={{ marginBottom: 10 }}><b>{label}</b><div className="mute small">{rows.length} {rows.length === 1 ? 'report' : 'reports'} · {sent} sent</div></div>
        {rows.length ? rows.map(r => (
          <div className="card pr-row" key={`${r.student_id}-${r.subject_id}`}>
            <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}><div className="grow"><b>{r.name}</b><div className="mute small">{r.subject} · {r.batch}</div></div><Chip kind={FEE_CHIP[r.fee_state]}>{cap(r.fee_label)}</Chip></div>
            {r.owes > 0 && <div className="small" style={{ margin: '0 0 6px', color: 'var(--bad)' }}><b>Outstanding: {money(r.owes, r.currency)}</b>{r.owes_previous > 0 && ` (${money(r.owes_previous, r.currency)} from earlier months)`}</div>}
            <div className="small" style={{ margin: '8px 0' }}>{r.summary.held ? <><b>{r.summary.attended} of {r.summary.held}</b> classes attended · <b>{r.summary.percent}%</b></> : r.summary.pending ? 'No attendance recorded yet' : 'No classes held'}{r.summary.cancelled ? ` · ${r.summary.cancelled} cancelled` : ''}</div>
            {r.warnings > 0 && <div className="small" style={{ color: 'var(--warn)' }}>⚠ {r.warnings} {r.warnings === 1 ? 'thing' : 'things'} to check</div>}
            <div className={'small ' + (r.last_send ? '' : 'mute')} style={{ margin: '4px 0 8px' }}>{r.last_send ? `✓ ${r.last_send.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} · ${fm.dt(r.last_send.created_at)}${r.last_send.sent_by ? ' · ' + r.last_send.sent_by : ''}` : 'Not sent yet'}</div>
            <button className="btn sm primary" onClick={() => setOpen({ s: r.student_id, sub: r.subject_id })}>Preview and send</button>
          </div>)) : <div className="empty">No classes were found for this month and filters.</div>}</>}
      {open && <Preview sid={open.s} sub={open.sub} month={month} onClose={() => setOpen(null)} onDone={load} />}
    </ReportShell>
  )
}
