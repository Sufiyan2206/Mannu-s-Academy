'use client';
import { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/client';
import { useApp } from '@/state/app';
import { downloadBlob, fDateY, fDT, isEmail, lastMonth, money, monthLabelOf, monthOf, SUBJECTS, subj, todayStr, toMinor } from '@/lib/format';
import { waNum } from '@/lib/whatsapp';
import { FEE_CHIP, parentData, parentFile, parentWarnings, type ParentData } from '@/lib/parent';
import { buildParentPdf, loadLogo } from '@/lib/parentPdf';
import type { ParentSend, SubjectId } from '@/lib/types';
import { ReportHead } from '../reportKit';
import { Alert, Empty, Form, Options, useRun, useUI } from '../ui';

const dShortDue = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
const feeWord = (label: string) => label === 'NOT YET RECORDED' ? 'Not yet recorded' : label.charAt(0) + label.slice(1).toLowerCase();

export function ParentReports() {
  const app = useApp(), run = useRun(), { openModal } = useUI();
  const [st, setSt] = useState({ month: lastMonth(), batch: '', subject: '', q: '' });
  const set = (p: Partial<typeof st>) => setSt(s => ({ ...s, ...p }));
  const [ver, setVer] = useState(0);

  const monthClasses = useMemo(() => app.classes.filter(c => st.month && monthOf(c.start_at) === st.month), [app.classes, st.month]);
  useEffect(() => { if (st.month) run(async () => { await app.ensureAtt(monthClasses.map(c => c.id)); setVer(v => v + 1); }); }, [monthClasses]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastSend = (sid: string, sub: string) => app.sends.filter(x => x.student_id === sid && x.subject_id === sub && x.month === st.month).sort((a, b) => b.at.localeCompare(a.at))[0];
  const rows = useMemo(() => {
    if (!st.month) return [];
    const ctx = app.parentCtx(), out: { s: typeof app.students[number]; sub: SubjectId; d: ParentData; last?: ParentSend }[] = [];
    for (const s of app.students.filter(x => x.active)) {
      if ((st.batch && s.batch_id !== st.batch) || (st.q && !s.name.toLowerCase().includes(st.q.toLowerCase()))) continue;
      for (const sub of s.subjects) {
        if (st.subject && sub !== st.subject) continue;
        const d = parentData(ctx, s.id, sub, st.month);
        if (!d.rows.length) continue;
        out.push({ s, sub, d, last: lastSend(s.id, sub) });
      }
    }
    return out.sort((a, b) => a.s.name.localeCompare(b.s.name) || subj(a.sub).localeCompare(subj(b.sub)));
  }, [app.students, app.classes, app.sends, app.charges, app.payments, app.rates, st, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const sent = rows.filter(r => r.last).length;
  const cfg = app.settings;

  return (
    <>
      <ReportHead id="parent">
        <div style={{ marginBottom: 6 }}><label htmlFor="pm">Month</label><input id="pm" type="month" value={st.month} max={todayStr().slice(0, 7)} onChange={e => set({ month: e.target.value })} /></div>
        <details className="fdet"><summary>Filters</summary>
          <div className="filters" style={{ marginTop: 10 }}>
            <div><label htmlFor="pb">Batch</label><select id="pb" value={st.batch} onChange={e => set({ batch: e.target.value })}><Options items={app.batches} placeholder="All batches" /></select></div>
            <div><label htmlFor="ps">Subject</label><select id="ps" value={st.subject} onChange={e => set({ subject: e.target.value })}><Options items={SUBJECTS} placeholder="All subjects" /></select></div>
            <div className="wide"><label htmlFor="pq">Search student</label><input id="pq" type="search" placeholder="Student name" value={st.q} onChange={e => set({ q: e.target.value.trim() })} /></div>
          </div>
        </details>
      </ReportHead>
      {st.month && (
        <>
          <div className="card" style={{ marginBottom: 10 }}><b>{monthLabelOf(st.month)}</b>
            <div className="mute small">{rows.length} {rows.length === 1 ? 'report' : 'reports'} · {sent} sent · fee shown: {money(toMinor(cfg.monthly_fee, cfg.currency), cfg.currency)} for {cfg.classes_per_month} classes, paid in advance</div></div>
          {rows.length ? rows.map(({ s, sub, d, last }) => {
            const w = parentWarnings(d), fm = (v: number) => money(toMinor(v, d.fee.currency), d.fee.currency);
            return (
              <div className="card pr-row" key={s.id + sub} style={{ marginBottom: 10 }}>
                <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <div className="grow"><b>{s.name}</b><div className="mute small">{subj(sub)} · {app.bname(s.batch_id)}</div></div>
                  <span className={'chip ' + FEE_CHIP[d.fee.month.state]}>{feeWord(d.fee.month.label)}</span>
                </div>
                {d.fee.owed.total > 0 && <div className="small" style={{ margin: '0 0 6px', color: 'var(--bad)' }}><b>Outstanding: {fm(d.fee.owed.total)}</b>{d.fee.owed.previous > 0 && ` (${fm(d.fee.owed.previous)} from earlier months)`}</div>}
                <div className="small" style={{ margin: '8px 0' }}>
                  {d.summary.held ? <><b>{d.summary.attended} of {d.summary.held}</b> classes attended · <b>{d.summary.percent}%</b></> : d.summary.pending ? 'No attendance recorded yet' : 'No classes held'}
                  {d.summary.cancelled > 0 && ` · ${d.summary.cancelled} cancelled`}
                </div>
                {w.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>⚠ {w.length} {w.length === 1 ? 'thing' : 'things'} to check</div>}
                <div className={'small ' + (last ? '' : 'mute')} style={{ margin: '4px 0 8px' }}>{last ? `✓ ${last.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} · ${fDT(last.at)} · ${last.by_name}` : 'Not sent yet'}</div>
                <div className="row"><button className="btn sm primary" onClick={() => openModal('Report preview', close => <Preview sid={s.id} sub={sub} month={st.month} close={close} />)}>Preview and send</button></div>
              </div>
            );
          }) : <Empty>No classes were found for this month and filters.</Empty>}
        </>
      )}
    </>
  );
}

function Preview({ sid, sub, month, close }: { sid: string; sub: SubjectId; month: string; close: () => void }) {
  const app = useApp(), { toast, openModal } = useUI(), run = useRun();
  const s = app.students.find(x => x.id === sid)!;
  const d = parentData(app.parentCtx(), sid, sub, month), warn = parentWarnings(d);
  const fmt = (v: number) => money(toMinor(v, d.fee.currency), d.fee.currency);
  const hist = app.sends.filter(x => x.student_id === sid && x.subject_id === sub && x.month === month).sort((a, b) => b.at.localeCompare(a.at));
  const wnum = waNum(s.guardian_mobile, app.settings.cc), em = (s.guardian_email || '').trim(), okEm = isEmail(em);
  const inc = d.summary.not_recorded + d.summary.upcoming;
  const msg = `${d.academy}: Monthly attendance report for ${d.student.name} (${d.subject.name}, ${d.month_label}) is attached. ${d.note}${d.contact ? ' ' + d.contact : ''}`;

  const record = (ch: 'whatsapp' | 'email', to: string) => openModal(`Record as sent by ${ch === 'whatsapp' ? 'WhatsApp' : 'email'}`, c2 => (
    <Form close={c2} label="Yes, I sent it" onSubmit={async f => {
      if (inc && !f.checked('ok')) throw new Error('Tick the box to confirm.');
      const { error } = await db.from('parent_report_sends').insert({
        student_id: sid, subject_id: sub, month, channel: ch, to_address: to, by_name: app.by, hash: d.hash,
        summary: { held: d.summary.held, attended: d.summary.attended, missed: d.summary.missed, percent: d.summary.percent, fee_state: d.fee.state },
      });
      if (error) throw new Error(error.message);
      await app.reload('sends'); c2(); toast('Recorded');
    }}>
      <p>Only record this after you have really sent the PDF to <b>{to}</b>. The record shows who sent it and when.</p>
      {hist.some(h => h.channel === ch) && <div className="alert" style={{ display: 'block' }}>This report was already recorded as sent this way.</div>}
      {inc > 0 && <label className="row" style={{ fontWeight: 500, alignItems: 'flex-start' }}><input type="checkbox" name="ok" /> <span>{inc} {inc === 1 ? 'class is' : 'classes are'} not recorded or still to come. I sent the report as it was.</span></label>}
    </Form>
  ));

  return (
    <div className="stack">
      {warn.length ? (
        <div className="alert" style={{ display: 'block' }}><b>Check before sending</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{warn.map(w => <li key={w}>{w}</li>)}</ul></div>
      ) : <Alert kind="info">This is exactly what the parent will receive. Read it through, then download the PDF and send it.</Alert>}
      <ReportCard d={d} fmt={fmt} />
      <div className="card stack">
        <h3>Send to parent or guardian</h3>
        <div className="small mute">This page cannot send messages itself. Download the PDF, open WhatsApp or your email app (the message is ready), attach the PDF, send it, then record it here.</div>
        <button className="btn primary" onClick={() => run(async () => { downloadBlob(parentFile(d), buildParentPdf(d, await loadLogo())); toast('PDF ready. Attach it in WhatsApp or your email app.'); })}>1. Download the PDF</button>
        <a className={'btn ' + (wnum ? '' : 'disabled')} {...(wnum ? { href: `https://wa.me/${wnum}?text=${encodeURIComponent(msg)}`, target: '_blank', rel: 'noopener' } : {})}>2. Open WhatsApp{wnum ? ` (${s.guardian_mobile})` : ''}</a>
        {!wnum && <div className="small mute">No valid guardian mobile number is registered.</div>}
        <a className={'btn ' + (okEm ? '' : 'disabled')} {...(okEm ? { href: `mailto:${encodeURIComponent(em)}?subject=${encodeURIComponent(`Monthly attendance report - ${d.student.name} - ${d.month_label}`)}&body=${encodeURIComponent(`Dear Parent/Guardian,\n\nPlease find attached the monthly attendance report for ${d.student.name} (${d.subject.name}, ${d.month_label}).\n\n${d.note}\n\nKind regards,\n${d.academy}${d.contact ? '\n' + d.contact : ''}`)}` } : {})}>2. Open email{okEm ? ` (${em})` : ''}</a>
        {!okEm && <div className="small mute">No guardian email address is registered.</div>}
        <div className="row wrap">
          <button className="btn" disabled={!wnum} onClick={() => record('whatsapp', s.guardian_mobile)}>3. Record: sent by WhatsApp</button>
          <button className="btn" disabled={!okEm} onClick={() => record('email', em)}>3. Record: sent by email</button>
        </div>
      </div>
      <div className="card"><h3>Sent record</h3>
        {hist.length ? <div className="list small">{hist.map(h => (
          <div key={h.id} style={{ alignItems: 'flex-start' }}><div className="grow"><b>{h.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</b> to {h.to_address}<div className="mute">{fDT(h.at)} · {h.by_name}</div><div className="mute">Report then: {h.summary.attended} of {h.summary.held} attended</div></div><span className="chip ok">Recorded</span></div>
        ))}</div> : <div className="mute small">Not sent yet.</div>}
      </div>
      <div className="foot"><button className="btn" onClick={close}>Close</button></div>
    </div>
  );
}

/** What the parent will see (matches the PDF). */
function ReportCard({ d, fmt }: { d: ParentData; fmt: (v: number) => string }) {
  const s = d.summary, f = d.fee, fmo = f.month, multi = fmo.subjects > 1, o = f.owed;
  const extra: string[] = [];
  if (s.cancelled) extra.push(`${s.cancelled} ${s.cancelled === 1 ? 'class was' : 'classes were'} cancelled and ${s.cancelled === 1 ? 'is' : 'are'} not counted.`);
  if (s.late) extra.push(`${s.late} of the attended classes ${s.late === 1 ? 'was' : 'were'} joined late.`);
  if (s.pending) extra.push(`${s.pending} ${s.pending === 1 ? 'class is' : 'classes are'} not yet recorded or still to come.`);
  const fnote = fmo.state === 'part' ? `${fmt(fmo.paid)} received · ${fmt(fmo.outstanding)} due` : fmo.state === 'due' ? `${fmt(fmo.outstanding)} due${fmo.due_date ? ' · ' + dShortDue(fmo.due_date) : ''}` : fmo.state === 'paid' ? 'Thank you' : '';
  const bits: string[] = [];
  if (o.previous > 0) bits.push(`${fmt(o.previous)} is from earlier months`);
  if (o.later > 0) bits.push(`${fmt(o.later)} is for later months`);
  return (
    <div className="prv">
      <div className="prv-h">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/logo-emblem-128.webp" alt="" width={40} height={36} /><div><b>{d.academy}</b><span>Monthly Attendance Report</span></div></div>
      <div className="prv-b">
        <div className="prv-l">Student</div><div className="prv-n">{d.student.name}</div>
        <dl className="prv-i"><dt>Month</dt><dd>{d.month_label}</dd><dt>Subject</dt><dd>{d.subject.name}</dd><dt>Class</dt><dd>{d.student.batch}</dd>{d.teacher && <><dt>Teacher</dt><dd>{d.teacher}</dd></>}</dl>
        <h4>Summary</h4>
        <div className="prv-t">
          <div><b>{s.held}</b><span>Classes held</span></div><div><b style={{ color: 'var(--ok)' }}>{s.attended}</b><span>Attended</span></div>
          <div><b style={{ color: s.missed ? 'var(--bad)' : 'inherit' }}>{s.missed}</b><span>Missed</span></div><div><b>{s.percent == null ? '—' : s.percent + '%'}</b><span>Attendance</span></div>
        </div>
        {extra.length > 0 && <p className="prv-x">{extra.join(' ')}</p>}
        <div className="prv-fee">
          <div><div className="prv-l">{multi ? 'Fees' : 'Fee'} for {d.month_label}</div><div className="prv-amt">{!fmo.billed && !fmo.total ? '—' : fmt(fmo.total)}</div>
            <div className="prv-x" style={{ margin: '2px 0 0' }}>{multi ? `${fmo.subjects} subjects · ${f.classes} classes each · paid in advance` : `for ${f.classes} classes · collected in advance`}</div></div>
          <div className="prv-pay"><div className="prv-l">Payment status</div><span className={'prv-pill fee-' + fmo.state}>{fmo.label}</span>{fnote && <div className="prv-x" style={{ margin: '4px 0 0' }}>{fnote}</div>}</div>
        </div>
        <h4>Outstanding fees <span className="prv-asof">as of {fDateY(o.as_of + 'T12:00:00Z')}</span></h4>
        {o.lines.length ? (
          <>
            <table className="prv-tb"><thead><tr><th>Fee</th><th>Due</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
              <tbody>{o.lines.map((l, i) => (
                <tr key={i}><td>{l.period_label} · {l.subject}</td><td style={{ whiteSpace: 'nowrap', ...(l.overdue ? { color: '#b91c1c', fontWeight: 700 } : {}) }}>{dShortDue(l.due_date)}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(l.outstanding)}</td></tr>
              ))}<tr className="prv-tot"><td colSpan={2}>Total outstanding</td><td style={{ textAlign: 'right' }}>{fmt(o.total)}</td></tr></tbody></table>
            {bits.length > 0 && <p className="prv-x">{bits.join(' · ')}.</p>}
          </>
        ) : <div className="prv-ok">No outstanding fees. Thank you.</div>}
        {f.month_fees.length > 1 && (
          <>
            <h4>All subjects – {d.month_label}</h4>
            <table className="prv-tb"><thead><tr><th>Subject</th><th>Fee</th><th>Payment</th></tr></thead>
              <tbody>{f.month_fees.map(m => (
                <tr key={m.subject_id}><td style={m.current ? { fontWeight: 700 } : undefined}>{m.subject}</td><td>{m.amount == null ? '—' : fmt(m.amount)}</td><td><span className={'fee-txt fee-c-' + m.state}>● {feeWord(m.label)}</span></td></tr>
              ))}</tbody></table>
          </>
        )}
        <h4>Class by class</h4>
        {d.rows.length ? (
          <table className="prv-tb"><thead><tr><th>Date</th><th>Time</th><th>Status</th></tr></thead>
            <tbody>{d.rows.map((r, i) => <tr key={i}><td>{r.date}</td><td>{r.time}</td><td className={'st-' + r.status}><i />{r.label}</td></tr>)}</tbody></table>
        ) : <p className="prv-x">No classes were scheduled this month.</p>}
        <div className="prv-note">{d.note}{d.contact && <div className="prv-x" style={{ margin: '4px 0 0' }}>{d.contact}</div>}<b>{d.academy}</b></div>
      </div>
    </div>
  );
}
