'use client';
import { useCallback, useState } from 'react';
import { db } from '@/lib/client';
import { useApp } from '@/state/app';
import { addDays } from '@/lib/tz';
import { zonedToUtc } from '@/lib/tz';
import { dp, fDateY, METHOD, money, SUBJECTS, subj, todayStr, toMinor, tz } from '@/lib/format';
import { creditedCents, feeStatus } from '@/lib/fees';
import { msgText, recipients, type OutItem, type To } from '@/lib/whatsapp';
import type { PayMethod, Payment, SubjectId } from '@/lib/types';
import { Field, Form, Options, useConfirm, useUI } from './ui';
import { useOutbox } from './whatsapp';

type App = ReturnType<typeof useApp>;

export function feeReminderItems(app: App, ids: string[] | null, kind: 'any' | 'overdue' | 'upcoming', to: To): OutItem[] {
  const out: OutItem[] = [], ctx = app.feeCtx();
  for (const s of app.students.filter(x => x.active && (!ids || ids.includes(x.id)))) {
    const f = feeStatus(ctx, s.id);
    if (f.balance <= 0 || (kind === 'overdue' && f.overdue <= 0) || (kind === 'upcoming' && f.upcoming <= 0) || (kind === 'any' && f.overdue <= 0 && f.upcoming <= 0)) continue;
    const parts: string[] = [];
    if (f.overdue > 0) parts.push(`${money(f.overdue, f.cur)} is overdue.`);
    if (f.upcoming > 0) parts.push(`${money(f.upcoming, f.cur)} is due by ${fDateY(addDays(todayStr(), 7) + 'T12:00:00Z')}.`);
    const text = msgText(app.settings.academy, 'fee_reminder', { student: s.name, note: parts.join(' ') || 'A balance is pending.', amount: money(f.balance, f.cur), contact: app.settings.contact });
    recipients(s, to).forEach(r => out.push({ kind: 'fee_reminder', student_id: s.id, class_id: null, role: r.role, name: r.name, number: r.number, text }));
  }
  return out;
}

