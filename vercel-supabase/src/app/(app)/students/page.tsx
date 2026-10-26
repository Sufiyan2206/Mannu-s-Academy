'use client';
import { useCallback, useMemo, useState } from 'react';
import { db } from '@/lib/client';
import { useApp } from '@/state/app';
import { CURRENCIES, csvOf, isEmail, saveFile, skey, SUBJECTS, subj, tidySchool } from '@/lib/format';
import { waNum } from '@/lib/whatsapp';
import type { Student, SubjectId } from '@/lib/types';
import { Empty, Field, Form, Options, useUI } from '@/components/ui';

export default function Students() {
  const app = useApp(), { openModal, toast } = useUI();
  const [q, setQ] = useState(''), [batch, setBatch] = useState(''), [sub, setSub] = useState(''), [school, setSchool] = useState('');
  const schools = app.schoolNames();
  const rows = useMemo(() => {
    const t = q.toLowerCase();
    return app.students.filter(s => s.active && (!batch || s.batch_id === batch) && (!sub || s.subjects.includes(sub as SubjectId))
      && (!school || (school === '__none' ? !skey(s.school) : skey(s.school) === skey(school)))
      && (!t || [s.name, s.email, s.mobile, s.school || ''].some(x => x.toLowerCase().includes(t))))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [app.students, q, batch, sub, school]);

  const studentModal = useCallback((s?: Student) => {
    openModal(s ? 'Edit student' : 'Add student', close => (
      <Form close={close} label={s ? 'Save changes' : 'Add student'} onSubmit={async f => {
        const o = {
          name: f.trim('name'), email: f.trim('email').toLowerCase(), zoom_email: f.trim('zoom_email').toLowerCase(), mobile: f.trim('mobile'),
          guardian_name: f.trim('gname'), guardian_mobile: f.trim('gmobile'), guardian_email: f.trim('gemail').toLowerCase(), school: tidySchool(f.get('school')),
          batch_id: f.get('batch'), currency: f.get('cur'), subjects: f.all('sub') as SubjectId[],
        };
        const cc = app.settings.cc;
        if (!o.name) throw new Error('Enter the student’s name.');
        if (!isEmail(o.email)) throw new Error('Enter a valid student email address.');
        if (o.zoom_email && !isEmail(o.zoom_email)) throw new Error('Enter a valid Zoom email, or leave it blank.');
        if (!waNum(o.mobile, cc)) throw new Error('Enter the student’s mobile number with country code (e.g. +94771234567), or set a default country code in Setup.');
        if (!o.guardian_name) throw new Error('Enter the parent or guardian’s name.');
        if (!waNum(o.guardian_mobile, cc)) throw new Error('Enter the parent’s mobile number with country code (e.g. +94771234567), or set a default country code in Setup.');
        if (o.school.length > 120) throw new Error('The school name can be at most 120 characters.');
        if (!o.batch_id) throw new Error('Choose a batch.');
        if (!o.subjects.length) throw new Error('Choose at least one subject.');
        const active = s ? f.checked('active') : true;
        if (active && app.students.some(x => x.active && x.email.toLowerCase() === o.email && x.id !== s?.id)) throw new Error('Another student already uses this email.');
        if (s && o.currency !== (s.currency || app.settings.currency) && app.isAdmin
          && (app.charges.some(c => c.student_id === s.id && !c.voided) || app.payments.some(p => p.student_id === s.id && !p.voided)))
          throw new Error('This student already has fees in ' + s.currency + '. Fee currency can only change before any charges or payments are recorded.');
        const res = s ? await db.from('students').update({ ...o, active }).eq('id', s.id) : await db.from('students').insert(o);
        if (res.error) throw new Error(res.error.code === '23505' ? 'Another student already uses this email.' : res.error.message);
        await app.reload('students');
        close(); toast(s ? 'Student updated' : 'Student added');
      }}>
        <Field label="Student name"><input name="name" defaultValue={s?.name || ''} autoComplete="off" /></Field>
        <div className="two">
          <Field label="Student email (registered)"><input name="email" type="email" inputMode="email" defaultValue={s?.email || ''} /></Field>
          <Field label="Student mobile (WhatsApp)"><input name="mobile" type="tel" inputMode="tel" defaultValue={s?.mobile || ''} /></Field>
        </div>
        <Field label="Zoom login email" hint="(only if different from the registered email)"><input name="zoom_email" type="email" defaultValue={s?.zoom_email || ''} /></Field>
        <div className="two">
          <Field label="Parent / guardian name"><input name="gname" defaultValue={s?.guardian_name || ''} /></Field>
          <Field label="Parent / guardian mobile"><input name="gmobile" type="tel" inputMode="tel" defaultValue={s?.guardian_mobile || ''} /></Field>
        </div>
        <Field label="Parent / guardian email" hint="(optional)"><input name="gemail" type="email" defaultValue={s?.guardian_email || ''} /></Field>
        <Field label="School name" hint="(optional – where the student currently studies; type any name)">
          <input name="school" maxLength={120} list="schl" autoComplete="off" defaultValue={s?.school || ''} placeholder="e.g. Royal College" />
          <datalist id="schl">{app.schoolNames(true).map(x => <option key={x.key} value={x.name} />)}</datalist>
        </Field>
        <Field label="Batch"><select name="batch" defaultValue={s?.batch_id || ''}><Options items={app.batches} placeholder="Choose a batch" /></select></Field>
        <Field label="Fee currency" hint="(the currency this student is billed in)">
          <select name="cur" defaultValue={s?.currency || app.settings.currency}>{app.settings.currencies.map(c => <option key={c} value={c}>{c} – {CURRENCIES[c] || c}</option>)}</select>
        </Field>
        <Field label="Subjects">
          <div className="checks">{SUBJECTS.map(x => <label key={x.id}><input type="checkbox" name="sub" value={x.id} defaultChecked={s?.subjects.includes(x.id)} />{x.name}</label>)}</div>
        </Field>
        {s && <div className="field"><label className="row" style={{ fontWeight: 500 }}><input type="checkbox" name="active" defaultChecked={s.active} /> Currently enrolled</label></div>}
      </Form>
    ));
  }, [app, openModal, toast]);

  const batchModal = useCallback(() => {
    openModal('Batches', close => <Batches close={close} />);
  }, [openModal]);

  const schoolReport = () => openModal('Students by school', () => <SchoolReport />);

  return (
    <>
      <div className="head">
        <h1>Students</h1>
        {app.isAdmin
          ? <div className="row"><button className="btn" onClick={batchModal}>Batches</button><button className="btn primary" onClick={() => app.batches.length ? studentModal() : (toast('Add a batch first'), batchModal())}>Add student</button></div>
          : <button className="btn" onClick={schoolReport}>By school</button>}
      </div>
      <div className="filters">
        <div className="wide"><input type="search" placeholder="Search name, email, mobile or school" aria-label="Search students" value={q} onChange={e => setQ(e.target.value)} /></div>
        <select aria-label="Batch" value={batch} onChange={e => setBatch(e.target.value)}><Options items={app.batches} placeholder="All batches" /></select>
        <select aria-label="Subject" value={sub} onChange={e => setSub(e.target.value)}><Options items={SUBJECTS} placeholder="All subjects" /></select>
        <select aria-label="School" className="wide" value={school} onChange={e => setSchool(e.target.value)}>
          <option value="">All schools</option><option value="__none">No school entered</option>
          {schools.map(x => <option key={x.key} value={x.name}>{x.name} ({x.students})</option>)}
        </select>
      </div>
      {app.isAdmin && <div style={{ margin: '-4px 0 10px' }}><button className="btn sm" onClick={schoolReport}>Students by school</button></div>}
      {rows.length ? (
        <div className="card list">
          {rows.map(s => (
            <div key={s.id} className={app.isAdmin ? 'tap' : ''} onClick={() => app.isAdmin && studentModal(s)}>
              <div className="grow">
                <b>{s.name}</b>
                <div className="mute small">{app.bname(s.batch_id)} · {s.subjects.map(subj).join(', ')}</div>
                {s.school && <div className="mute small">🏫 {s.school}</div>}
                <div className="mute small">{s.mobile} · {s.email}</div>
                <div className="mute small">Parent: {s.guardian_name} {s.guardian_mobile}</div>
              </div>
            </div>
          ))}
        </div>
      ) : <Empty>{app.students.length ? 'No students match.' : 'No students yet.' + (app.isAdmin ? ' Add a batch, then add your first student.' : '')}</Empty>}
    </>
  );
}

function Batches({ close }: { close: () => void }) {
  const app = useApp(), { toast, openModal } = useUI();
  const [name, setName] = useState('');
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return toast('Enter a batch name', true);
    if (app.batches.some(b => b.name.toLowerCase() === n.toLowerCase())) return toast('That batch already exists', true);
    const { error } = await db.from('batches').insert({ name: n });
    if (error) return toast(error.message, true);
    await app.reload('batches'); setName(''); toast('Batch added');
  };
  const rename = (id: string, old: string) => {
    close();
    openModal('Rename batch', c2 => (
      <Form close={c2} label="Save" onSubmit={async f => {
        const n = f.trim('n');
        if (!n) throw new Error('Enter a batch name.');
        const { error } = await db.from('batches').update({ name: n }).eq('id', id);
        if (error) throw new Error(error.code === '23505' ? 'That batch already exists.' : error.message);
        await app.reload('batches'); c2();
      }}><Field label="Batch name"><input name="n" defaultValue={old} /></Field></Form>
    ));
  };
  return (
    <>
      <div className="list">
        {app.batches.map(b => (
          <div key={b.id}><div className="grow"><b>{b.name}</b><div className="mute small">{app.students.filter(s => s.active && s.batch_id === b.id).length} students</div></div><button className="btn sm" onClick={() => rename(b.id, b.name)}>Rename</button></div>
        ))}
        {!app.batches.length && <div className="mute">No batches yet.</div>}
      </div>
      <form className="row" style={{ marginTop: 12 }} onSubmit={add} noValidate>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New batch, e.g. Grade 11 – Evening" aria-label="New batch name" />
        <button className="btn primary">Add</button>
      </form>
    </>
  );
}

