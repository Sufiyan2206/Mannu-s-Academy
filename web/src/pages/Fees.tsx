import { FormEvent, useCallback, useEffect, useState } from 'react'
import { api, FeeSummary, METHODS, Payment, Rate, Statement } from '../api'
import { useAuth } from '../auth'
import { Chip, Field, Modal, Spinner, fmt, useToast } from '../ui'
import { dayTz, money } from '../lib'

function Receipt({ id, onClose }: { id: number; onClose: () => void }) {
  const { cfg } = useAuth()
  const f = fmt(cfg)
  const [r, setR] = useState<(Payment & { academy: string; balance_after: number; student: string; batch: string }) | null>(null)
  useEffect(() => { api<typeof r>(`/payments/${id}`).then(setR) }, [id])
  return (
    <Modal title="Receipt" onClose={onClose}>
      {!r ? <Spinner /> : (
        <div className="stack">
          <div className="card" style={{ textAlign: 'center' }}><img src="/brand/logo-emblem-128.webp" alt="" width={64} height={58} /><h3>{r.academy}</h3><div className="mute small">Receipt {r.receipt_no}</div></div>
          <dl className="kv"><dt>Student</dt><dd>{r.student}</dd><dt>Batch</dt><dd>{r.batch}</dd><dt>Date</dt><dd>{f.dt(r.paid_at)}</dd><dt>Method</dt><dd>{METHODS[r.method]}{r.reference ? ` · ${r.reference}` : ''}</dd>
            <dt>Received</dt><dd><b>{money(r.paid_amount, r.paid_currency)}</b></dd>{r.paid_currency !== r.currency && <><dt>Credited</dt><dd>{money(r.amount, r.currency)} (rate {r.rate})</dd></>}
            <dt>Balance now</dt><dd>{r.balance_after > 0 ? money(r.balance_after, r.currency) + ' due' : r.balance_after < 0 ? money(-r.balance_after, r.currency) + ' credit' : 'Nothing due'}</dd><dt>Received by</dt><dd>{r.received_by ?? '—'}</dd></dl>
          {r.voided && <div className="alert bad" style={{ display: 'block' }}><b>Cancelled</b>: {r.void_reason}</div>}
          <button className="btn" onClick={() => window.print()}>Print</button>
        </div>
      )}
    </Modal>
  )
}

