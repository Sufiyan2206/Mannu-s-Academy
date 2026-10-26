'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, fetchAll, db } from '@/lib/client';
import { useApp } from '@/state/app';
import { CURRENCIES, mmss, parseT, saveFile, todayStr, validCode } from '@/lib/format';
import { isValidTz } from '@/lib/tz';
import type { Profile } from '@/lib/types';
import { Alert, Chip, Empty, Field, Form, useConfirm, useRun, useUI } from '@/components/ui';

interface Status {
  youtube: { configured: boolean; connected: boolean; channel: string; since: string | null };
  instagram: { connected: boolean; username: string; since: string | null };
  zoom: { configured: boolean; webhook: boolean };
  scheduler: { cron_secret_set: boolean; metrics_checked_at: string | null };
  site_url: string;
}

export default function Setup() {
  const app = useApp();
  if (!app.isAdmin) return <Empty>Setup is for admins only.</Empty>;
  return (
    <>
      <div className="head"><h1>Setup</h1></div>
      <div className="stack">
        <AcademyForm />
        <Suspense fallback={null}><Pipeline /></Suspense>
        <Team />
        <Backup />
      </div>
    </>
  );
}

function AcademyForm() {
  const app = useApp(), { toast } = useUI(), c = app.settings;
  const all = [...new Set([...Object.keys(CURRENCIES), ...c.currencies])];
  return (
    <div className="card stack"><h3>Academy settings</h3>
      <Form close={() => {}} label="Save settings" onSubmit={async f => {
        const tzv = f.trim('tz');
        if (!isValidTz(tzv)) throw new Error('That time zone name is not valid. Use a name like Asia/Colombo or Europe/London.');
        const oc = f.trim('oc').toUpperCase();
        if (oc && !validCode(oc)) throw new Error(`“${oc}” is not a recognised currency code.`);
        const cur = [...new Set([f.get('cur'), ...f.all('cc'), ...(oc ? [oc] : [])])];
        const inUse = new Set(app.students.filter(x => x.active).map(x => x.currency)), dropped = [...inUse].filter(x => !cur.includes(x));
        if (dropped.length) throw new Error(`Students are still billed in ${dropped.join(', ')}. Change their fee currency first, or keep that currency enabled.`);
        const { error } = await db.from('settings').update({
          academy: f.trim('academy') || c.academy, tz: tzv, currency: f.get('cur'), currencies: cur, cc: f.trim('country'), min_pct: Math.max(1, Math.min(100, Number(f.get('pct')) || 50)),
          late_after: Math.max(0, Math.min(120, Number(f.get('late')) || 0)), classes_per_month: Math.max(1, Math.min(40, Math.round(Number(f.get('cpm'))) || 12)),
          monthly_fee: Math.max(0, Number(f.get('mfee')) || 0), due_day: Math.max(1, Math.min(28, Number(f.get('due')) || 10)), contact: f.trim('contact'),
        }).eq('id', 1);
        if (error) throw new Error(error.message);
        await app.reload('settings'); toast('Settings saved');
      }}>
        <div className="two">
          <Field label="Academy name"><input name="academy" defaultValue={c.academy} /></Field>
          <Field label="Time zone"><input name="tz" defaultValue={c.tz} placeholder="e.g. Asia/Colombo" /></Field>
        </div>
        <div className="two">
          <Field label="Main currency"><select name="cur" defaultValue={c.currency}>{all.map(x => <option key={x} value={x}>{x} – {CURRENCIES[x] || x}</option>)}</select></Field>
          <Field label="Default country code" hint="(digits, for numbers starting 0)"><input name="country" inputMode="numeric" defaultValue={c.cc} placeholder="e.g. 94" /></Field>
        </div>
        <Field label="Currencies you bill or accept payments in" hint="(each student is billed in one of these)"><div className="checks">{all.map(x => <label key={x}><input type="checkbox" name="cc" value={x} defaultChecked={c.currencies.includes(x)} />{x}</label>)}</div></Field>
        <Field label="Add another currency code" hint="(3 letters, optional)"><input name="oc" maxLength={3} placeholder="e.g. CAD" style={{ textTransform: 'uppercase' }} /></Field>
        <div className="two">
          <Field label="Present when on Zoom at least (% of class)"><input name="pct" type="number" min={1} max={100} defaultValue={c.min_pct} /></Field>
          <Field label="Fees due on day of month"><input name="due" type="number" min={1} max={28} defaultValue={c.due_day} /></Field>
        </div>
        <Field label="Classes per month" hint="(shown on parent reports)"><input name="cpm" type="number" min={1} max={40} defaultValue={c.classes_per_month} /></Field>
        <Field label="Standard monthly fee" hint="(shown on parent reports when no fee has been generated)"><input name="mfee" type="number" min={0} step="0.01" defaultValue={c.monthly_fee} /></Field>
        <Field label="Zoom joins after this many minutes count as Late" hint="(0 = never)"><input name="late" type="number" min={0} max={120} defaultValue={c.late_after} /></Field>
        <Field label="Contact line in fee reminders" hint="(optional)"><input name="contact" defaultValue={c.contact} placeholder="e.g. Call 011 234 5678" /></Field>
      </Form>
    </div>
  );
}