function SchoolReport() {
  const app = useApp();
  const act = app.students.filter(x => x.active);
  const groups = useMemo(() => {
    const g = new Map<string, Student[]>();
    for (const s of act) { const k = skey(s.school); g.set(k, [...(g.get(k) || []), s]); }
    const nameOf = (list: Student[]) => { const c: Record<string, number> = {}; list.forEach(s => { c[s.school] = (c[s.school] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]; };
    return [...g.entries()].map(([k, list]) => ({ school: k ? nameOf(list) : null, list }))
      .sort((a, b) => Number(a.school === null) - Number(b.school === null) || b.list.length - a.list.length || String(a.school).localeCompare(String(b.school)));
  }, [act]);
  const tally = (list: Student[], f: (s: Student) => string[]) => Object.entries(list.reduce<Record<string, number>>((m, r) => { for (const n of f(r)) m[n] = (m[n] || 0) + 1; return m; }, {})).sort((a, b) => a[0].localeCompare(b[0])).map(([n, c]) => `${n} (${c})`).join(', ');
  const withS = act.filter(x => x.school).length, nS = groups.filter(g => g.school).length;
  return (
    <div className="stack">
      <div className="small mute">{nS} {nS === 1 ? 'school' : 'schools'} · {withS} of {act.length} students have a school entered. For reference only.</div>
      {groups.length ? groups.map((g, i) => (
        <details className="card" key={i}>
          <summary><b>{g.school ?? 'No school entered'}</b> <span className="mute">· {g.list.length} {g.list.length === 1 ? 'student' : 'students'}</span></summary>
          <div className="small" style={{ marginTop: 6 }}>
            <div><span className="mute">Batches:</span> {tally(g.list, r => [app.bname(r.batch_id)])}</div>
            <div><span className="mute">Subjects:</span> {tally(g.list, r => r.subjects.map(subj))}</div>
            <div style={{ marginTop: 4 }}>{g.list.map(x => x.name).join(', ')}</div>
          </div>
        </details>
      )) : <Empty>No students yet.</Empty>}
      <div className="foot"><button className="btn" onClick={() => saveFile('students-by-school.csv', csvOf([['School', 'Student', 'Batch', 'Subjects'], ...groups.flatMap(g => g.list.map(x => [g.school || '(none)', x.name, app.bname(x.batch_id), x.subjects.map(subj).join(' / ')]))]), 'text/csv')}>Download CSV</button></div>
    </div>
  );
}
