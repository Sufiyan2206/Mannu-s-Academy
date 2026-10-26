-- Row level security and database functions for Mannu’s Tuition Academy.
-- Admins can do everything. Teachers can run classes, attendance, messages, resources and Reel drafts,
-- but never see fees, payments or parent-report records, and cannot approve/publish Reels or change consent.

-- ---------------------------------------------------------------- helpers
create function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = accounts.uid() and p.active)
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = accounts.uid() and p.active and p.role = 'admin')
$$;

revoke all on function public.is_staff(), public.is_admin() from public;
grant execute on function public.is_staff(), public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------- RLS
alter table public.profiles            enable row level security;
alter table public.settings            enable row level security;
alter table public.batches             enable row level security;
alter table public.students            enable row level security;
alter table public.classes             enable row level security;
alter table public.attendance_class    enable row level security;
alter table public.attendance          enable row level security;
alter table public.attendance_zoom     enable row level security;
alter table public.attendance_audit    enable row level security;
alter table public.fee_rates           enable row level security;
alter table public.fee_charges         enable row level security;
alter table public.receipt_counters    enable row level security;
alter table public.payments            enable row level security;
alter table public.parent_report_sends enable row level security;
alter table public.messages            enable row level security;
alter table public.resources           enable row level security;
alter table public.resource_history    enable row level security;
alter table public.reels               enable row level security;
alter table public.reel_decisions      enable row level security;
alter table public.reel_history        enable row level security;
alter table public.consent             enable row level security;
alter table public.consent_log         enable row level security;
alter table public.recordings          enable row level security;
alter table public.integrations        enable row level security;   -- no policy: service role only

-- people
create policy profiles_read   on public.profiles for select using (public.is_staff() or id = accounts.uid());
create policy profiles_admin  on public.profiles for update using (public.is_admin()) with check (public.is_admin());

create policy settings_read   on public.settings for select using (public.is_staff());
create policy settings_admin  on public.settings for update using (public.is_admin()) with check (public.is_admin());

create policy batches_read    on public.batches  for select using (public.is_staff());
create policy batches_admin   on public.batches  for all    using (public.is_admin()) with check (public.is_admin());

create policy students_read   on public.students for select using (public.is_staff());
create policy students_admin  on public.students for all    using (public.is_admin()) with check (public.is_admin());

-- classes and attendance: all staff
create policy classes_read    on public.classes for select using (public.is_staff());
create policy classes_write   on public.classes for insert with check (public.is_staff());
create policy classes_update  on public.classes for update using (public.is_staff()) with check (public.is_staff());
create policy classes_delete  on public.classes for delete using (public.is_admin());

create policy att_class_all    on public.attendance_class for all using (public.is_staff()) with check (public.is_staff());
create policy att_all          on public.attendance       for all using (public.is_staff()) with check (public.is_staff());
create policy att_zoom_all     on public.attendance_zoom  for all using (public.is_staff()) with check (public.is_staff());
create policy att_audit_read   on public.attendance_audit for select using (public.is_staff());
create policy att_audit_add    on public.attendance_audit for insert with check (public.is_staff());

-- money: admins only
create policy fee_rates_admin    on public.fee_rates           for all using (public.is_admin()) with check (public.is_admin());
create policy fee_charges_admin  on public.fee_charges         for all using (public.is_admin()) with check (public.is_admin());
create policy receipt_ctr_admin  on public.receipt_counters    for all using (public.is_admin()) with check (public.is_admin());
create policy payments_admin     on public.payments            for all using (public.is_admin()) with check (public.is_admin());
create policy parent_sends_admin on public.parent_report_sends for all using (public.is_admin()) with check (public.is_admin());

-- WhatsApp log: teachers never see fee reminders or receipts
create policy messages_read on public.messages for select
  using (public.is_admin() or (public.is_staff() and kind not in ('fee_reminder', 'receipt')));
create policy messages_add  on public.messages for insert with check (public.is_staff());

-- resources: everyone on staff adds; only the owner or an admin changes; removed items are hidden from teachers
create policy resources_read on public.resources for select
  using (public.is_admin() or (public.is_staff() and (status = 'active' or by_id = accounts.uid())));
create policy resources_add  on public.resources for insert with check (public.is_staff() and by_id = accounts.uid());
create policy resources_edit on public.resources for update
  using (public.is_admin() or (public.is_staff() and by_id = accounts.uid()))
  with check (public.is_admin() or (public.is_staff() and by_id = accounts.uid()));
create policy resources_del  on public.resources for delete using (public.is_admin());
create policy res_hist_read  on public.resource_history for select using (public.is_admin());
create policy res_hist_add   on public.resource_history for insert with check (public.is_staff());

-- reels: teachers write drafts; approvals, publishing and consent are admin-only
create policy reels_read     on public.reels for select using (public.is_staff());
create policy reels_add      on public.reels for insert with check (public.is_staff() and by_id = accounts.uid());
create policy reels_edit     on public.reels for update
  using (public.is_admin() or (public.is_staff() and by_id = accounts.uid()))
  with check (public.is_admin() or (public.is_staff() and by_id = accounts.uid()));
create policy reels_del      on public.reels for delete using (public.is_admin());
create policy reel_dec_read  on public.reel_decisions for select using (public.is_staff());
create policy reel_dec_admin on public.reel_decisions for all using (public.is_admin()) with check (public.is_admin());
create policy reel_hist_read on public.reel_history for select using (public.is_admin());
create policy reel_hist_add  on public.reel_history for insert with check (public.is_staff());
create policy consent_read   on public.consent for select using (public.is_staff());
create policy consent_admin  on public.consent for all using (public.is_admin()) with check (public.is_admin());
create policy consent_log_admin on public.consent_log for all using (public.is_admin()) with check (public.is_admin());