function Pipeline() {
  const app = useApp(), { toast } = useUI(), run = useRun(), confirm = useConfirm(), params = useSearchParams();
  const [st, setSt] = useState<Status | null>(null), [err, setErr] = useState('');
  const refresh = () => api<Status>('/api/integrations/status').then(setSt).catch(e => setErr((e as Error).message));
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (params.get('youtube') === 'connected') toast('YouTube connected'); else if (params.get('youtube') === 'error') toast(params.get('msg') || 'Could not connect YouTube', true);
  }, [params, toast]);
  const s = app.settings;
  const base = st?.site_url || '';

  return (
    <div className="card stack"><h3>Video pipeline: YouTube → 60-second clip → Instagram</h3>
      <p className="mute small" style={{ margin: 0 }}>Every class recording is saved to YouTube, a vertical clip is cut and a Reel is published on Instagram. Connect both accounts once, then add recordings under Reels → Recordings (or let Zoom send them).</p>
      {err && <Alert kind="bad">{err}</Alert>}
      <Form close={() => {}} label="Save pipeline settings" onSubmit={async f => {
        const start = f.trim('start') ? parseT(f.trim('start')) : 0, len = Number(f.get('len'));
        if (isNaN(start) || start < 0) throw new Error('Enter the clip start like 0:30.');
        if (!(len >= 5 && len <= 90)) throw new Error('A Reel is 5–90 seconds long.');
        const { error } = await db.from('settings').update({ publish_mode: f.get('mode'), yt_privacy: f.get('priv'), reel_len_sec: len, reel_start_sec: start, keep_original_days: Math.max(0, Math.round(Number(f.get('keep')) || 0)) }).eq('id', 1);
        if (error) throw new Error(error.message);
        await app.reload('settings'); toast('Saved');
      }}>
        <Field label="Publishing on Instagram">
          <select name="mode" defaultValue={s.publish_mode}>
            <option value="auto">Automatic – publish as soon as the clip is ready</option>
            <option value="approval">Needs approval – an admin approves each Reel first</option>
            <option value="off">Off – only save the Reel as a draft</option>
          </select>
        </Field>
        <p className="mute small" style={{ marginTop: -6 }}>In every mode, a clip with a student in it waits until consent is recorded for that student.</p>
        <div className="two">
          <Field label="YouTube visibility of the full class"><select name="priv" defaultValue={s.yt_privacy}><option value="unlisted">Unlisted (only people with the link)</option><option value="private">Private</option><option value="public">Public</option></select></Field>
          <Field label="Reel length (seconds)"><input name="len" type="number" min={5} max={90} defaultValue={s.reel_len_sec} /></Field>
        </div>
        <div className="two">
          <Field label="Clip starts at (m:ss)" hint="(default for new recordings)"><input name="start" defaultValue={mmss(s.reel_start_sec)} /></Field>
          <Field label="Keep the original upload for (days)" hint="(then it is deleted from storage; 0 = right after publishing)"><input name="keep" type="number" min={0} defaultValue={s.keep_original_days} /></Field>
        </div>
      </Form>

      <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
      <div className="row between wrap">
        <div><b>YouTube</b> {st?.youtube.connected ? <Chip kind="ok">Connected</Chip> : <Chip kind="warn">Not connected</Chip>}
          <div className="mute small">{st?.youtube.connected ? `Channel: ${st.youtube.channel || 'unknown'}` : st && !st.youtube.configured ? 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local first, then restart the app.' : 'Videos are uploaded to the channel you sign in with.'}</div></div>
        <div className="row">
          {st?.youtube.connected && <button className="btn sm" onClick={() => confirm('Disconnect YouTube', 'New recordings will stop at the YouTube step until you connect again.', 'Disconnect', async () => { await api('/api/integrations/youtube/connect', undefined, 'DELETE'); await refresh(); })}>Disconnect</button>}
          <button className="btn sm primary" disabled={!st?.youtube.configured} onClick={() => run(async () => { const r = await api<{ url: string }>('/api/integrations/youtube/connect', {}); location.href = r.url; })}>{st?.youtube.connected ? 'Reconnect' : 'Connect YouTube'}</button>
        </div>
      </div>
      <div className="small mute">Redirect URI to add in Google Cloud: <span className="copy">{base}/api/integrations/youtube/callback</span></div>

      <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
      <div><b>Instagram</b> {st?.instagram.connected ? <Chip kind="ok">Connected{st.instagram.username ? ` as @${st.instagram.username}` : ''}</Chip> : <Chip kind="warn">Not connected</Chip>}</div>
      <Form close={() => {}} label={st?.instagram.connected ? 'Replace connection' : 'Connect Instagram'} onSubmit={async f => {
        const r = await api<{ username: string }>('/api/integrations/instagram', { access_token: f.trim('tok'), ig_user_id: f.trim('uid') });
        toast(`Connected to @${r.username}`); f.form.reset(); await refresh();
      }}>
        <Field label="Instagram account ID" hint="(the numeric id of the professional account)"><input name="uid" inputMode="numeric" autoComplete="off" /></Field>
        <Field label="Access token" hint="(long-lived, with instagram_content_publish)"><input name="tok" type="password" autoComplete="off" /></Field>
        <p className="mute small" style={{ marginTop: -6 }}>The token is checked with Instagram, then stored where only the server can read it. See the README for how to get both.</p>
      </Form>
      {st?.instagram.connected && <div><button className="btn sm danger" onClick={() => confirm('Disconnect Instagram', 'Reels will stop at the Instagram step until you connect again.', 'Disconnect', async () => { await api('/api/integrations/instagram', undefined, 'DELETE'); await refresh(); })}>Disconnect Instagram</button></div>}

      <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
      <div><b>Zoom cloud recordings</b> {st?.zoom.configured && st.zoom.webhook ? <Chip kind="ok">Ready</Chip> : <Chip kind="plain">Optional</Chip>}</div>
      <p className="mute small" style={{ margin: 0 }}>To start the pipeline automatically when a Zoom class finishes: create a Server-to-Server OAuth app in Zoom, add the event <b>recording.completed</b> with this endpoint, and set the ZOOM_* variables in .env.local.</p>
      <div className="copy">{base}/api/webhooks/zoom</div>

      <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
      <div><b>Background worker</b> <Chip kind="ok">Built in</Chip></div>
      <p className="mute small" style={{ margin: 0 }}>The app checks for video work by itself every minute, while it is running. {st?.scheduler.cron_secret_set ? 'An outside scheduler may also call /api/pipeline/tick with the CRON_SECRET. ' : ''}{st?.scheduler.metrics_checked_at ? `Instagram numbers last refreshed ${new Date(st.scheduler.metrics_checked_at).toLocaleString()}.` : ''}</p>
    </div>
  );
}