function PayForm({ s, onDone, onClose }: { s: Statement; onDone: () => void; onClose: () => void }) {
  const { cfg } = useAuth()
  const { toast } = useToast()
  const [err, setErr] = useState('')
  const [cur, setCur] = useState(s.currency)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr('')
    const f = e.currentTarget.elements as unknown as Record<string, HTMLInputElement>
    try { await api('/payments', { method: 'POST', body: { student_id: s.student.id, amount: f.amount.value, method: f.method.value, reference: f.reference.value, note: f.note.value, paid_currency: cur, rate: cur !== s.currency ? f.rate.value : undefined, paid_date: f.date.value || undefined } }); toast('Payment recorded'); onDone() } catch (x) { setErr((x as Error).message) }
  }
  return (
    <Modal title={`Payment from ${s.student.name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>{err && <div className="alert bad" role="alert">{err}</div>}
        <div className="mute small">Balance now: <b>{s.balance > 0 ? money(s.balance, s.currency) + ' due' : s.balance < 0 ? money(-s.balance, s.currency) + ' credit' : 'nothing due'}</b></div>
        <div className="two"><Field label="Amount received"><input name="amount" inputMode="decimal" autoFocus /></Field><Field label="Currency"><input value={cur} onChange={e => setCur(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} /></Field></div>
        {cur !== s.currency && <Field label={`Exchange rate: 1 ${cur} = ? ${s.currency}`}><input name="rate" inputMode="decimal" /></Field>}
        <Field label="Method"><select name="method" defaultValue="cash">{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Reference" hint="optional, e.g. transfer number"><input name="reference" maxLength={120} /></Field>
        <Field label="Date paid" hint="empty = now"><input name="date" type="date" max={dayTz(cfg!)} /></Field>
        <Field label="Note" hint="optional"><input name="note" maxLength={300} /></Field>
        <div className="foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Record payment</button></div>
      </form>
    </Modal>
  )
}

export function StudentFees({ id, onClose, onChange }: { id: number; onClose: () => void; onChange: () => void }) {
  const { cfg } = useAuth()
  const { toast } = useToast()
  const f = fmt(cfg)
  const [s, setS] = useState<Statement | null>(null)
  const [sub, setSub] = useState<'pay' | 'charge' | number | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => api<Statement>(`/fees/student/${id}`).then(setS).catch(e => setErr((e as Error).message)), [id])
  useEffect(() => { void load() }, [load])
  async function voidPay(p: Payment) {
    const reason = window.prompt(`Cancel receipt ${p.receipt_no}? Why?`); if (!reason) return
    try { await api(`/payments/${p.id}/void`, { method: 'POST', body: { reason } }); toast('Payment cancelled'); await load(); onChange() } catch (x) { toast((x as Error).message, true) }
  }
  async function addCharge(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr('')
    const x = e.currentTarget.elements as unknown as Record<string, HTMLInputElement>
    try { await api('/fees/charges', { method: 'POST', body: { student_id: id, description: x.description.value, amount: x.amount.value, due_date: x.due.value } }); toast('Charge added'); setSub(null); await load(); onChange() } catch (y) { setErr((y as Error).message) }
  }
  return (
    <Modal title={s ? s.student.name : 'Fees'} onClose={onClose}>
      {err && <div className="alert bad">{err}</div>}
      {!s ? <Spinner /> : (
        <div className="stack">
          <div className="stats"><div className="stat"><b style={{ fontSize: '1.05rem' }}>{money(s.charged, s.currency)}</b><span>Charged</span></div><div className="stat"><b style={{ fontSize: '1.05rem' }}>{money(s.paid, s.currency)}</b><span>Paid</span></div>
            <div className="stat"><b style={{ fontSize: '1.05rem', color: s.balance > 0 ? 'var(--bad)' : undefined }}>{money(Math.abs(s.balance), s.currency)}</b><span>{s.balance < 0 ? 'Credit' : 'Due'}</span></div></div>
          <div className="row wrap"><button className="btn primary" onClick={() => setSub('pay')}>Record payment</button><button className="btn" onClick={() => setSub('charge')}>Add a charge</button></div>
          <div className="sec"><h2>Fees</h2></div>
          {s.charges.length ? <div className="card list small">{s.charges.map(c => (
            <div key={c.id}><div className="grow"><b>{c.description}</b><div className="mute">due {f.dateY(c.due_date + 'T12:00:00Z')}</div></div><div style={{ textAlign: 'right' }}>{money(c.amount, s.currency)}<div>{c.outstanding > 0 ? <Chip kind={c.due_date < dayTz(cfg!) ? 'bad' : 'warn'}>{money(c.outstanding, s.currency)} due</Chip> : <Chip kind="ok">Paid</Chip>}</div></div></div>
          ))}</div> : <div className="empty">No fees yet.</div>}
          <div className="sec"><h2>Payments</h2></div>
          {s.payments.length ? <div className="card list small">{s.payments.map(p => (
            <div key={p.id} style={{ opacity: p.voided ? 0.55 : 1 }}><div className="grow"><a href="#r" onClick={e => { e.preventDefault(); setSub(p.id) }}><b>{p.receipt_no}</b></a><div className="mute">{f.dt(p.paid_at)} · {METHODS[p.method]}{p.voided ? ' · cancelled' : ''}</div></div>
              <div style={{ textAlign: 'right' }}><b>{money(p.paid_amount, p.paid_currency)}</b>{!p.voided && <div><button className="btn sm" onClick={() => voidPay(p)}>Cancel</button></div>}</div></div>
          ))}</div> : <div className="empty">No payments yet.</div>}
        </div>
      )}
      {s && sub === 'pay' && <PayForm s={s} onClose={() => setSub(null)} onDone={() => { setSub(null); void load(); onChange() }} />}
      {s && sub === 'charge' && (
        <Modal title="Add a charge" onClose={() => setSub(null)}><form className="stack" onSubmit={addCharge} noValidate>
          <Field label="What is it for"><input name="description" maxLength={200} placeholder="e.g. Exam revision pack" /></Field>
          <div className="two"><Field label={`Amount (${s.currency})`}><input name="amount" inputMode="decimal" /></Field><Field label="Due date"><input name="due" type="date" defaultValue={dayTz(cfg!, 7)} /></Field></div>
          <div className="foot"><button type="button" className="btn" onClick={() => setSub(null)}>Cancel</button><button className="btn primary">Add</button></div></form></Modal>
      )}
      {typeof sub === 'number' && <Receipt id={sub} onClose={() => setSub(null)} />}
    </Modal>
  )
}

function Generate({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { cfg } = useAuth()
  const { toast } = useToast()
  const [err, setErr] = useState('')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr('')
    const x = e.currentTarget.elements as unknown as Record<string, HTMLInputElement>
    try { const r = await api<{ created: number; skipped: number; no_rate: number }>('/fees/generate', { method: 'POST', body: { period: x.period.value, due_day: Number(x.due.value) } }); toast(`${r.created} fees created${r.skipped ? `, ${r.skipped} already existed` : ''}${r.no_rate ? `, ${r.no_rate} have no rate set` : ''}`, r.no_rate > 0); onDone() } catch (y) { setErr((y as Error).message) }
  }
  return (
    <Modal title="Generate monthly fees" onClose={onClose}><form className="stack" onSubmit={submit} noValidate>{err && <div className="alert bad">{err}</div>}
      <p className="mute small" style={{ margin: 0 }}>Creates one fee for each active student and subject, using the rates you set. Running it twice never creates duplicates.</p>
      <Field label="Month"><input name="period" type="month" defaultValue={dayTz(cfg!).slice(0, 7)} /></Field><Field label="Due on day" hint="1–28"><input name="due" type="number" min={1} max={28} defaultValue={10} /></Field>
      <div className="foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Generate</button></div></form></Modal>
  )
}

function Rates({ onClose }: { onClose: () => void }) {
  const { cfg } = useAuth()
  const { toast } = useToast()
  const [rows, setRows] = useState<Rate[] | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => api<Rate[]>('/fees/rates').then(setRows), [])
  useEffect(() => { void load() }, [load])
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr('')
    const x = e.currentTarget.elements as unknown as Record<string, HTMLInputElement & HTMLSelectElement>
    try { await api('/fees/rates', { method: 'POST', body: { subject_id: Number(x.subject.value), batch_id: x.batch.value ? Number(x.batch.value) : 0, currency: x.currency.value, amount: x.amount.value } }); toast('Rate saved'); await load() } catch (y) { setErr((y as Error).message) }
  }
  return (
    <Modal title="Monthly fee rates" onClose={onClose}>
      <div className="stack">{err && <div className="alert bad">{err}</div>}
        <p className="mute small" style={{ margin: 0 }}>The most specific rate wins: one student, then one batch, then everyone.</p>
        {rows ? <div className="card list small">{rows.map(r => <div key={r.id}><div className="grow"><b>{r.subject}</b><div className="mute">{r.student ? 'Student: ' + r.student : r.batch ? 'Batch: ' + r.batch : 'Everyone'}</div></div><b>{money(r.amount, r.currency)}</b><button className="btn sm" onClick={async () => { await api(`/fees/rates/${r.id}`, { method: 'DELETE' }); await load() }}>Remove</button></div>)}{!rows.length && <div className="empty">No rates yet.</div>}</div> : <Spinner />}
        <form className="stack card" onSubmit={add}><h3>Add or change a rate</h3>
          <Field label="Subject"><select name="subject">{cfg?.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="For" hint="optional"><select name="batch"><option value="">Everyone</option>{cfg?.batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <div className="two"><Field label="Amount"><input name="amount" inputMode="decimal" /></Field><Field label="Currency"><input name="currency" defaultValue={cfg?.currency} maxLength={3} /></Field></div>
          <button className="btn primary">Save rate</button></form>
      </div>
    </Modal>
  )
}

export default function Fees() {
  const { user, cfg } = useAuth()
  const [rows, setRows] = useState<FeeSummary[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [modal, setModal] = useState<'gen' | 'rates' | null>(null)
  const [mine, setMine] = useState<Statement | null>(null)
  const [q, setQ] = useState('')
  const f = fmt(cfg)
  const load = useCallback(() => { if (user?.role === 'admin') void api<FeeSummary[]>('/fees/summary').then(setRows); else void api<Statement>('/fees/mine').then(setMine) }, [user])
  useEffect(() => { load() }, [load])
  if (user?.role === 'student') {
    if (!mine) return <Spinner />
    return (
      <>
        <div className="head"><h1>My fees</h1></div>
        <div className="stats"><div className="stat"><b style={{ fontSize: '1.05rem' }}>{money(mine.charged, mine.currency)}</b><span>Charged</span></div><div className="stat"><b style={{ fontSize: '1.05rem' }}>{money(mine.paid, mine.currency)}</b><span>Paid</span></div><div className="stat"><b style={{ fontSize: '1.05rem', color: mine.balance > 0 ? 'var(--bad)' : undefined }}>{money(Math.abs(mine.balance), mine.currency)}</b><span>{mine.balance < 0 ? 'Credit' : 'Due'}</span></div></div>
        <div className="sec"><h2>Fees</h2></div><div className="card list small">{mine.charges.map(c => <div key={c.id}><div className="grow"><b>{c.description}</b><div className="mute">due {f.dateY(c.due_date + 'T12:00:00Z')}</div></div>{c.outstanding > 0 ? <Chip kind="warn">{money(c.outstanding, mine.currency)} due</Chip> : <Chip kind="ok">Paid</Chip>}</div>)}</div>
        <div className="sec"><h2>Payments</h2></div><div className="card list small">{mine.payments.filter(p => !p.voided).map(p => <div key={p.id}><div className="grow"><b>{p.receipt_no}</b><div className="mute">{f.dt(p.paid_at)}</div></div><b>{money(p.paid_amount, p.paid_currency)}</b></div>)}</div>
      </>
    )
  }
  if (!rows) return <Spinner />
  const tot = rows.reduce<Record<string, { due: number; over: number }>>((a, r) => { const t = (a[r.currency] ||= { due: 0, over: 0 }); t.due += Math.max(0, r.balance); t.over += r.overdue; return a }, {})
  const shown = rows.filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.overdue - a.overdue || b.balance - a.balance)
  return (
    <>
      <div className="head"><h1>Fees</h1><div className="row"><button className="btn" onClick={() => setModal('rates')}>Rates</button><button className="btn primary" onClick={() => setModal('gen')}>Generate fees</button></div></div>
      <div className="stats">{Object.entries(tot).map(([c, t]) => <div className="stat" key={c}><b style={{ fontSize: '1.05rem' }}>{money(t.due, c)}</b><span>Outstanding · <span style={{ color: 'var(--bad)' }}>{money(t.over, c)} overdue</span></span></div>)}</div>
      <input type="search" placeholder="Search student" aria-label="Search student" value={q} onChange={e => setQ(e.target.value)} style={{ margin: '10px 0' }} />
      <div className="card list">{shown.map(r => (
        <div key={r.id} className="tap" role="button" onClick={() => setOpen(r.id)}><div className="grow"><b>{r.name}</b><div className="mute small">{r.batch}{r.next_due ? ` · next due ${f.date(r.next_due + 'T12:00:00Z')}` : ''}</div></div>
          <div style={{ textAlign: 'right' }}>{r.balance > 0 ? <><b>{money(r.balance, r.currency)}</b>{r.overdue > 0 && <div><Chip kind="bad">{money(r.overdue, r.currency)} overdue</Chip></div>}</> : r.balance < 0 ? <Chip kind="ok">{money(-r.balance, r.currency)} credit</Chip> : <Chip kind="ok">Paid up</Chip>}</div></div>
      ))}{!shown.length && <div className="empty">No students.</div>}</div>
      {open && <StudentFees id={open} onClose={() => setOpen(null)} onChange={load} />}
      {modal === 'gen' && <Generate onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'rates' && <Rates onClose={() => setModal(null)} />}
    </>
  )
}
