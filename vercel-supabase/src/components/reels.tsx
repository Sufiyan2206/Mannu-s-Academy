'use client';
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, db } from '@/lib/client';
import { useApp } from '@/state/app';
import { fDateISO, fDateY, fDT, localInput, mmss, num, parseT, SUBJECTS, subj, tz } from '@/lib/format';
import { zonedToUtc } from '@/lib/tz';
import { buildCaption, CLABEL, consentIssue, redactT, reelState, RST, ytInfo, ytLink, type ReelState } from '@/lib/reels';
import type { Reel, ReelDecision, ReelHistory } from '@/lib/types';
import { Chip, Field, Form, Options, useConfirm, useUI } from './ui';
import { useEffect, useState } from 'react';

export function useReels() {
  const app = useApp(), { openModal, toast } = useUI(), router = useRouter(), confirm = useConfirm();
  const consentOf = (id: string) => app.consent[id]?.status || 'unknown';
  const studentName = (id: string) => app.students.find(s => s.id === id)?.name || 'a student';
  const issueOf = (r: Reel) => consentIssue(r, consentOf, studentName);
  const stateOf = (r: Reel): ReelState => reelState(r, app.decisions[r.id], issueOf(r));
  const canEdit = (r: Reel, st: ReelState) => ['draft', 'awaiting_approval', 'scheduled', 'failed'].includes(st.s) && (app.isAdmin || r.by_id === app.me.id);

  /** Saves the draft and/or the admin’s decision, plus the record of who did what. */
  const change = useCallback(async (r: Reel, action: string, note: string, reelPatch?: Partial<Reel>, decPatch?: Partial<ReelDecision>) => {
    const now = new Date().toISOString();
    if (reelPatch) {
      const { error } = await db.from('reels').update({ ...reelPatch, updated_at: now }).eq('id', r.id);
      if (error) throw new Error(error.message);
    } else {
      await db.from('reels').update({ updated_at: now }).eq('id', r.id);
    }
    await db.from('reel_history').insert({ reel_id: r.id, scope: 'draft', action, by_name: app.by, note });
    if (decPatch) {
      const cur = app.decisions[r.id];
      const { error } = await db.from('reel_decisions').upsert({ reel_id: r.id, rev: cur?.rev ?? r.rev, ...decPatch, by_name: app.by, at: now });
      if (error) throw new Error(error.message);
      await db.from('reel_history').insert({ reel_id: r.id, scope: 'decision', action, by_name: app.by, note });
    }
    await app.reload('reels', 'decisions');
  }, [app]);

  const approve = useCallback((r: Reel) => {
    const issue = issueOf(r);
    if (issue) return toast(issue, true);
    openModal('Approve this Reel', close => <ApproveForm r={r} close={close} change={change} />);
  }, [app]); // eslint-disable-line react-hooks/exhaustive-deps

  const metrics = useCallback((r: Reel) => {
    const m = app.decisions[r.id]?.metrics || null;
    const k = (n: string, l: string) => <Field label={l}><input name={n} inputMode="numeric" defaultValue={(m as Record<string, number | null> | null)?.[n] ?? ''} placeholder="—" /></Field>;
    openModal('Numbers from Instagram', close => (
      <Form close={close} label="Save numbers" onSubmit={async f => {
        const o: Record<string, number | null> = {};
        for (const n of ['views', 'reach', 'likes', 'comments', 'shares', 'saved']) {
          const v = f.trim(n).replace(/,/g, '');
          if (v === '') { o[n] = null; continue; }
          if (!/^\d+$/.test(v)) throw new Error('Numbers only, please.');
          o[n] = +v;
        }
        await change(r, 'numbers updated', '', undefined, { state: app.decisions[r.id]?.state || 'published', metrics: { ...o, as_of: new Date().toISOString() } as ReelDecision['metrics'] });
        close(); toast('Numbers saved');
      }}>
        <div className="two">{k('views', 'Views')}{k('reach', 'Reach')}</div><div className="two">{k('likes', 'Likes')}{k('comments', 'Comments')}</div><div className="two">{k('shares', 'Shares')}{k('saved', 'Saves')}</div>
        <p className="mute small">These are filled in automatically for Reels the app published. For Reels you posted by hand, copy them from Instagram Insights. Leave blank anything Instagram does not show.</p>
      </Form>
    ));
  }, [app, change, openModal, toast]);

  const form = useCallback((r?: Reel) => {
    if (!app.batches.length) { toast('Add a batch first (Students → Batches)', true); router.push('/students'); return; }
    openModal(r ? 'Edit Reel' : 'New Reel', close => <ReelForm r={r} close={close} change={change} />);
  }, [app, openModal, toast, router, change]);

  const detail = useCallback((r: Reel) => {
    openModal(r.title, close => <ReelDetail id={r.id} close={close} change={change} approve={approve} metrics={metrics} edit={form} confirm={confirm} />);
  }, [openModal, change, approve, metrics, form, confirm]);

  return { stateOf, issueOf, canEdit, change, approve, metrics, form, detail, consentOf, studentName };
}

