'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/client';
import { useApp } from '@/state/app';
import { fDate, fDateY, fDT, fTime, REXAMS, RICON, RTYPES, SUBJECTS, subj, todayStr } from '@/lib/format';
import { msgText, recipients, type To } from '@/lib/whatsapp';
import type { ExamType, ResHistory, Resource, ResType, SubjectId } from '@/lib/types';
import { Chip, Field, Form, Options, useUI } from './ui';
import { useOutbox } from './whatsapp';

export function useResources() {
  const app = useApp(), { openModal, toast } = useUI(), outbox = useOutbox(), router = useRouter();
  const batchNames = (r: Resource) => r.batch_ids.map(app.bname).join(', ');
  const students = (r: Resource) => app.students.filter(s => s.active && r.batch_ids.includes(s.batch_id) && s.subjects.includes(r.subject_id));
  const canEdit = (r: Resource) => r.status === 'active' && (app.isAdmin || r.by_id === app.me.id);

  const items = useCallback((r: Resource, to: To) => students(r).flatMap(s => recipients(s, to).map(x => ({
    kind: 'resource_shared' as const, student_id: s.id, class_id: r.class_id || null, role: x.role, name: x.name, number: x.number,
    text: msgText(app.settings.academy, 'resource_shared', { student: s.name, subject: subj(r.subject_id), title: r.title, kind: RTYPES[r.type], topic: r.topic, link: r.url, instructions: r.instructions }),
  }))), [app]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = useCallback((r: Resource) => {
    const n = students(r).length;
    openModal('Share on WhatsApp', close => (
      <Form close={close} label="Prepare messages" onSubmit={async f => { close(); outbox('Study material', items(r, f.get('to') as To)); }}>
        <p>{n} {n === 1 ? 'student is' : 'students are'} enrolled in {subj(r.subject_id)} for {batchNames(r)}.</p>
        <Field label="Send to"><select name="to"><option value="students">Students only</option><option value="both">Students and parents</option><option value="parents">Parents only</option></select></Field>
        <p className="mute small">The message contains the link, so anyone who has it can open the material. Set the Drive or video link to restricted access if it should stay private.</p>
      </Form>
    ));
  }, [app, openModal, outbox, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = useCallback(async (r: Resource, action: string, changes: Record<string, [string, string]> | null, note: string, patch: Partial<Resource>) => {
    const now = new Date().toISOString();
    const { error } = await db.from('resources').update({ ...patch, updated_at: now, updated_by: app.by }).eq('id', r.id);
    if (error) throw new Error(error.message);
    await db.from('resource_history').insert({ resource_id: r.id, action, by_name: app.by, changes, note });
    await app.reload('resources');
  }, [app]);

  const form = useCallback((r?: Resource, pre: { subject_id?: SubjectId; batch_id?: string; class_id?: string } = {}) => {
    if (!app.batches.length) { toast('Add a batch first (Students → Batches)', true); router.push('/students'); return; }
    openModal(r ? 'Edit resource' : 'Add resource', close => <ResourceForm r={r} pre={pre} close={close} onSaved={(target, notify) => { if (notify) outbox('Study material', items(target, notify)); }} change={change} />);
  }, [app, openModal, toast, router, outbox, items, change]);

  const detail = useCallback((r: Resource) => {
    openModal(r.title, close => <ResDetail id={r.id} close={close} share={share} edit={form} change={change} canEdit={canEdit} batchNames={batchNames} />);
  }, [openModal, share, form, change]); // eslint-disable-line react-hooks/exhaustive-deps

  return { share, form, detail, canEdit, batchNames };
}

export function ResCard({ r }: { r: Resource }) {
  const { share, detail, batchNames } = useResources();
  return (
    <div className={`cls sub-${subj(r.subject_id)} ${r.status === 'removed' ? 'cancelled' : ''}`}>
      <div className="bar" />
      <div className="body" style={{ paddingLeft: 12 }}>
        <div className="row between wrap"><h3 style={{ cursor: 'pointer' }} onClick={() => detail(r)}>{RICON[r.type] || '📎'} {r.title}</h3>{r.status === 'removed' && <span className="chip bad">Removed</span>}</div>
        <div className="meta">{subj(r.subject_id)} · {RTYPES[r.type]}{r.exam_type !== 'none' ? ' · ' + REXAMS[r.exam_type] : ''}{r.topic ? ' · ' + r.topic : ''} · {fDateY(r.date + 'T12:00:00Z')}</div>
        <div className="meta">{batchNames(r)}{r.by_name ? ' · by ' + r.by_name : ''}</div>
        {r.tags.length > 0 && <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>{r.tags.map(t => <span key={t} className="chip plain">{t}</span>)}</div>}
        <div className="acts">
          {r.status === 'active' && <><a className="btn sm primary" href={r.url} target="_blank" rel="noopener">Open link</a><button className="btn sm" onClick={() => share(r)}>Share on WhatsApp</button></>}
          <button className="btn sm" onClick={() => detail(r)}>Details</button>
        </div>
      </div>
    </div>
  );
}

function ResDetail({ id, close, share, edit, change, canEdit, batchNames }: {
  id: string; close: () => void; share: (r: Resource) => void; edit: (r: Resource) => void;
  change: (r: Resource, action: string, changes: Record<string, [string, string]> | null, note: string, patch: Partial<Resource>) => Promise<void>;
  canEdit: (r: Resource) => boolean; batchNames: (r: Resource) => string;
}) {
  const app = useApp(), { openModal, toast } = useUI();
  const r = app.resources.find(x => x.id === id);
  const [hist, setHist] = useState<ResHistory[]>([]);
  useEffect(() => {
    if (!app.isAdmin) return;
    db.from('resource_history').select('*').eq('resource_id', id).order('at', { ascending: true }).then(({ data }) => setHist((data || []) as ResHistory[]));
  }, [id, app.isAdmin, r?.updated_at]);
  if (!r) return <p className="mute">This resource no longer exists.</p>;
  const c = r.class_id ? app.classes.find(x => x.id === r.class_id) : undefined;
  const remove = () => {
    close();
    openModal('Remove resource', c2 => (
      <Form close={c2} danger label="Remove resource" onSubmit={async f => { await change(r, 'removed', null, f.trim('r'), { status: 'removed' }); c2(); toast('Resource removed'); }}>
        <p>“{r.title}” will be hidden from the library. An admin can restore it, and the removal is recorded.</p>
        <Field label="Reason" hint="(optional)"><input name="r" /></Field>
      </Form>
    ));
  };
  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 6 }}>
        <Chip>{subj(r.subject_id)}</Chip><Chip kind="plain">{RTYPES[r.type]}</Chip>
        {r.exam_type !== 'none' && <Chip kind="plain">{REXAMS[r.exam_type]}</Chip>}{r.status === 'removed' && <Chip kind="bad">Removed</Chip>}
      </div>
      {r.description && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.description}</p>}
      {r.instructions && <div className="alert info" style={{ display: 'block' }}><b>Instructions</b><div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{r.instructions}</div></div>}
      <dl className="kv">
        <dt>Date</dt><dd>{fDateY(r.date + 'T12:00:00Z')}</dd>
        {r.topic && <><dt>Topic</dt><dd>{r.topic}</dd></>}
        <dt>Shared with</dt><dd>{batchNames(r)}</dd>
        {r.tags.length > 0 && <><dt>Tags</dt><dd>{r.tags.join(', ')}</dd></>}
        <dt>Link</dt><dd style={{ wordBreak: 'break-all' }}>{r.url}</dd>
        {c && <><dt>Zoom class</dt><dd>{c.title} · {fDT(c.start_at)}</dd></>}
        <dt>Added by</dt><dd>{r.by_name || '—'}</dd>
        {r.updated_at !== r.created_at && <><dt>Updated</dt><dd>{fDT(r.updated_at)}{r.updated_by ? ' by ' + r.updated_by : ''}</dd></>}
      </dl>
      {app.isAdmin && hist.length > 0 && (
        <div><h3>Record of changes</h3>
          <div className="list small">
            {[...hist].reverse().map(h => (
              <div key={h.id} style={{ alignItems: 'flex-start' }}>
                <div className="grow"><b>{h.action}</b>{h.note ? ' · ' + h.note : ''}
                  {h.changes && <div className="mute" style={{ marginTop: 2 }}>{Object.entries(h.changes).map(([k, [o, n]]) => <div key={k}>{k}: {o || '—'} → {n || '—'}</div>)}</div>}
                </div>
                <div className="right mute">{h.by_name}<br />{fDT(h.at)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="foot">
        {r.status === 'removed'
          ? (app.isAdmin ? <button className="btn primary" onClick={async () => { try { await change(r, 'restored', null, '', { status: 'active' }); close(); toast('Resource restored'); } catch (e) { toast((e as Error).message, true); } }}>Restore</button> : null)
          : <>
            {canEdit(r) && <><button className="btn danger" onClick={remove}>Remove</button><button className="btn" onClick={() => { close(); edit(r); }}>Edit</button></>}
            <button className="btn" onClick={() => { close(); share(r); }}>Share on WhatsApp</button>
            <a className="btn primary" href={r.url} target="_blank" rel="noopener">Open link</a>
          </>}
      </div>
    </div>
  );
}

function ResourceForm({ r, pre, close, onSaved, change }: {
  r?: Resource; pre: { subject_id?: SubjectId; batch_id?: string; class_id?: string }; close: () => void; onSaved: (target: Resource, notify: To | '') => void;
  change: (r: Resource, action: string, changes: Record<string, [string, string]> | null, note: string, patch: Partial<Resource>) => Promise<void>;
}) {
  const app = useApp(), { toast } = useUI();
  const [sub, setSub] = useState<string>(r?.subject_id || pre.subject_id || '');
  const [bs, setBs] = useState<Set<string>>(new Set(r?.batch_ids || (pre.batch_id ? [pre.batch_id] : [])));
  const topics = useMemo(() => [...new Set(app.resources.map(x => x.topic).filter(Boolean))], [app.resources]);
  const classOptions = useMemo(() => app.classes.filter(c => c.status === 'scheduled' && c.subject_id === sub && bs.has(c.batch_id)).sort((a, b) => b.start_at.localeCompare(a.start_at)).slice(0, 40), [app.classes, sub, bs]);

  return (
    <Form close={close} label={r ? 'Save changes' : 'Add resource'} onSubmit={async f => {
      const d = {
        title: f.trim('title'), subject_id: f.get('sub') as SubjectId, type: f.get('type') as ResType, batch_ids: f.all('bx'), url: f.trim('url'), topic: f.trim('topic'),
        exam_type: f.get('exam') as ExamType, date: f.get('date'), description: f.trim('description'), instructions: f.trim('instructions'),
        tags: [...new Set(f.get('tags').split(',').map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10), class_id: f.get('cls') || null,
      };
      if (!d.title) throw new Error('Enter a title.'); if (!d.subject_id) throw new Error('Choose a subject.'); if (!d.batch_ids.length) throw new Error('Choose at least one batch to share with.');
      if (!/^https:\/\/[^\s<>"']+$/i.test(d.url) || d.url.length > 500) throw new Error('Paste a valid link that starts with https://');
      if (!d.date) throw new Error('Choose a date.');
      const notify = f.get('notify') as To | '';
      let target: Resource | undefined = r;
      if (r) {
        const names = (ids: string[]) => ids.map(app.bname).join(', '), ch: Record<string, [string, string]> = {};
        const diff = (k: string, a: unknown, b: unknown) => { if (String(a ?? '') !== String(b ?? '')) ch[k] = [String(a ?? ''), String(b ?? '')]; };
        diff('title', r.title, d.title); diff('subject', subj(r.subject_id), subj(d.subject_id)); diff('type', RTYPES[r.type], RTYPES[d.type]); diff('exam type', REXAMS[r.exam_type], REXAMS[d.exam_type]);
        diff('topic', r.topic, d.topic); diff('date', r.date, d.date); diff('link', r.url, d.url); diff('description', r.description, d.description); diff('instructions', r.instructions, d.instructions);
        diff('tags', r.tags.join(', '), d.tags.join(', ')); diff('shared with', names(r.batch_ids), names(d.batch_ids)); diff('linked class', r.class_id, d.class_id);
        if (!Object.keys(ch).length) { toast('No changes to save'); return; }
        await change(r, 'updated', ch, '', d);
        target = { ...r, ...d };
      } else {
        const ins = await db.from('resources').insert({ ...d, by_id: app.me.id, by_name: app.by, updated_by: '' }).select('*').single();
        if (ins.error) throw new Error(ins.error.message);
        target = ins.data as Resource;
        await db.from('resource_history').insert({ resource_id: target.id, action: 'created', by_name: app.by, changes: null, note: 'Added a link' });
        await app.reload('resources');
      }
      close(); toast(r ? 'Resource updated' : 'Resource added');
      if (notify && target) onSaved(target, notify);
    }}>
      <Field label="Title"><input name="title" maxLength={150} defaultValue={r?.title || ''} placeholder="e.g. Alkenes – model paper 1" /></Field>
      <div className="two">
        <Field label="Subject"><select name="sub" value={sub} onChange={e => setSub(e.target.value)}><Options items={SUBJECTS} placeholder="Choose a subject" /></select></Field>
        <Field label="Resource type"><select name="type" defaultValue={r?.type || 'notes'}>{Object.entries(RTYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      <Field label="Share with batches" hint="(only students enrolled in this subject receive it)">
        <div className="checks">{app.batches.map(b => (
          <label key={b.id}><input type="checkbox" name="bx" value={b.id} checked={bs.has(b.id)} onChange={e => setBs(s => { const n = new Set(s); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })} />{b.name}</label>
        ))}</div>
      </Field>
      <Field label="Link to the file or video" hint="(Google Drive, OneDrive, YouTube, Vimeo… https only)"><input name="url" type="url" inputMode="url" placeholder="https://" defaultValue={r?.url || ''} /></Field>
      <div className="two">
        <Field label="Topic"><input name="topic" list="tpl" maxLength={100} defaultValue={r?.topic || ''} placeholder="e.g. Alkenes" /><datalist id="tpl">{topics.map(t => <option key={t} value={t} />)}</datalist></Field>
        <Field label="Exam type"><select name="exam" defaultValue={r?.exam_type || 'none'}>{Object.entries(REXAMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      <Field label="Date"><input name="date" type="date" defaultValue={r?.date || todayStr()} /></Field>
      <Field label="Description" hint="(optional)"><textarea name="description" maxLength={2000} defaultValue={r?.description || ''} /></Field>
      <Field label="Instructions for students" hint="(optional)"><textarea name="instructions" maxLength={1500} defaultValue={r?.instructions || ''} placeholder="e.g. Attempt in 90 minutes, then check the marking scheme." /></Field>
      <Field label="Tags" hint="(comma-separated, optional)"><input name="tags" defaultValue={(r?.tags || []).join(', ')} placeholder="e.g. organic, past paper" /></Field>
      <Field label="Related Zoom class" hint="(optional)">
        <select name="cls" defaultValue={r?.class_id || pre.class_id || ''} key={sub + [...bs].join()}>
          <option value="">Not linked to a class</option>
          {classOptions.map(c => <option key={c.id} value={c.id}>{fDate(c.start_at)}, {fTime(c.start_at)} · {app.bname(c.batch_id)}</option>)}
        </select>
      </Field>
      <Field label={r ? 'Notify students on WhatsApp about this update?' : 'Prepare WhatsApp message?'}>
        <select name="notify" defaultValue={r ? '' : 'students'}>
          <option value={r ? '' : 'students'}>{r ? 'No' : 'Yes – students'}</option><option value="both">Yes – students and parents</option><option value="parents">Yes – parents only</option>
          {r ? <option value="students">Yes – students only</option> : <option value="">No, not now</option>}
        </select>
      </Field>
    </Form>
  );
}

