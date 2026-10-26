'use client';
import { useMemo, useState } from 'react';
import { db } from '@/lib/client';
import { useApp } from '@/state/app';
import { fDateY, METHOD, money, subj, sumBy, todayStr, totalsText } from '@/lib/format';
import { feeStatus, planMonthlyFees } from '@/lib/fees';
import { Empty, Seg, useRun, useUI } from '@/components/ui';
import { useFeeModals } from '@/components/feesUi';

export default function Fees() {
  const app = useApp(), run = useRun(), { toast, openModal } = useUI(), fm = useFeeModals();
  const [tab, setTab] = useState<'bal' | 'pay' | 'rates'>('bal'), [q, setQ] = useState('');
  const [period, setPeriod] = useState(todayStr().slice(0, 7)), [dueDay, setDueDay] = useState(String(app.settings.due_day));

  const ctx = app.feeCtx();
  const rows = useMemo(() => app.students.filter(s => s.active).map(s => ({ s, f: feeStatus(ctx, s.id) })).sort((a, b) => b.f.overdue - a.f.overdue || b.f.balance - a.f.balance),
    [app.students, app.charges, app.payments]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!app.isAdmin) return <Empty>Fees are visible to admins only.</Empty>;

  const generate = () => run(async () => {
    const plan = planMonthlyFees(ctx, period, Number(dueDay));
    let created = plan.create.length, skipped = plan.skipped;
    if (plan.create.length) {
      const bulk = await db.from('fee_charges').insert(plan.create);
      if (bulk.error?.code === '23505') {
        // someone else generated the same month a moment ago: add the missing ones one by one, the database refuses duplicates
        created = 0;
        for (const c of plan.create) {
          const one = await db.from('fee_charges').insert(c);
          if (!one.error) created++; else if (one.error.code === '23505') skipped++; else throw new Error(one.error.message);
        }
      } else if (bulk.error) throw new Error(bulk.error.message);
    }
    await app.reload('charges');
    toast(`${created} charges created${skipped ? `, ${skipped} already existed` : ''}`);
    if (plan.none.length) openModal('No fee rate set', () => <><p>These student subjects have no rate in the student’s fee currency, so nothing was charged:</p><div className="card small">{plan.none.map(x => <div key={x}>{x}</div>)}</div></>);
  });

  const delRate = (id: string) => fm.confirm('Remove rate', 'Remove this fee rate? Charges already generated are not changed.', 'Remove', async () => {
    const { error } = await db.from('fee_rates').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await app.reload('rates');
  });

  const tb = sumBy(rows.map(x => ({ cur: x.f.cur, v: x.f.balance })), 'v'), to = sumBy(rows.map(x => ({ cur: x.f.cur, v: x.f.overdue })), 'v');
  const shown = rows.filter(x => x.s.name.toLowerCase().includes(q.toLowerCase()));
  const pays = app.payments.slice().sort((a, b) => b.paid_at.localeCompare(a.paid_at)).slice(0, 200);

  return (
    <>
      <div className="head"><h1>Fees</h1><div className="row"><button className="btn" onClick={fm.reminders}>Send reminders</button><button className="btn primary" onClick={() => fm.payment()}>Record payment</button></div></div>
      <Seg value={tab} onChange={setTab} items={[['bal', 'Balances'], ['pay', 'Payments'], ['rates', 'Fee rates']]} />

      {tab === 'bal' && (
        <>
          <div className="stats" style={{ marginBottom: 12 }}>
            <div className="stat"><b style={{ fontSize: '1.15rem' }}>{totalsText(tb)}</b><span>Total outstanding</span></div>
            <div className="stat"><b style={{ fontSize: '1.15rem' }}>{totalsText(to)}</b><span>Overdue</span></div>
          </div>
          <input type="search" placeholder="Search student" aria-label="Search students" style={{ marginBottom: 10 }} value={q} onChange={e => setQ(e.target.value)} />
          <div className="card list">
            {shown.map(({ s, f }) => (
              <div key={s.id} className="tap" onClick={() => fm.feeStudent(s.id)}>
                <div className="grow"><b>{s.name}</b><div className="mute small">{app.bname(s.batch_id)} · {s.subjects.map(subj).join(', ')}</div></div>
                <div className="right"><b>{f.balance > 0 ? money(f.balance, f.cur) : f.balance < 0 ? 'Credit ' + money(-f.balance, f.cur) : 'Paid'}</b>
                  {f.overdue > 0 ? <div><span className="chip bad">{money(f.overdue, f.cur)} overdue</span></div> : f.upcoming > 0 ? <div><span className="chip warn">Due soon</span></div> : null}</div>
              </div>
            ))}
            {!shown.length && <div className="mute">No students found.</div>}
          </div>
        </>
      )}

      {tab === 'pay' && (pays.length ? (
        <div className="card list">{pays.map(p => (
          <div key={p.id} className="tap" onClick={() => fm.receipt(p.id)}>
            <div className="grow"><b>{app.sname(p.student_id)}</b><div className="mute small">{p.receipt_no} · {fDateY(p.paid_at)} · {METHOD[p.method]}{p.reference ? ' · ' + p.reference : ''}</div></div>
            <div className="right"><b>{money(p.paid_cents ?? p.cents, p.paid_currency || p.currency)}</b>
              {p.paid_currency && p.paid_currency !== p.currency && <div className="mute small">= {money(p.cents, p.currency)}</div>}
              {p.voided && <div><span className="chip bad">Voided</span></div>}</div>
          </div>
        ))}</div>
      ) : <Empty>No payments recorded yet.</Empty>)}

      {tab === 'rates' && (
        <>
          <div className="card stack">
            <h3>Monthly fee per subject</h3>
            <p className="mute small" style={{ margin: 0 }}>Set a monthly fee per subject in each currency you bill in, then override it for a batch if needed. A student is charged using the rate in their own fee currency; the most specific rate wins.</p>
            {app.rates.length ? (
              <div className="list">{app.rates.map(x => (
                <div key={x.id}>
                  <div className="grow"><b>{subj(x.subject_id)}</b> <span className="mute">· {x.student_id ? 'Student: ' + app.sname(x.student_id) : x.batch_id ? 'Batch: ' + app.bname(x.batch_id) : 'Default'}</span></div>
                  <b>{money(x.cents, x.currency)}</b>
                  <button className="btn sm" aria-label="Remove rate" onClick={() => delRate(x.id)}>✕</button>
                </div>
              ))}</div>
            ) : <Empty>No fee rates yet.</Empty>}
            <button className="btn" onClick={fm.rate}>Add or change a rate</button>
          </div>
          <div className="card stack mt">
            <h3>Generate monthly fees</h3>
            <p className="mute small" style={{ margin: 0 }}>Creates one charge per student and subject for the month. Running it again for the same month never duplicates charges.</p>
            <div className="two">
              <div><label htmlFor="gp">Month</label><input id="gp" type="month" value={period} onChange={e => setPeriod(e.target.value)} /></div>
              <div><label htmlFor="gd">Due day</label><input id="gd" type="number" min={1} max={28} value={dueDay} onChange={e => setDueDay(e.target.value)} /></div>
            </div>
            <button className="btn primary" onClick={generate}>Generate fees</button>
          </div>
        </>
      )}
    </>
  );
}