export function ReelChips({ st }: { st: ReelState }) {
  return (
    <>
      <Chip kind={RST[st.s][1]}>{RST[st.s][0]}</Chip>
      {st.s === 'scheduled' && st.at && new Date(st.at) < new Date() && <Chip kind="bad">Time has passed – mark as published</Chip>}
      {st.alert && <Chip kind="bad">Consent issue</Chip>}
    </>
  );
}

export function ReelCard({ r }: { r: Reel }) {
  const app = useApp(), { stateOf, detail } = useReels();
  const st = stateOf(r), d = app.decisions[r.id], m = d?.metrics;
  return (
    <div className={`cls sub-${subj(r.subject_id)} ${st.s === 'deleted' ? 'cancelled' : ''}`}>
      <div className="bar" />
      <div className="body" style={{ paddingLeft: 12 }}>
        <h3 style={{ cursor: 'pointer' }} onClick={() => detail(r)}>🎬 {r.title}</h3>
        <div className="row wrap" style={{ gap: 6, marginTop: 4 }}><ReelChips st={st} />{r.recording_id && <Chip kind="plain">From a recording</Chip>}</div>
        <div className="meta">{subj(r.subject_id)} · {app.bname(r.batch_id)} · {r.teacher_name || '—'}{r.topic ? ' · ' + r.topic : ''}</div>
        <div className="meta">{st.s === 'scheduled' ? 'Planned for ' + fDT(st.at) : st.s === 'published' ? 'Published ' + fDT(d?.published_at) : 'Created ' + fDT(r.created_at)}{r.clip_len ? ' · ' + Math.round(r.clip_len) + ' s' : ''}</div>
        {st.s === 'published' && m && <div className="meta">👁 {num(m.views)} views · ♥ {num(m.likes)} · 💬 {num(m.comments)} · ↗ {num(m.shares)} · reach {num(m.reach)}</div>}
        {st.note && st.s === 'draft' && <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>{st.note}</div>}
        {st.s === 'failed' && st.note && <div className="small" style={{ color: 'var(--bad)', marginTop: 4 }}>{st.note}</div>}
        <div className="acts">
          <button className={`btn sm ${st.s === 'awaiting_approval' && app.isAdmin ? 'primary' : ''}`} onClick={() => detail(r)}>{st.s === 'awaiting_approval' && app.isAdmin ? 'Review' : 'Open'}</button>
          {d?.ig_url && st.s !== 'deleted' && <a className="btn sm" href={d.ig_url} target="_blank" rel="noopener">View on Instagram</a>}
        </div>
      </div>
    </div>
  );
}