-- recordings: staff add and watch; changes after that happen in the pipeline (service role) or by an admin
create policy recordings_read  on public.recordings for select using (public.is_staff());
create policy recordings_add   on public.recordings for insert with check (public.is_staff() and by_id = accounts.uid());
create policy recordings_admin on public.recordings for update using (public.is_admin()) with check (public.is_admin());
create policy recordings_del   on public.recordings for delete using (public.is_admin());

-- ---------------------------------------------------------------- attendance: one transaction for rows + Zoom copy + audit
create function public.apply_attendance(
  p_class     uuid,
  p_rows      jsonb,                  -- [{student_id,status,join_time,leave_time,duration_sec,source,note,created_by,created_at,updated_by,updated_at}]
  p_zoom      jsonb default null,     -- [{student_id,status,join_time,leave_time,duration_sec}]  (replaces the stored Zoom copy)
  p_unmatched jsonb default null,
  p_audits    jsonb default '[]'      -- [{student_id,old_value,new_value,reason,by_name}]
) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;

  insert into public.attendance_class (class_id, unmatched)
  values (p_class, coalesce(p_unmatched, '[]'::jsonb))
  on conflict (class_id) do update
    set unmatched = case when p_unmatched is null then public.attendance_class.unmatched else excluded.unmatched end;

  insert into public.attendance (class_id, student_id, status, join_time, leave_time, duration_sec, source, note,
                                 created_by, created_at, updated_by, updated_at)
  select p_class, r.student_id, r.status, r.join_time, r.leave_time, r.duration_sec, r.source, coalesce(r.note, ''),
         coalesce(r.created_by, ''), coalesce(r.created_at, now()), coalesce(r.updated_by, ''), coalesce(r.updated_at, now())
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    student_id uuid, status text, join_time timestamptz, leave_time timestamptz, duration_sec int, source text,
    note text, created_by text, created_at timestamptz, updated_by text, updated_at timestamptz)
  on conflict (class_id, student_id) do update set
    status = excluded.status, join_time = excluded.join_time, leave_time = excluded.leave_time,
    duration_sec = excluded.duration_sec, source = excluded.source, note = excluded.note,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  if p_zoom is not null then
    delete from public.attendance_zoom where class_id = p_class;
    insert into public.attendance_zoom (class_id, student_id, status, join_time, leave_time, duration_sec)
    select p_class, z.student_id, z.status, z.join_time, z.leave_time, z.duration_sec
    from jsonb_to_recordset(p_zoom) as z(student_id uuid, status text, join_time timestamptz, leave_time timestamptz, duration_sec int);
  end if;

  insert into public.attendance_audit (class_id, student_id, old_value, new_value, reason, by_name)
  select p_class, a.student_id, a.old_value, a.new_value, coalesce(a.reason, ''), coalesce(a.by_name, '')
  from jsonb_to_recordset(coalesce(p_audits, '[]'::jsonb)) as a(student_id uuid, old_value jsonb, new_value jsonb, reason text, by_name text);
end $$;
grant execute on function public.apply_attendance(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- payments: numbered receipts without gaps or duplicates
create function public.record_payment(
  p_student       uuid,
  p_cents         bigint,        -- credited, in the student’s billing currency
  p_paid_cents    bigint,
  p_paid_currency text,
  p_rate          numeric,
  p_method        text,
  p_reference     text,
  p_note          text,
  p_paid_at       timestamptz,
  p_year          int,
  p_received_by   text
) returns public.payments
language plpgsql security invoker set search_path = public as $$
declare
  s public.students;
  n int;
  p public.payments;
begin
  if not public.is_admin() then raise exception 'only admins can record payments' using errcode = '42501'; end if;
  select * into s from public.students where id = p_student;
  if not found then raise exception 'student not found'; end if;
  if p_year < 2000 or p_year > 2100 then raise exception 'invalid year'; end if;

  insert into public.receipt_counters as rc (year, n) values (p_year, 1)
  on conflict (year) do update set n = rc.n + 1
  returning rc.n into n;

  insert into public.payments (receipt_no, student_id, currency, cents, paid_currency, paid_cents, rate, method,
                               reference, note, paid_at, received_by)
  values ('MTA-' || p_year || '-' || lpad(n::text, 5, '0'), p_student, s.currency, p_cents, p_paid_currency, p_paid_cents,
          p_rate, p_method, coalesce(p_reference, ''), coalesce(p_note, ''), p_paid_at, coalesce(p_received_by, ''))
  returning * into p;
  return p;
end $$;
grant execute on function public.record_payment(uuid, bigint, bigint, text, numeric, text, text, text, timestamptz, int, text) to authenticated;

-- ---------------------------------------------------------------- pipeline: take the next recording that needs work
-- SKIP LOCKED + a lease means two scheduler ticks never process the same recording at once.
create function public.claim_recording(p_lease_seconds int default 420) returns public.recordings
language plpgsql security definer set search_path = public as $$
declare r public.recordings;
begin
  select * into r from public.recordings
   where stage in ('queued', 'youtube', 'trim', 'instagram')
     and next_attempt_at <= now()
     and (locked_until is null or locked_until < now())
   order by created_at
   limit 1
   for update skip locked;
  if not found then return null; end if;
  update public.recordings
     set locked_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where id = r.id
   returning * into r;
  return r;
end $$;
revoke all on function public.claim_recording(int) from public, anon, authenticated;
grant execute on function public.claim_recording(int) to service_role;
