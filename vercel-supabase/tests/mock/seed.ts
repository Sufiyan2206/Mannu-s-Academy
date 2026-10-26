// Demo data for the in-memory stand-in for the database (browser testing only). Dates are relative to "now".
type Row = Record<string, unknown>;
const H = 3600e3, D = 24 * H;
const iso = (ms: number) => new Date(ms).toISOString();
const day = (off: number) => iso(Date.now() + off * D).slice(0, 10);
const at = (offDays: number, hour: number, min = 0) => {   // Dubai time (UTC+4) on a given day offset
  const d = new Date(Date.now() + offDays * D); d.setUTCHours(hour - 4, min, 0, 0); return d.toISOString();
};
export const ids = {
  admin: '00000000-0000-4000-8000-0000000000a1', teacher: '00000000-0000-4000-8000-0000000000b1',
  b1: '10000000-0000-4000-8000-000000000001', b2: '10000000-0000-4000-8000-000000000002',
  s1: '20000000-0000-4000-8000-000000000001', s2: '20000000-0000-4000-8000-000000000002', s3: '20000000-0000-4000-8000-000000000003', s4: '20000000-0000-4000-8000-000000000004',
};
const cid = (n: number) => `30000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

export function seed(): Record<string, Row[]> {
  const stu = (id: string, name: string, over: Row = {}): Row => ({
    id, name, email: name.split(' ')[0].toLowerCase() + '@example.com', zoom_email: '', mobile: '+971500000' + id.slice(-3), guardian_name: 'Parent of ' + name.split(' ')[0],
    guardian_mobile: '+971555000' + id.slice(-3), guardian_email: '', school: '', batch_id: ids.b1, currency: 'AED', subjects: ['chem', 'phys'], active: true, created_at: iso(Date.now() - 90 * D), ...over,
  });
  const cls = (n: number, offDays: number, hour: number, subject: string, over: Row = {}): Row => ({
    id: cid(n), batch_id: ids.b1, subject_id: subject, title: (subject === 'chem' ? 'Chemistry' : 'Physics') + ' – Grade 11', start_at: at(offDays, hour), duration_min: 60,
    teacher_name: 'Mr Silva', teacher_phone: '+971501112233', join_url: `https://zoom.us/j/9${n}00000000`, agenda: '', status: 'scheduled', cancel_reason: '', created_by: 'Ada Admin', created_at: iso(Date.now() - 20 * D), ...over,
  });
  const att = (c: string, sid: string, status: string, over: Row = {}): Row => ({
    class_id: c, student_id: sid, status, join_time: null, leave_time: null, duration_sec: null, source: 'manual', note: '', created_by: 'Tess Teacher', created_at: iso(Date.now() - 2 * D), updated_by: 'Tess Teacher', updated_at: iso(Date.now() - 2 * D), ...over,
  });
  const month = (off: number) => { const d = new Date(Date.now() + off * 31 * D); return d.toISOString().slice(0, 7); };
  const charge = (n: number, sid: string, sub: string, period: string, cents: number, due: string): Row => ({
    id: `40000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, student_id: sid, subject_id: sub, period, description: `${sub === 'chem' ? 'Chemistry' : 'Physics'} fee`, currency: 'AED', cents, due_date: due, voided: false, created_at: iso(Date.now() - 40 * D),
  });
  return {
    profiles: [
      { id: ids.admin, full_name: 'Ada Admin', email: 'ada@example.com', role: 'admin', active: true, created_at: iso(Date.now() - 200 * D) },
      { id: ids.teacher, full_name: 'Tess Teacher', email: 'tess@example.com', role: 'teacher', active: true, created_at: iso(Date.now() - 100 * D) },
    ],
    settings: [{ id: 1, academy: 'Mannu’s Tuition Academy', tz: 'Asia/Dubai', currency: 'AED', currencies: ['AED', 'USD'], min_pct: 50, late_after: 10, classes_per_month: 12, monthly_fee: 250, due_day: 10, cc: '971', contact: 'Call 04 123 4567', ig_handle: 'mannus_academy', publish_mode: 'auto', yt_privacy: 'unlisted', reel_len_sec: 60, reel_start_sec: 0, keep_original_days: 7 }],
    batches: [{ id: ids.b1, name: 'Grade 11 – Evening', created_at: iso(Date.now() - 100 * D) }, { id: ids.b2, name: 'Grade 10 – Morning', created_at: iso(Date.now() - 100 * D) }],
    students: [
      stu(ids.s1, 'Sam Perera', { school: 'Royal College' }), stu(ids.s2, 'Ann Silva', { school: 'royal  college' }),
      stu(ids.s3, 'Raj Kumar', { subjects: ['chem'], currency: 'USD', school: 'Delhi Public School' }), stu(ids.s4, 'Mia Fernando', { batch_id: ids.b2, subjects: ['math'] }),
    ],
    classes: [
      cls(1, -9, 17, 'chem'), cls(2, -7, 17, 'phys'), cls(3, -2, 17, 'chem'), cls(4, -1, 17, 'phys'), cls(5, -3, 17, 'chem', { status: 'cancelled', cancel_reason: 'Teacher unwell' }),
      cls(6, 0, 17, 'chem', { start_at: iso(Date.now() + 3 * H) }), cls(7, 0, 9, 'phys', { start_at: iso(Date.now() - 2 * H) }), cls(8, 2, 17, 'chem'), cls(9, 5, 17, 'phys'),
      cls(10, -0.1, 8, 'chem', { start_at: iso(Date.now() - 5 * H), title: 'Chemistry – earlier today (no attendance yet)' }),
    ],
    attendance_class: [1, 2, 3, 4].map(n => ({ class_id: cid(n), taken_at: iso(Date.now() - 2 * D), unmatched: n === 3 ? [{ name: 'Guest', email: '', duration_sec: 600, reason: 'No Zoom login email' }] : [] })),
    attendance: [
      att(cid(1), ids.s1, 'present'), att(cid(1), ids.s2, 'late', { join_time: at(-9, 17, 20), note: 'bus delay' }), att(cid(1), ids.s3, 'absent'),
      att(cid(2), ids.s1, 'present'), att(cid(2), ids.s2, 'present'),
      att(cid(3), ids.s1, 'absent'), att(cid(3), ids.s2, 'present', { source: 'zoom', created_by: 'Zoom import', updated_by: 'Zoom import', duration_sec: 3300 }), att(cid(3), ids.s3, 'present'),
      att(cid(4), ids.s1, 'present'), att(cid(4), ids.s2, 'present'),
    ],
    attendance_zoom: [{ class_id: cid(3), student_id: ids.s1, status: 'present', join_time: null, leave_time: null, duration_sec: 3200, synced_at: iso(Date.now() - 2 * D) }],
    attendance_audit: [{ id: 1, class_id: cid(3), student_id: ids.s1, old_value: { status: 'present' }, new_value: { status: 'absent', source: 'manual', note: '' }, reason: 'left after 5 minutes', by_name: 'Tess Teacher', at: iso(Date.now() - 2 * D) }],
    fee_rates: [
      { id: '50000000-0000-4000-8000-000000000001', subject_id: 'chem', batch_id: null, student_id: null, currency: 'AED', cents: 25000 },
      { id: '50000000-0000-4000-8000-000000000002', subject_id: 'phys', batch_id: null, student_id: null, currency: 'AED', cents: 20000 },
      { id: '50000000-0000-4000-8000-000000000003', subject_id: 'chem', batch_id: null, student_id: null, currency: 'USD', cents: 7000 },
    ],
    fee_charges: [
      charge(1, ids.s1, 'chem', month(-2), 25000, day(-50)), charge(2, ids.s1, 'phys', month(-2), 20000, day(-50)), charge(3, ids.s1, 'chem', month(-1), 25000, day(-20)),
      charge(4, ids.s1, 'phys', month(-1), 20000, day(-20)), charge(5, ids.s2, 'chem', month(-1), 25000, day(-20)), charge(6, ids.s3, 'chem', month(-1), 7000, day(-20)), charge(7, ids.s1, 'chem', month(0), 25000, day(4)),
    ],
    payments: [
      { id: '60000000-0000-4000-8000-000000000001', receipt_no: 'MTA-2026-00001', student_id: ids.s1, currency: 'AED', cents: 45000, paid_currency: 'AED', paid_cents: 45000, rate: 1, method: 'cash', reference: '', note: '', paid_at: iso(Date.now() - 45 * D), received_by: 'Ada Admin', voided: false, void_reason: '', created_at: iso(Date.now() - 45 * D) },
      { id: '60000000-0000-4000-8000-000000000002', receipt_no: 'MTA-2026-00002', student_id: ids.s2, currency: 'AED', cents: 25000, paid_currency: 'AED', paid_cents: 25000, rate: 1, method: 'bank_transfer', reference: 'TX-991', note: '', paid_at: iso(Date.now() - 10 * D), received_by: 'Ada Admin', voided: false, void_reason: '', created_at: iso(Date.now() - 10 * D) },
    ],
    receipt_counters: [{ year: 2026, n: 2 }], parent_report_sends: [],
    messages: [{ id: '70000000-0000-4000-8000-000000000001', ts: iso(Date.now() - 3 * D), by_name: 'Ada Admin', kind: 'class_info', student_id: ids.s1, class_id: cid(8), recipient_role: 'guardian', recipient_name: 'Parent of Sam', to_number: '+971555000001', body: 'Class details…', status: 'sent' }],
    resources: [{ id: '80000000-0000-4000-8000-000000000001', title: 'Alkenes – model paper 1', subject_id: 'chem', type: 'model_paper', exam_type: 'mock_exam', batch_ids: [ids.b1], url: 'https://drive.google.com/file/d/abc', topic: 'Alkenes', date: day(-5), description: 'Past paper style', instructions: 'Attempt in 90 minutes', tags: ['organic'], class_id: cid(3), status: 'active', by_id: ids.teacher, by_name: 'Tess Teacher', created_at: iso(Date.now() - 5 * D), updated_at: iso(Date.now() - 5 * D), updated_by: '' }],
    resource_history: [{ id: 1, resource_id: '80000000-0000-4000-8000-000000000001', action: 'created', by_name: 'Tess Teacher', at: iso(Date.now() - 5 * D), changes: null, note: 'Added a link' }],
    reels: [
      { id: '90000000-0000-4000-8000-000000000001', title: 'The alkene formula', subject_id: 'chem', batch_id: ids.b1, topic: 'Alkenes', teacher_name: 'Mr Silva', clip_url: 'https://drive.google.com/file/d/clip1', clip_path: null, clip_len: 45, yt_url: 'https://youtu.be/abcdefghijk', yt_start: 750, caption: '📘 Chemistry in under a minute: Alkenes\n#Chemistry', appears: 'none', appearing: [], rev: 1, submitted: true, submitted_at: iso(Date.now() - 2 * D), discarded: false, recording_id: null, by_id: ids.teacher, by_name: 'Tess Teacher', created_at: iso(Date.now() - 3 * D), updated_at: iso(Date.now() - 2 * D) },
      { id: '90000000-0000-4000-8000-000000000002', title: 'Newton’s second law', subject_id: 'phys', batch_id: ids.b1, topic: 'Forces', teacher_name: 'Mr Silva', clip_url: 'https://drive.google.com/file/d/clip2', clip_path: null, clip_len: 30, yt_url: '', yt_start: 0, caption: 'Forces tips #Physics', appears: 'students', appearing: [ids.s1], rev: 1, submitted: true, submitted_at: iso(Date.now() - 20 * D), discarded: false, recording_id: null, by_id: ids.teacher, by_name: 'Tess Teacher', created_at: iso(Date.now() - 25 * D), updated_at: iso(Date.now() - 20 * D) },
    ],
    reel_decisions: [{ reel_id: '90000000-0000-4000-8000-000000000002', state: 'published', rev: 1, scheduled_at: null, note: '', error: '', prev: '', ig_url: 'https://www.instagram.com/reel/XYZ/', ig_media_id: '1789', published_at: iso(Date.now() - 18 * D), appears: 'students', metrics: { views: 1200, reach: 900, likes: 80, comments: 5, shares: 12, saved: 20, as_of: iso(Date.now() - D) }, by_name: 'Ada Admin', at: iso(Date.now() - 18 * D) }],
    reel_history: [], consent: [{ student_id: ids.s1, status: 'granted', note: 'Written consent from parent', by_name: 'Ada Admin', at: iso(Date.now() - 60 * D) }],
    consent_log: [{ id: 1, student_id: ids.s1, name: 'Sam Perera', status: 'granted', note: 'Written consent from parent', by_name: 'Ada Admin', at: iso(Date.now() - 60 * D) }],
    recordings: [
      { id: 'a0000000-0000-4000-8000-000000000001', class_id: cid(3), title: 'Chemistry – Grade 11 – yesterday', subject_id: 'chem', batch_id: ids.b1, topic: 'Alkenes', teacher_name: 'Mr Silva', source_path: 'x/a.mp4', source_url: null, source_kind: 'upload', source_size: 1500000000, source_mime: 'video/mp4', appears: 'none', appearing: [], trim_start_sec: 0, trim_len_sec: 60, publish_mode: 'auto', yt_privacy: 'unlisted', stage: 'youtube', yt_session_uri: 'u', yt_offset: 600000000, yt_video_id: null, yt_url: '', clip_path: null, reel_id: null, ig_container_id: null, ig_media_id: null, ig_url: '', hold_released: false, attempts: 0, last_error: '', next_attempt_at: iso(Date.now()), locked_until: null, steps: [{ at: iso(Date.now() - H), step: 'Upload complete', note: '1431 MB' }, { at: iso(Date.now() - H / 2), step: 'YouTube upload started' }], original_deleted: false, by_id: ids.teacher, by_name: 'Tess Teacher', created_at: iso(Date.now() - H), updated_at: iso(Date.now() - H / 2) },
      { id: 'a0000000-0000-4000-8000-000000000002', class_id: cid(2), title: 'Physics – Grade 11 – last week', subject_id: 'phys', batch_id: ids.b1, topic: 'Forces', teacher_name: 'Mr Silva', source_path: null, source_url: 'https://zoom.us/rec/x', source_kind: 'zoom', source_size: 900000000, source_mime: 'video/mp4', appears: null, appearing: [], trim_start_sec: 0, trim_len_sec: 60, publish_mode: 'auto', yt_privacy: 'unlisted', stage: 'held', yt_session_uri: null, yt_offset: 900000000, yt_video_id: 'VID12345678', yt_url: 'https://youtu.be/VID12345678', clip_path: 'a2.mp4', reel_id: null, ig_container_id: null, ig_media_id: null, ig_url: '', hold_released: false, attempts: 0, last_error: 'Say whether any student appears or is heard in this clip.', next_attempt_at: iso(Date.now()), locked_until: null, steps: [{ at: iso(Date.now() - 5 * D), step: 'Zoom recording received' }], original_deleted: false, by_id: null, by_name: 'Zoom recording', created_at: iso(Date.now() - 5 * D), updated_at: iso(Date.now() - 5 * D) },
      { id: 'a0000000-0000-4000-8000-000000000003', class_id: cid(1), title: 'Chemistry – Grade 11 – old', subject_id: 'chem', batch_id: ids.b1, topic: '', teacher_name: 'Mr Silva', source_path: 'x/c.mp4', source_url: null, source_kind: 'upload', source_size: 400000000, source_mime: 'video/mp4', appears: 'none', appearing: [], trim_start_sec: 0, trim_len_sec: 60, publish_mode: 'auto', yt_privacy: 'unlisted', stage: 'failed', yt_session_uri: null, yt_offset: 0, yt_video_id: null, yt_url: '', clip_path: null, reel_id: null, ig_container_id: null, ig_media_id: null, ig_url: '', hold_released: false, attempts: 5, last_error: 'YouTube is not connected. An admin can connect it in Setup → Video pipeline.', next_attempt_at: iso(Date.now()), locked_until: null, steps: [], original_deleted: false, by_id: ids.admin, by_name: 'Ada Admin', created_at: iso(Date.now() - 9 * D), updated_at: iso(Date.now() - 9 * D) },
    ],
    integrations: [],
  };
}