function ApproveForm({ r, close, change }: { r: Reel; close: () => void; change: ReturnType<typeof useReels>['change'] }) {
  const app = useApp(), { toast } = useUI();
  const [later, setLater] = useState(false);
  return (
    <Form close={close} label="Approve" onSubmit={async f => {
      if (r.appears === 'none' && !f.checked('cf')) throw new Error('Please confirm that you have watched the clip.');
      const at = later ? zonedToUtc(f.get('dt'), tz()) : new Date().toISOString();
      if (!at) throw new Error('Choose the date and time.');
      if (later && new Date(at).getTime() < Date.now() - 60000) throw new Error('That time is in the past.');
      await change(r, 'approved', later ? 'Planned for ' + fDT(at) : 'Ready to post now',
        r.submitted ? undefined : { submitted: true, submitted_at: new Date().toISOString() }, { state: 'approved', rev: r.rev, scheduled_at: at });
      close(); toast(later ? 'Approved and planned' : 'Approved');
    }}>
      <div className="stack">
        <div className="small">{r.appears === 'none' ? 'The teacher says no student is visible, audible or named.' : 'Students in this clip have consent on record.'}</div>
        <label className="row" style={{ fontWeight: 500 }}><input type="radio" name="w" checked={!later} onChange={() => setLater(false)} /> Ready to post now</label>
        <label className="row" style={{ fontWeight: 500 }}><input type="radio" name="w" checked={later} onChange={() => setLater(true)} /> Plan a date and time</label>
        {later && <Field label={`Date and time (${tz()})`}><input name="dt" type="datetime-local" min={localInput(new Date().toISOString())} defaultValue={localInput(new Date(Date.now() + 3600e3).toISOString())} /></Field>}
        {r.appears === 'none' && <label className="row" style={{ fontWeight: 500, alignItems: 'flex-start' }}><input type="checkbox" name="cf" /> <span>I have watched the clip. No student is visible, audible or named in it.</span></label>}
        <p className="mute small" style={{ margin: 0 }}>Reels made from a recording are posted to Instagram by the app once approved. For a Reel you made yourself, post it on Instagram (or schedule it in Meta Business Suite), then use “Mark as published”.</p>
      </div>
    </Form>
  );
}

