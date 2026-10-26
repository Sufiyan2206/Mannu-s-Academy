'use client';
// WhatsApp click-to-chat: each message opens in WhatsApp with the text filled in; staff press send there. Every tap is logged.
import { useCallback, useState } from 'react';
import { db } from '@/lib/client';
import { useApp } from '@/state/app';
import { classVars, msgText, recipients, waNum, type MsgKind, type OutItem, type To } from '@/lib/whatsapp';
import { subj } from '@/lib/format';
import type { ClassRow } from '@/lib/types';
import { Empty, Field, Form, useUI } from './ui';

export function OutboxView({ items }: { items: OutItem[] }) {
  const app = useApp(), { toast } = useUI();
  const cc = app.settings.cc;
  const ok = items.filter(i => waNum(i.number, cc)), bad = items.length - ok.length;
  const [opened, setOpened] = useState<Record<number, boolean>>({});

  const log = async (i: OutItem) => {
    const { error } = await db.from('messages').insert({
      by_name: app.by, kind: i.kind, student_id: i.student_id, class_id: i.class_id, recipient_role: i.role, recipient_name: i.name, to_number: i.number, body: i.text, status: 'sent',
    });
    if (error) toast('Could not save the message log', true); else app.reload('messages').catch(() => {});
  };
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Copy failed – select the text and copy it by hand', true));

  return (
    <>
      <p className="mute small">Each message opens in WhatsApp with the text filled in. Tap <b>Send</b>, then press send in WhatsApp. Tapped messages are recorded in the log as sent by staff.</p>
      {bad > 0 && <div className="alert">{bad} recipient{bad > 1 ? 's' : ''} skipped: no valid WhatsApp number.</div>}
      {ok.length ? (
        <div className="list">
          {ok.map((i, n) => (
            <div key={n}>
              <div className="grow">
                <b>{i.name}</b> <span className="mute small">({i.role === 'guardian' ? 'parent of ' + app.sname(i.student_id) : 'student'})</span>
                <div className="mute small">{i.number}</div>
              </div>
              {opened[n] && <span className="chip ok">Opened</span>}
              <button className="btn sm" onClick={() => copy(i.text)}>Copy</button>
              <a className={'btn sm' + (opened[n] ? '' : ' primary')} target="_blank" rel="noopener"
                href={`https://wa.me/${waNum(i.number, cc)}?text=${encodeURIComponent(i.text)}`}
                onClick={() => { setOpened(o => ({ ...o, [n]: true })); log(i); }}>{opened[n] ? 'Send again' : 'Send'}</a>
            </div>
          ))}
        </div>
      ) : <Empty>No one to message.</Empty>}
      <details className="small mt"><summary className="mute" style={{ cursor: 'pointer' }}>Preview message</summary><div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{ok[0]?.text || ''}</div></details>
    </>
  );
}

export function useOutbox() {
  const { openModal } = useUI();
  return useCallback((title: string, items: OutItem[]) => openModal(title, () => <OutboxView items={items} />), [openModal]);
}

/** Items for one class message to every enrolled student (and/or parents). */
export function classItems(app: ReturnType<typeof useApp>, c: ClassRow, kind: MsgKind, to: To): OutItem[] {
  return app.enrolled(c).flatMap(s => recipients(s, to).map(r => ({
    kind, student_id: s.id, class_id: c.id, role: r.role, name: r.name, number: r.number, text: msgText(app.settings.academy, kind, classVars(c, s)),
  })));
}

export function useClassMessage() {
  const app = useApp(), { openModal } = useUI(), outbox = useOutbox();
  return useCallback((c: ClassRow, kind: MsgKind) => {
    openModal('Message students on WhatsApp', close => (
      <Form close={close} label="Prepare messages" onSubmit={async f => { const k = f.get('kind') as MsgKind; close(); outbox('Class message', classItems(app, c, k, f.get('to') as To)); }}>
        <Field label="Message">
          <select name="kind" defaultValue={kind}>
            <option value="class_info">Class details (subject, time, teacher, Zoom link)</option><option value="class_reminder">Class reminder</option>
            <option value="class_change">Schedule change</option><option value="class_cancel">Cancellation</option>
          </select>
        </Field>
        <Field label="Send to"><select name="to"><option value="both">Students and parents</option><option value="students">Students only</option><option value="parents">Parents only</option></select></Field>
        <p className="mute small">Goes to every student enrolled in {app.bname(c.batch_id)} for {subj(c.subject_id)}.</p>
      </Form>
    ));
  }, [app, openModal, outbox]);
}

export const NotifyOptions = ({ change }: { change?: boolean }) => (
  <Field label={change ? 'Tell students about the change?' : 'Prepare WhatsApp class details?'}>
    <select name="notify" defaultValue="both">
      <option value="both">Yes – students and parents</option><option value="students">Yes – students only</option><option value="parents">Yes – parents only</option><option value="none">No, not now</option>
    </select>
  </Field>
);