function Team() {
  const app = useApp(), { openModal, toast } = useUI(), run = useRun();
  const call = (body: object) => api('/api/admin/users', body, 'PATCH');
  const add = () => openModal('Add a teacher or admin', close => (
    <Form close={close} label="Create account" onSubmit={async f => {
      await api('/api/admin/users', { email: f.trim('email'), full_name: f.trim('name'), role: f.get('role'), password: f.get('pw') });
      await app.reload('profiles'); close(); toast('Account created. Share the password with them privately.');
    }}>
      <Field label="Name"><input name="name" autoComplete="off" /></Field>
      <Field label="Email"><input name="email" type="email" inputMode="email" autoComplete="off" /></Field>
      <Field label="Role"><select name="role"><option value="teacher">Teacher – classes, attendance, WhatsApp, resources, Reel drafts</option><option value="admin">Admin – everything, including fees and publishing</option></select></Field>
      <Field label="Temporary password" hint="(at least 8 characters)"><input name="pw" type="text" autoComplete="off" /></Field>
    </Form>
  ));
  const password = (p: Profile) => openModal('New password for ' + p.full_name, close => (
    <Form close={close} label="Save password" onSubmit={async f => { await call({ id: p.id, password: f.get('pw') }); close(); toast('Password changed'); }}>
      <Field label="New password" hint="(at least 8 characters)"><input name="pw" type="text" autoComplete="off" /></Field>
    </Form>
  ));
  return (
    <div className="card stack"><h3>Who can use the app</h3>
      <p className="mute small" style={{ margin: 0 }}><b>Admins</b> can do everything, including fees and publishing. <b>Teachers</b> run classes, attendance, WhatsApp messages, resources and Reel drafts, and cannot see fees. Students do not sign in: they receive class details and reminders on WhatsApp.</p>
      <div className="list">{app.profiles.map(p => (
        <div key={p.id} style={{ alignItems: 'flex-start' }}>
          <div className="grow"><b>{p.full_name || p.email}</b> {p.id === app.me.id && <span className="mute small">(you)</span>}<div className="mute small">{p.email}</div></div>
          <Chip kind={p.role === 'admin' ? 'sched' : 'plain'}>{p.role === 'admin' ? 'Admin' : 'Teacher'}</Chip>
          {!p.active && <Chip kind="bad">Off</Chip>}
          {p.id !== app.me.id && (
            <div className="row wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>
              <button className="btn sm" onClick={() => run(async () => { await call({ id: p.id, role: p.role === 'admin' ? 'teacher' : 'admin' }); await app.reload('profiles'); })}>Make {p.role === 'admin' ? 'teacher' : 'admin'}</button>
              <button className="btn sm" onClick={() => password(p)}>Password</button>
              <button className="btn sm" onClick={() => run(async () => { await call({ id: p.id, active: !p.active }); await app.reload('profiles'); })}>{p.active ? 'Switch off' : 'Switch on'}</button>
            </div>
          )}
        </div>
      ))}</div>
      <button className="btn" onClick={add}>Add a teacher or admin</button>
    </div>
  );
}

function Backup() {
  const run = useRun();
  const tables = ['settings', 'batches', 'students', 'classes', 'attendance_class', 'attendance', 'attendance_zoom', 'attendance_audit', 'fee_rates', 'fee_charges', 'payments', 'receipt_counters', 'parent_report_sends', 'messages', 'resources', 'resource_history', 'reels', 'reel_decisions', 'reel_history', 'consent', 'consent_log', 'recordings'];
  return (
    <div className="card stack"><h3>Backup</h3>
      <p className="mute small" style={{ margin: 0 }}>Download all records as a JSON file. Also keep regular database backups (pg_dump).</p>
      <button className="btn" onClick={() => run(async () => {
        const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
        for (const t of tables) out[t] = await fetchAll<unknown>((a, b) => db.from(t).select('*').range(a, b));
        saveFile('mannus-backup-' + todayStr() + '.json', JSON.stringify(out, null, 1), 'application/json');
      })}>Download backup</button>
    </div>
  );
}