function ReelDetail({ id, close, change, approve, metrics, edit, confirm }: {
  id: string; close: () => void; change: ReturnType<typeof useReels>['change']; approve: (r: Reel) => void; metrics: (r: Reel) => void; edit: (r: Reel) => void;
  confirm: ReturnType<typeof useConfirm>;
}) {
  const app = useApp(), { openModal, toast } = useUI();
  const x = useReels();
  const r = app.reels.find(v => v.id === id);
  const [hist, setHist] = useState<ReelHistory[]>([]);
  useEffect(() => {
    if (!app.isAdmin) return;
    db.from('reel_history').select('*').eq('reel_id', id).order('at', { ascending: false }).then(({ data }) => setHist((data || []) as ReelHistory[]));
  }, [id, app.isAdmin, r?.updated_at, app.decisions[id]?.at]);
  if (!r) return <p className="mute">This Reel no longer exists.</p>;
  const st = x.stateOf(r), d = app.decisions[r.id] || ({} as Partial<ReelDecision>), admin = app.isAdmin, ed = x.canEdit(r, st);
  const link = ytLink(r.yt_url, r.yt_start), red = redactT(r.caption, app.students);
  const done = () => close();
  const doit = async (fn: () => Promise<void>, msg?: string) => { try { await fn(); if (msg) toast(msg); done(); } catch (e) { toast((e as Error).message, true); } };
  const watch = async () => {
    if (!r.clip_path) return;
    try { const { url } = await api<{ url: string }>('/api/media/sign', { reelId: r.id }); window.open(url, '_blank', 'noopener'); }
    catch (e) { toast('Could not open the clip: ' + (e as Error).message, true); }
  };
  const reasonForm = (title: string, intro: React.ReactNode, label: string, field: string, req: boolean, run: (v: string) => Promise<void>, danger = false) => {
    close();
    openModal(title, c2 => (
      <Form close={c2} label={label} danger={danger} onSubmit={async f => { if (req && !f.trim('v')) throw new Error('Tell the teacher what to change.'); await run(f.trim('v')); c2(); }}>
        {intro}<Field label={field}><input name="v" maxLength={500} /></Field>
      </Form>
    ));
  };
  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 6 }}><ReelChips st={st} /></div>
      {st.alert && <div className="alert bad" style={{ display: 'block' }}>{st.alert}</div>}
      {st.note && st.s === 'draft' && <div className="alert" style={{ display: 'block' }}>{st.note}</div>}
      {st.s === 'failed' && st.note && <div className="alert bad" style={{ display: 'block' }}>{st.note}</div>}
      <dl className="kv">
        <dt>Subject</dt><dd>{subj(r.subject_id)}</dd><dt>Batch</dt><dd>{app.bname(r.batch_id)}</dd><dt>Topic</dt><dd>{r.topic || '—'}</dd><dt>Teacher</dt><dd>{r.teacher_name || '—'}</dd>
        <dt>Clip</dt><dd style={{ wordBreak: 'break-all' }}>{r.clip_path ? <button className="btn sm" onClick={watch}>Watch the clip</button> : <a href={r.clip_url} target="_blank" rel="noopener">{r.clip_url}</a>}{r.clip_len ? ' · ' + Math.round(r.clip_len) + ' s' : ''}</dd>
        {link && <><dt>Full class</dt><dd style={{ wordBreak: 'break-all' }}><a href={link} target="_blank" rel="noopener">{link}</a>{r.yt_start ? ` (from ${mmss(r.yt_start)})` : ''}</dd></>}
        <dt>Students</dt>
        <dd>{r.appears === 'none' ? 'None visible, audible or named' : r.appears === 'students' ? r.appearing.map(i => <div key={i}>{x.studentName(i)} <Chip kind={CLABEL[x.consentOf(i)][1]}>{CLABEL[x.consentOf(i)][0]}</Chip></div>) : <Chip kind="warn">Not declared</Chip>}</dd>
        {st.s === 'scheduled' && <><dt>Planned for</dt><dd>{fDT(st.at)}</dd></>}
        {d.state === 'published' && <><dt>Published</dt><dd>{fDT(d.published_at)}</dd><dt>Instagram</dt><dd style={{ wordBreak: 'break-all' }}>{d.ig_url ? <a href={d.ig_url} target="_blank" rel="noopener">{d.ig_url}</a> : '—'}</dd></>}
        <dt>Made by</dt><dd>{r.by_name || '—'} · {fDT(r.created_at)}</dd>
      </dl>
      <div>
        <label>Caption</label>
        <div className="card small" style={{ whiteSpace: 'pre-wrap' }}>{red.text}</div>
        {(Object.keys(red.masked).length > 0 || red.pii > 0) && <div className="small mute" style={{ marginTop: 4 }}>Student names or contact details are hidden in the copy: {Object.keys(red.masked).join(', ')}{red.pii ? ` (+ ${red.pii} phone/email)` : ''}.</div>}
        <div className="row wrap" style={{ marginTop: 6 }}><button className="btn sm" onClick={() => navigator.clipboard?.writeText(red.text).then(() => toast('Copied'), () => toast('Copy failed – select the text and copy it by hand', true))}>Copy caption</button></div>
      </div>
      {(st.s === 'published' || d.metrics) && (
        <div className="card">
          <div className="row between"><b>Numbers from Instagram</b>{admin && st.s === 'published' && <button className="btn sm" onClick={() => { close(); metrics(r); }}>Update numbers</button>}</div>
          <div className="two small" style={{ marginTop: 6 }}>
            <div>Views: <b>{num(d.metrics?.views)}</b></div><div>Reach: <b>{num(d.metrics?.reach)}</b></div><div>Likes: <b>{num(d.metrics?.likes)}</b></div>
            <div>Comments: <b>{num(d.metrics?.comments)}</b></div><div>Shares: <b>{num(d.metrics?.shares)}</b></div><div>Saves: <b>{num(d.metrics?.saved)}</b></div>
          </div>
          <div className="small mute">{d.metrics?.as_of ? 'Updated ' + fDateY(d.metrics.as_of) : 'Not available yet'}. The app refreshes these every six hours for Reels it published.</div>
        </div>
      )}
      {admin && hist.length > 0 && (
        <div><h3>Record of changes</h3><div className="list small">{hist.map(h => <div key={h.id} style={{ alignItems: 'flex-start' }}><div className="grow"><b>{h.action}</b>{h.note ? ' · ' + h.note : ''}<div className="mute">{h.by_name} · {fDT(h.at)}</div></div></div>)}</div></div>
      )}
      <div className="foot">
        {admin && st.s !== 'deleted' ? (
          <button className="btn danger" onClick={() => reasonForm('Delete this Reel',
            <p>{st.s === 'published' ? <>This marks the Reel as deleted here. <b>This page cannot remove a post from Instagram</b>, so delete it on Instagram yourself as well.</> : 'The Reel is marked deleted and can no longer be approved or published.'}</p>,
            'Delete', 'Reason (kept in the record)', false,
            async v => { await change(r, 'deleted', v, undefined, { state: 'deleted', rev: r.rev, prev: d.state || '' }); toast(st.s === 'published' ? 'Marked deleted. Remember to delete it on Instagram.' : 'Deleted', st.s === 'published'); }, true)}>Delete</button>
        ) : !admin && ed && st.s === 'draft' ? (
          <button className="btn danger" onClick={() => confirm('Discard this draft', 'The draft is hidden and cannot be approved or published.', 'Discard', async () => { await change(r, 'discarded', '', { discarded: true }); toast('Discarded'); done(); })}>Discard draft</button>
        ) : null}
        {ed && ['awaiting_approval', 'scheduled'].includes(st.s) && <button className="btn" onClick={() => doit(() => change(r, 'moved back to draft', '', { rev: r.rev + 1, submitted: false }), 'Back in Draft')}>Move back to Draft</button>}
        {ed && <button className="btn" onClick={() => { close(); edit(r); }}>Edit</button>}
        {admin && st.s === 'awaiting_approval' && <button className="btn" onClick={() => reasonForm('Reject this Reel', <p>Tell the teacher what to change. It goes back to Draft with your note.</p>, 'Send back', 'What needs to change', true,
          async v => { await change(r, 'rejected', v, undefined, { state: 'rejected', rev: r.rev, note: v }); toast('Sent back to the teacher'); })}>Reject</button>}
        {admin && ['awaiting_approval', 'draft'].includes(st.s) && r.appears && <button className="btn primary" onClick={() => { close(); approve(r); }}>Approve…</button>}
        {admin && st.s === 'scheduled' && <button className="btn" onClick={() => reasonForm('Mark as failed', <p>Use this if the post could not be made on Instagram.</p>, 'Mark as failed', 'What went wrong', false,
          async v => { await change(r, 'failed', v, undefined, { state: 'failed', rev: r.rev, error: v || 'Publishing failed.' }); })}>Mark as failed</button>}
        {admin && st.s === 'scheduled' && <button className="btn primary" onClick={() => { close(); openModal('Mark as published', c2 => <PublishedForm r={r} close={c2} change={change} issue={x.issueOf(r)} />); }}>Mark as published…</button>}
        {admin && st.s === 'failed' && <button className="btn primary" onClick={() => doit(() => change(r, 'retry', '', undefined, { state: 'approved', rev: r.rev, error: '', scheduled_at: new Date().toISOString() }), 'Back in Scheduled')}>Try again</button>}
        {ed && st.s === 'draft' && <button className="btn primary" onClick={() => doit(async () => { const iss = x.issueOf(r); if (iss) throw new Error(iss); await change(r, 'submitted for approval', '', { submitted: true, submitted_at: new Date().toISOString() }); }, 'Submitted for approval')}>Submit for approval</button>}
      </div>
    </div>
  );
}