export function useFeeModals() {
  const app = useApp(), { openModal, toast } = useUI(), outbox = useOutbox(), confirm = useConfirm();

  const receipt = useCallback((id: string) => {
    openModal('Receipt', close => <Receipt id={id} close={close} />);
  }, [openModal]);

  const payment = useCallback((sid?: string | null) => {
    openModal('Record payment', close => <PaymentForm sid={sid || ''} close={close} onSaved={p => receipt(p.id)} />);
  }, [openModal, receipt]);

  const rate = useCallback(() => {
    openModal('Fee rate', close => (
      <Form close={close} label="Save rate" onSubmit={async f => {
        const subject = f.get('s') as SubjectId, batch = f.get('b') || null, cur = f.get('c');
        if (!subject) throw new Error('Choose a subject.');
        if (f.get('a') === '' || !(Number(f.get('a')) >= 0)) throw new Error('Enter a monthly fee amount.');
        const cents = toMinor(f.get('a'), cur);
        const existing = app.rates.find(r => r.subject_id === subject && (r.batch_id || null) === batch && !r.student_id && r.currency === cur);
        const res = existing ? await db.from('fee_rates').update({ cents }).eq('id', existing.id) : await db.from('fee_rates').insert({ subject_id: subject, batch_id: batch, student_id: null, currency: cur, cents });
        if (res.error) throw new Error(res.error.message);
        await app.reload('rates'); close(); toast('Rate saved');
      }}>
        <Field label="Subject"><select name="s"><Options items={SUBJECTS} placeholder="Choose a subject" /></select></Field>
        <Field label="Applies to"><select name="b"><Options items={app.batches} placeholder="All batches (default)" /></select></Field>
        <div className="two">
          <Field label="Currency"><select name="c" defaultValue={app.settings.currency}>{app.settings.currencies.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label="Monthly fee"><input name="a" type="number" inputMode="decimal" min={0} step="0.01" /></Field>
        </div>
      </Form>
    ));
  }, [app, openModal, toast]);

  const feeStudent = useCallback((id: string) => {
    openModal(app.sname(id), close => <FeeStudent id={id} close={close} payment={payment} receipt={receipt} />);
  }, [app, openModal, payment, receipt]);

  const reminders = useCallback(() => {
    openModal('Send fee reminders', close => (
      <Form close={close} label="Prepare reminders" onSubmit={async f => {
        const items = feeReminderItems(app, null, f.get('k') as 'any', f.get('to') as To);
        close();
        if (!items.length) return toast('No students need a reminder right now');
        outbox('Fee reminders', items);
      }}>
        <Field label="Who to remind"><select name="k"><option value="any">Overdue and due in the next 7 days</option><option value="overdue">Overdue only</option><option value="upcoming">Due in the next 7 days only</option></select></Field>
        <Field label="Send to"><select name="to"><option value="parents">Parents only</option><option value="students">Students only</option><option value="both">Students and parents</option></select></Field>
      </Form>
    ));
  }, [app, openModal, outbox, toast]);

  return { receipt, payment, rate, feeStudent, reminders, confirm };
}

function PaymentForm({ sid, close, onSaved }: { sid: string; close: () => void; onSaved: (p: Payment) => void }) {
  const app = useApp(), { toast } = useUI();
  const [student, setStudent] = useState(sid), [cur, setCur] = useState(() => app.students.find(s => s.id === sid)?.currency || app.settings.currency);
  const [amount, setAmount] = useState(''), [rate, setRate] = useState('');
  const st = app.students.find(x => x.id === student), lc = st?.currency || app.settings.currency, other = !!st && cur !== lc;
  const a = Number(amount), v = Number(rate);
  return (
    <Form close={close} label="Save and show receipt" onSubmit={async f => {
      if (!st) throw new Error('Choose a student.');
      if (!(a > 0)) throw new Error('Enter an amount greater than zero.');
      let r = 1;
      if (cur !== lc) { r = v; if (!(r > 0)) throw new Error(`Enter the exchange rate (1 ${cur} = how many ${lc}).`); }
      const date = f.get('d') || todayStr();
      const { data, error } = await db.rpc('record_payment', {
        p_student: st.id, p_cents: creditedCents(a, cur, lc, r, (x, c) => toMinor(x, c), dp), p_paid_cents: toMinor(a, cur), p_paid_currency: cur, p_rate: r,
        p_method: f.get('m') as PayMethod, p_reference: f.trim('r'), p_note: f.trim('n'), p_paid_at: zonedToUtc(date + 'T12:00', tz()), p_year: Number(date.slice(0, 4)), p_received_by: app.by,
      });
      if (error) throw new Error(error.message);
      await app.reload('payments'); close(); toast('Payment recorded'); onSaved(data as Payment);
    }}>
      <Field label="Student">
        <select name="s" value={student} onChange={e => { setStudent(e.target.value); const s = app.students.find(x => x.id === e.target.value); if (s) setCur(s.currency); }}>
          <Options items={app.students.filter(s => s.active)} placeholder="Choose a student" />
        </select>
      </Field>
      <div className="two">
        <Field label="Amount received"><input name="a" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label="Currency paid in"><select name="c" value={cur} onChange={e => setCur(e.target.value)}>{app.settings.currencies.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
      </div>
      {other && (
        <Field label={<>Exchange rate <span className="mute">(1 {cur} = ? {lc})</span></>}>
          <input name="x" type="number" inputMode="decimal" min={0} step="any" value={rate} onChange={e => setRate(e.target.value)} />
          <div className="mute small" style={{ marginTop: 4 }}>{v > 0 && a > 0 ? `${money(toMinor(a, cur), cur)} = ${money(Math.round(a * v * 10 ** dp(lc)), lc)}` : `This student is billed in ${lc}.`}</div>
        </Field>
      )}
      <div className="two">
        <Field label="Date received"><input name="d" type="date" defaultValue={todayStr()} /></Field>
        <Field label="Payment method"><select name="m">{Object.entries(METHOD).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></Field>
      </div>
      <Field label="Reference" hint="(bank or online transaction ID, optional)"><input name="r" /></Field>
      <Field label="Note" hint="(optional)"><input name="n" /></Field>
    </Form>
  );
}

function Receipt({ id, close }: { id: string; close: () => void }) {
  const app = useApp(), { openModal, toast } = useUI(), outbox = useOutbox();
  const p = app.payments.find(x => x.id === id);
  if (!p) return <p className="mute">This payment no longer exists.</p>;
  const s = app.students.find(x => x.id === p.student_id), f = feeStatus(app.feeCtx(), p.student_id);
  const shown = money(p.paid_cents ?? p.cents, p.paid_currency || p.currency);
  const void_ = () => {
    close();
    openModal('Void payment', c2 => (
      <Form close={c2} danger label="Void payment" onSubmit={async ff => {
        if (!ff.trim('r')) throw new Error('Enter a reason for voiding this payment.');
        const { error } = await db.from('payments').update({ voided: true, void_reason: ff.trim('r') }).eq('id', p.id);
        if (error) throw new Error(error.message);
        await app.reload('payments'); c2(); toast('Payment voided');
      }}><Field label="Reason (kept on record)"><input name="r" /></Field></Form>
    ));
  };
  return (
    <>
      <div className="receipt">
        <div className="row between">
          <div className="row" style={{ gap: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-emblem-128.webp" alt="" width={46} height={42} />
            <div><b>{app.settings.academy}</b><div className="mute small">Payment receipt</div></div>
          </div>
          <div className="right"><b>{p.receipt_no}</b><div className="mute small">{fDateY(p.paid_at)}</div></div>
        </div>
        {p.voided && <div className="alert bad mt">Voided: {p.void_reason}</div>}
        <div className="big mt">{shown}</div>
        <dl className="kv mt">
          <dt>Received from</dt><dd>{s?.name} ({app.bname(s?.batch_id)})</dd>
          <dt>Paid by</dt><dd>{s?.guardian_name}</dd>
          <dt>Method</dt><dd>{METHOD[p.method]}</dd>
          {p.paid_currency && p.paid_currency !== p.currency && <><dt>Credited as</dt><dd>{money(p.cents, p.currency)} (1 {p.paid_currency} = {p.rate} {p.currency})</dd></>}
          {p.reference && <><dt>Reference</dt><dd>{p.reference}</dd></>}
          {p.note && <><dt>Note</dt><dd>{p.note}</dd></>}
          <dt>Balance after</dt><dd>{f.balance > 0 ? money(f.balance, f.cur) + ' outstanding' : 'Nothing outstanding'}</dd>
          <dt>Received by</dt><dd>{p.received_by}</dd>
        </dl>
      </div>
      <div className="foot no-print">
        {!p.voided && <button className="btn danger" onClick={void_}>Void payment</button>}
        <button className="btn" onClick={() => s && outbox('Send receipt', recipients(s, 'parents').map(r => ({
          kind: 'receipt' as const, student_id: s.id, class_id: null, role: r.role, name: r.name, number: r.number,
          text: msgText(app.settings.academy, 'receipt', { text: `Receipt ${p.receipt_no}\nReceived ${shown} from ${s.name} on ${fDateY(p.paid_at)} (${METHOD[p.method]}).\n${f.balance > 0 ? 'Balance: ' + money(f.balance, f.cur) : 'No balance outstanding.'}\nThank you.` }),
        })))}>Send on WhatsApp</button>
        <button className="btn primary" onClick={() => window.print()}>Print or save PDF</button>
      </div>
    </>
  );
}

function FeeStudent({ id, close, payment, receipt }: { id: string; close: () => void; payment: (sid?: string | null) => void; receipt: (id: string) => void }) {
  const app = useApp(), { openModal, toast } = useUI(), outbox = useOutbox(), confirm = useConfirm();
  const f = feeStatus(app.feeCtx(), id);
  const pays = app.payments.filter(p => p.student_id === id).sort((a, b) => b.paid_at.localeCompare(a.paid_at));
  const addCharge = () => {
    close();
    openModal('Add charge', c2 => (
      <Form close={c2} label="Add charge" onSubmit={async ff => {
        if (!ff.trim('d')) throw new Error('Describe the charge.');
        if (!(Number(ff.get('a')) > 0)) throw new Error('Enter an amount greater than zero.');
        if (!ff.get('due')) throw new Error('Choose a due date.');
        const { error } = await db.from('fee_charges').insert({ student_id: id, subject_id: null, period: null, description: ff.trim('d'), currency: f.cur, cents: toMinor(ff.get('a'), f.cur), due_date: ff.get('due') });
        if (error) throw new Error(error.message);
        await app.reload('charges'); c2(); toast('Charge added');
      }}>
        <Field label="Description"><input name="d" placeholder="e.g. Admission fee, exam fee" /></Field>
        <div className="two">
          <Field label={`Amount (${f.cur})`}><input name="a" type="number" inputMode="decimal" min={0} step="0.01" /></Field>
          <Field label="Due date"><input name="due" type="date" defaultValue={todayStr()} /></Field>
        </div>
      </Form>
    ));
  };
  const voidCharge = (cid: string) => confirm('Void charge', 'Void this charge? It will no longer count toward the balance.', 'Void charge', async () => {
    const { error } = await db.from('fee_charges').update({ voided: true }).eq('id', cid);
    if (error) throw new Error(error.message);
    await app.reload('charges'); toast('Charge voided');
  });
  return (
    <>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        <div className="stat"><b>{money(Math.max(0, f.balance), f.cur)}</b><span>Outstanding</span>{f.balance < 0 && <small>Credit {money(-f.balance, f.cur)}</small>}</div>
        <div className="stat"><b>{money(f.overdue, f.cur)}</b><span>Overdue</span></div>
      </div>
      <div className="sec"><h3>Charges</h3></div>
      {f.lines.length ? (
        <div className="list">{f.lines.slice().reverse().map(c => (
          <div key={c.id}>
            <div className="grow">{c.description}<div className="mute small">Due {fDateY(c.due_date + 'T12:00:00Z')}</div></div>
            <div className="right">{money(c.cents, f.cur)}<div>{c.out <= 0 ? <span className="chip ok">Paid</span> : <span className={`chip ${c.od ? 'bad' : 'warn'}`}>{money(c.out, f.cur)} {c.od ? 'overdue' : 'due'}</span>}</div></div>
            <button className="btn sm" aria-label="Void charge" onClick={() => { close(); voidCharge(c.id); }}>✕</button>
          </div>
        ))}</div>
      ) : <div className="mute">No charges yet.</div>}
      <div className="sec"><h3>Payments</h3></div>
      {pays.length ? (
        <div className="list">{pays.map(p => (
          <div key={p.id} className="tap" onClick={() => { close(); receipt(p.id); }}>
            <div className="grow">{fDateY(p.paid_at)} · {METHOD[p.method]}<div className="mute small">{p.receipt_no}</div></div>
            <div className="right">{money(p.paid_cents ?? p.cents, p.paid_currency || p.currency)}
              {p.paid_currency && p.paid_currency !== p.currency && <div className="mute small">= {money(p.cents, f.cur)}</div>}
              {p.voided && <div><span className="chip bad">Voided</span></div>}</div>
          </div>
        ))}</div>
      ) : <div className="mute">No payments yet.</div>}
      <div className="foot">
        <button className="btn" onClick={addCharge}>Add charge</button>
        <button className="btn" onClick={() => { const it = feeReminderItems(app, [id], 'any', 'parents'); if (!it.length) return toast('Nothing is due or overdue for this student'); close(); outbox('Fee reminder', it); }}>Send reminder</button>
        <button className="btn primary" onClick={() => { close(); payment(id); }}>Record payment</button>
      </div>
    </>
  );
}
