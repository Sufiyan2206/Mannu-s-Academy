'use client';
import { useApp } from '@/state/app';
import { fDT, KIND, SUBJECTS } from '@/lib/format';
import { msgText, recipients, type To } from '@/lib/whatsapp';
import { Alert, Empty, Field, Form, Options, useUI } from '@/components/ui';
import { useOutbox } from '@/components/whatsapp';

export default function Messages() {
  const app = useApp(), { openModal } = useUI(), outbox = useOutbox();
  const rows = app.messages.filter(x => app.isAdmin || !['fee_reminder', 'receipt'].includes(x.kind)).slice(0, 200);

  const announce = () => openModal('New announcement', close => (
    <Form close={close} label="Prepare messages" onSubmit={async f => {
      if (!f.trim('t')) throw new Error('Write the message.');
      if (!app.isAdmin && !f.get('b') && !f.get('s')) throw new Error('Choose a batch or subject.');
      const list = app.students.filter(s => s.active && (!f.get('b') || s.batch_id === f.get('b')) && (!f.get('s') || s.subjects.includes(f.get('s') as 'chem')));
      close();
      outbox('Announcement', list.flatMap(s => recipients(s, f.get('to') as To).map(r => ({
        kind: 'announcement' as const, student_id: s.id, class_id: null, role: r.role, name: r.name, number: r.number,
        text: msgText(app.settings.academy, 'announcement', { student: s.name, text: f.trim('t') }),
      }))));
    }}>
      <div className="two">
        <Field label="Batch"><select name="b"><Options items={app.batches} placeholder={app.isAdmin ? 'All batches' : 'Choose a batch'} /></select></Field>
        <Field label="Subject"><select name="s"><Options items={SUBJECTS} placeholder="All subjects" /></select></Field>
      </div>
      <Field label="Send to"><select name="to"><option value="both">Students and parents</option><option value="students">Students only</option><option value="parents">Parents only</option></select></Field>
      <Field label="Message"><textarea name="t" maxLength={600} placeholder="e.g. Tomorrow’s test will cover chapters 4 and 5." /></Field>
    </Form>
  ));

  return (
    <>
      <div className="head"><h1>WhatsApp messages</h1><button className="btn primary" onClick={announce}>New announcement</button></div>
      <Alert kind="info">Messages open in WhatsApp for staff to send. The log records who opened each one; WhatsApp does not report delivery back to this page.</Alert>
      {rows.length ? (
        <div className="card list">{rows.map(x => (
          <div key={x.id} style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <b>{KIND[x.kind] || x.kind}</b> · {x.recipient_name} <span className="mute">({x.recipient_role === 'guardian' ? 'parent' : 'student'}{x.recipient_role === 'guardian' && x.student_id ? ' of ' + app.sname(x.student_id) : ''})</span>
              <div className="mute small">{fDT(x.ts)} · {x.by_name}</div>
              <details className="small"><summary className="mute" style={{ cursor: 'pointer' }}>Show message</summary><div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{x.body}</div></details>
            </div>
            <span className="chip">Opened by staff</span>
          </div>
        ))}</div>
      ) : <Empty>No messages sent yet.</Empty>}
    </>
  );
}