function PublishedForm({ r, close, change, issue }: { r: Reel; close: () => void; change: ReturnType<typeof useReels>['change']; issue: string }) {
  const { toast } = useUI();
  return (
    <Form close={close} label="Mark as published" onSubmit={async f => {
      let u: URL | null; try { u = new URL(f.trim('u')); } catch { u = null; }
      if (!u || u.protocol !== 'https:' || !/(^|\.)instagram\.com$/.test(u.hostname)) throw new Error('Paste the Instagram link (https://www.instagram.com/…).');
      const at = zonedToUtc(f.get('dt'), tz()); if (!at) throw new Error('Choose the date and time.');
      if (issue) throw new Error(issue);
      await change(r, 'published', u.href, undefined, { state: 'published', rev: r.rev, ig_url: u.href, published_at: at, appears: r.appears });
      close(); toast('Marked as published');
    }}>
      <p>After posting the Reel on Instagram, paste its link.</p>
      <Field label="Instagram link" hint="(https)"><input name="u" type="url" inputMode="url" placeholder="https://www.instagram.com/reel/…" /></Field>
      <Field label="Published on"><input name="dt" type="datetime-local" defaultValue={localInput(new Date().toISOString())} /></Field>
    </Form>
  );
}

function ReelForm({ r, close, change }: { r?: Reel; close: () => void; change: ReturnType<typeof useReels>['change'] }) {
  const app = useApp(), { toast } = useUI(), x = useReels();
  const [sub, setSub] = useState<string>(r?.subject_id || ''), [batch, setBatch] = useState<string>(r?.batch_id || '');
  const [appears, setAppears] = useState<string>(r?.appears || ''), [picked, setPicked] = useState<Set<string>>(new Set(r?.appearing || []));
  const topics = [...new Set(app.reels.map(v => v.topic).filter(Boolean))];
  const list = app.students.filter(s => s.active && s.batch_id === batch && (!sub || s.subjects.includes(sub as 'chem')));
  return (
    <Form close={close} label={r ? 'Save changes' : 'Save as Draft'} onSubmit={async f => {
      const d = {
        title: f.trim('title'), subject_id: f.get('sub') as Reel['subject_id'], batch_id: f.get('batch'), topic: f.trim('topic'), teacher_name: f.trim('teacher'),
        clip_url: f.trim('clip'), clip_len: f.trim('len') ? +f.trim('len') : null, yt_url: f.trim('yt'), yt_start: f.trim('ys') ? parseT(f.trim('ys')) : 0, caption: f.trim('cap'),
        appears: (appears || null) as Reel['appears'], appearing: appears === 'students' ? [...picked] : [] as string[],
      };
      if (!d.title) throw new Error('Enter a title.'); if (!d.subject_id) throw new Error('Choose a subject.'); if (!d.batch_id) throw new Error('Choose a batch.');
      if (!/^https:\/\/[^\s<>"']+$/i.test(d.clip_url) || d.clip_url.length > 500) throw new Error('Paste the link to the clip (it must start with https://).');
      if (d.clip_len != null && !(d.clip_len >= 5 && d.clip_len <= 90)) throw new Error('A Reel is 5–90 seconds long.');
      if (d.yt_url && !ytInfo(d.yt_url)) throw new Error('That is not a YouTube link.');
      if (isNaN(d.yt_start)) throw new Error('Enter the start time like 12:30.');
      if (!d.caption) d.caption = buildCaption(d, { handle: app.settings.ig_handle, academy: app.settings.academy, subjectName: subj(d.subject_id) });
      if ((d.caption.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) throw new Error('Instagram allows at most 30 hashtags.');
      if (r) {
        const keys = (Object.keys(d) as (keyof typeof d)[]).filter(k => JSON.stringify(r[k as keyof Reel] ?? null) !== JSON.stringify(d[k] ?? null));
        if (!keys.length) { close(); return toast('No changes to save'); }
        const was = x.stateOf(r).s;
        await change(r, 'edited', keys.join(', '), { ...d, rev: r.rev + 1, submitted: false });
        close(); toast(was === 'draft' ? 'Saved' : 'Saved. It is back in Draft and needs approval again.');
      } else {
        const ins = await db.from('reels').insert({ ...d, rev: 1, submitted: false, by_id: app.me.id, by_name: app.by }).select('*').single();
        if (ins.error) throw new Error(ins.error.message);
        await db.from('reel_history').insert({ reel_id: (ins.data as Reel).id, scope: 'draft', action: 'created', by_name: app.by, note: '' });
        await app.reload('reels'); close(); toast('Saved as Draft');
      }
    }}>
      <div className="alert info" style={{ display: 'block' }}>For a clip you made yourself (for example in CapCut): put it on Google Drive or YouTube (unlisted) and paste the link here. To have the app cut the 60-second clip, publish it and keep the YouTube copy, use <b>Recordings</b> instead.</div>
      <Field label="Title"><input name="title" maxLength={100} defaultValue={r?.title || ''} placeholder="e.g. The alkene formula" /></Field>
      <div className="two">
        <Field label="Subject"><select name="sub" value={sub} onChange={e => setSub(e.target.value)}><Options items={SUBJECTS} placeholder="Choose" /></select></Field>
        <Field label="Batch"><select name="batch" value={batch} onChange={e => setBatch(e.target.value)}><Options items={app.batches} placeholder="Choose" /></select></Field>
      </div>
      <div className="two">
        <Field label="Topic"><input name="topic" list="rtp" maxLength={100} defaultValue={r?.topic || ''} placeholder="e.g. Alkenes" /><datalist id="rtp">{topics.map(t => <option key={t} value={t} />)}</datalist></Field>
        <Field label="Teacher"><input name="teacher" maxLength={80} defaultValue={r?.teacher_name || app.by} /></Field>
      </div>
      <Field label="Link to the finished clip" hint="(https)"><input name="clip" type="url" inputMode="url" placeholder="https://" defaultValue={r?.clip_url || ''} /></Field>
      <div className="two">
        <Field label="Clip length (seconds)"><input name="len" inputMode="numeric" defaultValue={r?.clip_len ?? ''} placeholder="5–90" /></Field>
        <Field label="Starts at (m:ss) in the full class"><input name="ys" defaultValue={r?.yt_start ? mmss(r.yt_start) : ''} placeholder="optional" /></Field>
      </div>
      <Field label="Full class on YouTube" hint="(optional, https)"><input name="yt" type="url" inputMode="url" placeholder="https://youtu.be/…" defaultValue={r?.yt_url || ''} /></Field>
      <Field label="Caption, call to action and hashtags">
        <textarea name="cap" rows={8} maxLength={2200} defaultValue={r?.caption || ''} />
        <div className="row wrap" style={{ marginTop: 6 }}>
          <button className="btn sm" type="button" onClick={e => {
            const form = (e.target as HTMLElement).closest('form') as HTMLFormElement; const get = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value;
            if (!get('sub')) return toast('Choose the subject first.', true);
            (form.elements.namedItem('cap') as HTMLTextAreaElement).value = buildCaption({ title: get('title').trim(), subject_id: get('sub'), topic: get('topic').trim(), yt_url: get('yt').trim(), yt_start: parseT(get('ys')) || 0 }, { handle: app.settings.ig_handle, academy: app.settings.academy, subjectName: subj(get('sub')) });
          }}>Write the caption for me</button>
        </div>
      </Field>
      <div className="field">
        <label>Students in this clip <span className="chip warn">Required</span></label>
        <label className="row" style={{ fontWeight: 500 }}><input type="radio" name="ap" checked={appears === 'none'} onChange={() => setAppears('none')} /> No student is visible, audible or named. Only the teacher and the lesson.</label>
        <label className="row" style={{ fontWeight: 500 }}><input type="radio" name="ap" checked={appears === 'students'} onChange={() => setAppears('students')} /> A student appears (face, voice or name)</label>
        {appears === 'students' && (
          <div className="checks">{list.map(s => (
            <label key={s.id}><input type="checkbox" checked={picked.has(s.id)} onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} />{s.name}{' '}
              <span className={'chip ' + CLABEL[x.consentOf(s.id)][1]}>{x.consentOf(s.id) === 'granted' ? 'Consent given' : 'No consent on record'}</span></label>
          ))}{!list.length && <span className="mute small">No students in this batch for this subject.</span>}</div>
        )}
      </div>
    </Form>
  );
}

export { fDateISO };
