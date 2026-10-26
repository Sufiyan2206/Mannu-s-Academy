'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { useApp } from '@/state/app';
import { csvOf, dayRange, dayText, dp, fDateY, METHOD, money, saveFile, shortD, SUBJECTS, subj, todayStr, tz } from '@/lib/format';
import { zonedToUtc } from '@/lib/tz';
import { outData } from '@/lib/fees';
import { Cell2, PRESETS, PresetBar, ReportHead, RTbl, rangeError, reportTitle } from '../reportKit';
import { useFeeModals } from '../feesUi';
import { Empty, Options } from '../ui';

type Csv = (string | number | null)[][];

export function OutReport({ view }: { view: string }) {
  const app = useApp(), fm = useFeeModals();
  const isPay = view === 'out-payments';
  const [st, setSt] = useState({ batch: '', subject: '', currency: '', school: '', student: '', period: '', from: todayStr(-29), to: todayStr(), preset: 'd30', method: '' });
  const set = (p: Partial<typeof st>) => setSt(s => ({ ...s, ...p }));
  const curs = app.settings.currencies, mo = (c: number, cur: string) => Number(c) / 10 ** dp(cur);
  const filterText = [st.batch && app.bname(st.batch), st.subject && subj(st.subject), st.currency, st.school && (st.school === '__none' ? 'no school entered' : st.school), st.period && 'billing month ' + st.period, st.student && app.sname(st.student), st.method && METHOD[st.method]].filter(Boolean).join(' · ') || 'All batches, subjects and students';
  const err = isPay ? rangeError(st.from, st.to) : '';

  const out = useMemo<{ body: ReactNode; csv: Csv | null; name: string; has: boolean } | null>(() => {
    if (err) return null;
    const head: Csv = [['Report', reportTitle(view)], [isPay ? 'Range' : 'As of', isPay ? st.from + ' to ' + st.to : todayStr()], ['Filters', filterText], []];
    const tap = (id: string) => () => fm.feeStudent(id);
    const totalsCards = (t: ReturnType<typeof outData>['totals']) => t.length ? t.map(x => (
      <div className="card" style={{ marginBottom: 8 }} key={x.cur}>
        <div className="mute small">{x.cur}</div>
        <div className="stats" style={{ margin: '6px 0 0' }}>
          <div className="stat"><b style={{ fontSize: '1.1rem' }}>{money(x.outstanding, x.cur)}</b><span>Outstanding</span></div>
          <div className="stat"><b style={{ fontSize: '1.1rem', color: 'var(--bad)' }}>{money(x.overdue, x.cur)}</b><span>Overdue</span></div>
          <div className="stat"><b style={{ fontSize: '1.1rem' }}>{money(x.due_soon, x.cur)}</b><span>Due in 7 days</span></div>
          <div className="stat"><b style={{ fontSize: '1.1rem' }}>{x.students}</b><span>Students owing</span></div>
        </div>
      </div>
    )) : <Empty>Nothing is outstanding for these filters. 🎉</Empty>;

    if (isPay) {
      const from = zonedToUtc(st.from + 'T00:00', tz())!, to = dayRange(st.to)[1];
      const ps = app.payments.filter(p => !p.voided && p.paid_at >= from && p.paid_at < to && (!st.method || p.method === st.method) && (!st.student || p.student_id === st.student)
        && (!st.batch || app.students.find(s => s.id === p.student_id)?.batch_id === st.batch) && (!st.currency || (p.paid_currency || p.currency) === st.currency)).sort((a, b) => b.paid_at.localeCompare(a.paid_at));
      const tot: Record<string, { cur: string; amount: number; count: number }> = {}, byM: Record<string, { cur: string; method: string; amount: number; count: number }> = {};
      for (const p of ps) {
        const c = p.paid_currency || p.currency, amt = p.paid_cents ?? p.cents, t = tot[c] ||= { cur: c, amount: 0, count: 0 };
        t.amount += amt; t.count++;
        const x = byM[c + '|' + p.method] ||= { cur: c, method: p.method, amount: 0, count: 0 }; x.amount += amt; x.count++;
      }
      return {
        name: `payments-received-${st.from}-to-${st.to}.csv`, has: ps.length > 0,
        csv: [...head, ['Receipt', 'Date', 'Student', 'Batch', 'Method', 'Reference', 'Paid currency', 'Amount paid', 'Credited currency', 'Credited amount'],
          ...ps.map(p => { const c = p.paid_currency || p.currency; return [p.receipt_no, fDateY(p.paid_at), app.sname(p.student_id), app.bname(app.students.find(s => s.id === p.student_id)?.batch_id), METHOD[p.method] || p.method, p.reference || '', c, mo(p.paid_cents ?? p.cents, c), p.currency, mo(p.cents, p.currency)]; })],
        body: (
          <>
            <div className="card" style={{ marginBottom: 10 }}><b>{st.from === st.to ? dayText(st.from) : dayText(st.from) + ' – ' + dayText(st.to)}</b><div className="mute small">{filterText}</div></div>
            {Object.values(tot).map(t => <div className="stat" style={{ marginBottom: 8 }} key={t.cur}><b style={{ fontSize: '1.2rem' }}>{money(t.amount, t.cur)}</b><span>{t.count} {t.count === 1 ? 'payment' : 'payments'} received ({t.cur})</span></div>)}
            {Object.keys(byM).length > 0 && <><div className="sec"><h2>By method</h2></div><RTbl head={['Method', 'Payments', 'Amount']}>{Object.values(byM).sort((a, b) => a.method.localeCompare(b.method)).map(x => <tr key={x.cur + x.method}><td><b>{METHOD[x.method] || x.method}</b></td><td>{x.count}</td><td>{money(x.amount, x.cur)}</td></tr>)}</RTbl></>}
            <div className="sec"><h2>Payments</h2><span className="mute small">{ps.length}</span></div>
            {ps.length ? <>
              <RTbl head={['Student', 'Amount']}>{ps.map(p => { const c = p.paid_currency || p.currency; return (
                <tr key={p.id} className="tap" onClick={() => fm.receipt(p.id)}>
                  <Cell2 a={app.sname(p.student_id)} b={`${p.receipt_no} · ${shortD(p.paid_at)} · ${METHOD[p.method] || p.method}${p.reference ? ' · ' + p.reference : ''}`} />
                  <td><b>{money(p.paid_cents ?? p.cents, c)}</b>{c !== p.currency && <div className="mute small">= {money(p.cents, p.currency)}</div>}</td>
                </tr>); })}</RTbl>
              <p className="mute small">Voided payments are not included. Tap a payment for its receipt.</p></> : <Empty>No payments in this date range.</Empty>}
          </>
        ),
      };
    }

    const o = outData(app.feeCtx(), st);
    let body: ReactNode = null, csv: Csv = [], name = 'report.csv';
    const none = <Empty>Nothing is outstanding for these filters. 🎉</Empty>;
    if (view === 'out-student') {
      const rows = o.studs.filter(x => x.outstanding > 0).sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding || a.s.name.localeCompare(b.s.name));
      body = rows.length ? <><RTbl head={['Student', 'Outstanding']}>{rows.map(x => (
        <tr key={x.s.id} className="tap" onClick={tap(x.s.id)}>
          <Cell2 a={x.s.name} b={`${app.bname(x.s.batch_id)}${x.s.school ? ' · ' + x.s.school : ''}${x.oldest ? ' · oldest due ' + dayText(x.oldest) : ''}`} />
          <td><b>{money(x.outstanding, x.cur)}</b>{x.overdue > 0 ? <div><span className="chip bad">{money(x.overdue, x.cur)} overdue</span></div> : x.due_soon > 0 ? <div><span className="chip warn">Due soon</span></div> : null}</td>
        </tr>))}</RTbl><p className="mute small">Tap a student to see their fees and record a payment.</p></> : <Empty>Nobody owes anything for these filters. 🎉</Empty>;
      csv = [...head, ['Student', 'Batch', 'School', 'Guardian', 'Guardian mobile', 'Currency', 'Charged', 'Paid', 'Outstanding', 'Overdue', 'Due in 7 days', 'Oldest due date'],
        ...rows.map(x => [x.s.name, app.bname(x.s.batch_id), x.s.school || '', x.s.guardian_name, x.s.guardian_mobile, x.cur, mo(x.charged, x.cur), mo(x.paid, x.cur), mo(x.outstanding, x.cur), mo(x.overdue, x.cur), mo(x.due_soon, x.cur), x.oldest || ''])];
      name = 'outstanding-by-student.csv';
    } else if (view === 'out-overdue' || view === 'out-soon') {
      const od = view === 'out-overdue';
      const rows = o.lines.filter(l => od ? l.overdue : l.due_soon).sort(od ? ((a, b) => b.days_overdue - a.days_overdue || a.student.localeCompare(b.student)) : ((a, b) => a.due_date.localeCompare(b.due_date) || a.student.localeCompare(b.student)));
      body = rows.length ? <RTbl head={['Fee', 'Outstanding']}>{rows.map((l, i) => (
        <tr key={i} className="tap" onClick={tap(l.sid)}>
          <Cell2 a={l.student} b={`${l.subject}${l.period ? ' · ' + l.period : ''} · due ${dayText(l.due_date)}`} />
          <td><b>{money(l.outstanding, l.cur)}</b>{od && <div><span className="chip bad">{l.days_overdue} {l.days_overdue === 1 ? 'day' : 'days'}</span></div>}</td>
        </tr>))}</RTbl> : <Empty>{od ? 'No overdue fees. 🎉' : 'Nothing falls due in the next 7 days.'}</Empty>;
      csv = [...head, ['Student', 'Batch', 'Fee', 'Month', 'Due date', 'Days overdue', 'Currency', 'Fee amount', 'Outstanding'], ...rows.map(l => [l.student, app.bname(l.batch_id), l.subject, l.period, l.due_date, l.days_overdue, l.cur, mo(l.amount, l.cur), mo(l.outstanding, l.cur)])];
      name = od ? 'overdue-fees.csv' : 'fees-due-soon.csv';
    } else if (view === 'out-ageing') {
      body = o.ageing.length ? o.ageing.map(ag => { const t = ag.buckets.reduce((a, b) => a + b.amount, 0) || 1; return (
        <div key={ag.cur}><div className="sec"><h2>{ag.cur}</h2></div>
          <RTbl head={['Age', 'Students', 'Amount']}>{ag.buckets.map(b => <tr key={b.key}><td><b>{b.label}</b></td><td>{b.students}</td><td>{money(b.amount, ag.cur)}<div className="mute small">{Math.round(b.amount * 100 / t)}%</div></td></tr>)}</RTbl></div>
      ); }) : none;
      csv = [...head, ['Currency', 'Age', 'Students', 'Fees', 'Amount'], ...o.ageing.flatMap(ag => ag.buckets.map(b => [ag.cur, b.label, b.students, b.lines, mo(b.amount, ag.cur)]))];
      name = 'overdue-ageing.csv';
    } else if (view === 'out-batch' || view === 'out-subject' || view === 'out-month') {
      const g = view === 'out-batch' ? o.byBatch : view === 'out-subject' ? o.bySubject : o.byMonth, lab = view === 'out-batch' ? 'Batch' : view === 'out-subject' ? 'Subject' : 'Month';
      body = g.length ? <RTbl head={[lab, 'Outstanding']}>{g.map((x, i) => (
        <tr key={i}><Cell2 a={x.name} b={`${x.ids.size} ${x.ids.size === 1 ? 'student' : 'students'} · ${x.lines} ${x.lines === 1 ? 'fee' : 'fees'}`} /><td><b>{money(x.outstanding, x.cur)}</b>{x.overdue > 0 && <div><span className="chip bad">{money(x.overdue, x.cur)} overdue</span></div>}</td></tr>
      ))}</RTbl> : none;
      csv = [...head, [lab, 'Currency', 'Students', 'Fees', 'Outstanding', 'Overdue'], ...g.map(x => [x.name, x.cur, x.ids.size, x.lines, mo(x.outstanding, x.cur), mo(x.overdue, x.cur)])];
      name = `outstanding-by-${view.slice(4)}.csv`;
    } else if (view === 'out-credit') {
      const rows = o.studs.filter(x => x.credit > 0).sort((a, b) => b.credit - a.credit);
      body = rows.length ? <>
        {o.credits.map(c => <div className="stat" style={{ marginBottom: 8 }} key={c.cur}><b style={{ fontSize: '1.2rem' }}>{money(c.credit, c.cur)}</b><span>{c.students} {c.students === 1 ? 'student has' : 'students have'} paid in advance ({c.cur})</span></div>)}
        <RTbl head={['Student', 'Credit']}>{rows.map(x => <tr key={x.s.id} className="tap" onClick={tap(x.s.id)}><Cell2 a={x.s.name} b={`${app.bname(x.s.batch_id)} · paid ${money(x.paid, x.cur)} of ${money(x.charged, x.cur)} charged`} /><td><b>{money(x.credit, x.cur)}</b></td></tr>)}</RTbl></> : <Empty>Nobody has paid more than they were charged.</Empty>;
      csv = [...head, ['Student', 'Batch', 'Currency', 'Charged', 'Paid', 'Credit'], ...rows.map(x => [x.s.name, app.bname(x.s.batch_id), x.cur, mo(x.charged, x.cur), mo(x.paid, x.cur), mo(x.credit, x.cur)])];
      name = 'credit-balances.csv';
    }
    const has = view === 'out-credit' ? o.studs.some(x => x.credit > 0) : o.lines.length > 0;
    return {
      name, csv, has,
      body: <><div className="card" style={{ marginBottom: 10 }}><b>As of {dayText(o.today)}</b><div className="mute small">{filterText}</div></div>{view === 'out-credit' ? null : totalsCards(o.totals)}<div style={{ marginTop: 12 }}>{body}</div></>,
    };
  }, [view, st, err, app.students, app.charges, app.payments, app.rates, app.batches]); // eslint-disable-line react-hooks/exhaustive-deps

  const periods = [...new Set(app.charges.filter(c => !c.voided && c.period).map(c => c.period as string))].sort().reverse();
  return (
    <>
      <ReportHead id={view}>
        {isPay && <PresetBar keys={['today', 'week', 'd30', 'month', 'last']} value={st.preset} onPick={k => { if (k === 'custom') set({ preset: 'custom' }); else { const [from, to] = PRESETS[k][1](); set({ preset: k, from, to }); } }} />}
        <details className="fdet"><summary>Filters</summary>
          <div className="filters" style={{ marginTop: 10 }}>
            {isPay && <>
              <div><label htmlFor="f1">From</label><input id="f1" type="date" value={st.from} onChange={e => set({ from: e.target.value, preset: 'custom' })} /></div>
              <div><label htmlFor="f2">To</label><input id="f2" type="date" value={st.to} onChange={e => set({ to: e.target.value, preset: 'custom' })} /></div>
              <div className="wide"><label htmlFor="f8">Payment method</label><select id="f8" value={st.method} onChange={e => set({ method: e.target.value })}><option value="">All methods</option>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            </>}
            <div><label htmlFor="f3">Batch</label><select id="f3" value={st.batch} onChange={e => set({ batch: e.target.value })}><Options items={app.batches} placeholder="All batches" /></select></div>
            {!isPay && <div><label htmlFor="f4">Subject</label><select id="f4" value={st.subject} onChange={e => set({ subject: e.target.value })}><Options items={SUBJECTS} placeholder="All subjects" /></select></div>}
            {curs.length > 1 && <div><label htmlFor="f5">Currency</label><select id="f5" value={st.currency} onChange={e => set({ currency: e.target.value })}><option value="">All currencies</option>{curs.map(c => <option key={c} value={c}>{c}</option>)}</select></div>}
            {!isPay && <>
              <div><label htmlFor="f6">School</label><select id="f6" value={st.school} onChange={e => set({ school: e.target.value })}><option value="">All schools</option><option value="__none">No school entered</option>{app.schoolNames(true).map(x => <option key={x.key} value={x.name}>{x.name}</option>)}</select></div>
              <div><label htmlFor="f7">Billing month</label><select id="f7" value={st.period} onChange={e => set({ period: e.target.value })}><option value="">All months</option>{periods.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
            </>}
            <div className="wide"><label htmlFor="f9">Student</label><select id="f9" value={st.student} onChange={e => set({ student: e.target.value })}><Options items={app.students.filter(s => s.active)} placeholder="All students" /></select></div>
          </div>
        </details>
      </ReportHead>
      {err ? <div className="alert bad">{err}</div> : out && (
        <>
          {out.body}
          {out.has && out.csv && <div className="row wrap mt"><button className="btn" onClick={() => saveFile(out.name, csvOf(out.csv as (string | number)[][]), 'text/csv')}>Download this report (CSV)</button></div>}
        </>
      )}
    </>
  );
}
