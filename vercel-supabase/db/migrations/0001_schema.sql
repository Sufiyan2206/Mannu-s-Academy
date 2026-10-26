-- Mannu’s Tuition Academy – core schema (Supabase / PostgreSQL 15+)
-- Apply with:  supabase db push   (or paste the files in order into the SQL editor)

-- ---------------------------------------------------------------- people & settings
create type public.app_role as enum ('admin', 'teacher');

create table public.profiles (
  id          uuid primary key references accounts.users (id) on delete cascade,
  full_name   text        not null default '',
  email       text        not null default '',
  role        public.app_role not null default 'teacher',
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- the very first account becomes the administrator; everyone else is a teacher until an admin changes it
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.email, ''),
    case when exists (select 1 from public.profiles) then 'teacher'::public.app_role else 'admin'::public.app_role end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on accounts.users
  for each row execute function public.handle_new_user();

create table public.settings (
  id                int primary key default 1 check (id = 1),
  academy           text    not null default 'Mannu’s Tuition Academy',
  tz                text    not null default 'Asia/Dubai',
  currency          text    not null default 'AED' check (currency ~ '^[A-Z]{3}$'),
  currencies        text[]  not null default '{AED}',
  min_pct           int     not null default 50  check (min_pct between 1 and 100),
  late_after        int     not null default 10  check (late_after between 0 and 120),
  classes_per_month int     not null default 12  check (classes_per_month between 1 and 40),
  monthly_fee       numeric(12, 2) not null default 250 check (monthly_fee >= 0),
  due_day           int     not null default 10  check (due_day between 1 and 28),
  cc                text    not null default '',
  contact           text    not null default '',
  -- Instagram / video pipeline
  ig_handle         text    not null default '',
  publish_mode      text    not null default 'auto' check (publish_mode in ('auto', 'approval', 'off')),
  yt_privacy        text    not null default 'unlisted' check (yt_privacy in ('private', 'unlisted', 'public')),
  reel_len_sec      int     not null default 60 check (reel_len_sec between 5 and 90),
  reel_start_sec    int     not null default 0  check (reel_start_sec >= 0),
  keep_original_days int    not null default 7  check (keep_original_days >= 0)
);
insert into public.settings (id) values (1);

-- ---------------------------------------------------------------- batches, students, classes
create table public.batches (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);
create unique index batches_name_ci on public.batches (lower(btrim(name)));

create table public.students (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text not null,
  zoom_email      text not null default '',
  mobile          text not null default '',
  guardian_name   text not null default '',
  guardian_mobile text not null default '',
  guardian_email  text not null default '',
  school          text not null default '' check (length(school) <= 120),
  batch_id        uuid not null references public.batches (id),
  currency        text not null default 'AED' check (currency ~ '^[A-Z]{3}$'),
  subjects        text[] not null default '{}' check (subjects <@ array['chem', 'phys', 'math']),
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create unique index students_active_email on public.students (lower(email)) where active;
create index students_batch on public.students (batch_id);

create table public.classes (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references public.batches (id),
  subject_id     text not null check (subject_id in ('chem', 'phys', 'math')),
  title          text not null,
  start_at       timestamptz not null,
  duration_min   int  not null check (duration_min between 15 and 480),
  teacher_name   text not null default '',
  teacher_phone  text not null default '',
  join_url       text not null check (join_url ~ '^https://'),
  agenda         text not null default '',
  status         text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  cancel_reason  text not null default '',
  created_by     text not null default '',
  created_at     timestamptz not null default now()
);
create index classes_start on public.classes (start_at);
create index classes_batch_subject on public.classes (batch_id, subject_id);

-- ---------------------------------------------------------------- attendance
create table public.attendance_class (          -- one row once attendance has been taken for a class
  class_id   uuid primary key references public.classes (id) on delete cascade,
  taken_at   timestamptz not null default now(),
  unmatched  jsonb       not null default '[]'  -- Zoom participants that could not be matched to a student
);

create table public.attendance (
  class_id     uuid not null references public.classes (id) on delete cascade,
  student_id   uuid not null references public.students (id) on delete cascade,
  status       text not null check (status in ('present', 'late', 'absent')),
  join_time    timestamptz,
  leave_time   timestamptz,
  duration_sec int,
  source       text not null check (source in ('manual', 'zoom')),
  note         text not null default '',
  created_by   text not null default '',
  created_at   timestamptz not null default now(),
  updated_by   text not null default '',
  updated_at   timestamptz not null default now(),
  primary key (class_id, student_id)
);
create index attendance_student on public.attendance (student_id);

create table public.attendance_zoom (           -- Zoom’s own record, kept beside what staff entered
  class_id     uuid not null references public.classes (id) on delete cascade,
  student_id   uuid not null references public.students (id) on delete cascade,
  status       text not null check (status in ('present', 'late', 'absent')),
  join_time    timestamptz,
  leave_time   timestamptz,
  duration_sec int,
  synced_at    timestamptz not null default now(),
  primary key (class_id, student_id)
);

create table public.attendance_audit (
  id         bigint generated always as identity primary key,
  class_id   uuid not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  old_value  jsonb,
  new_value  jsonb not null,
  reason     text  not null default '',
  by_name    text  not null default '',
  at         timestamptz not null default now()
);
create index attendance_audit_class on public.attendance_audit (class_id);

-- ---------------------------------------------------------------- fees (admin only)
create table public.fee_rates (
  id         uuid primary key default gen_random_uuid(),
  subject_id text not null check (subject_id in ('chem', 'phys', 'math')),
  batch_id   uuid references public.batches (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  currency   text not null check (currency ~ '^[A-Z]{3}$'),
  cents      bigint not null check (cents >= 0)
);
create unique index fee_rates_unique on public.fee_rates (
  subject_id, currency,
  coalesce(batch_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(student_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create table public.fee_charges (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  subject_id  text check (subject_id in ('chem', 'phys', 'math')),
  period      text check (period ~ '^\d{4}-\d{2}$'),
  description text not null,
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  cents       bigint not null check (cents > 0),
  due_date    date   not null,
  voided      boolean not null default false,
  created_at  timestamptz not null default now()
);
-- generating a month twice never duplicates a student’s subject fee
create unique index fee_charges_once on public.fee_charges (student_id, subject_id, period)
  where not voided and subject_id is not null and period is not null;
create index fee_charges_student on public.fee_charges (student_id);

create table public.receipt_counters (
  year int primary key,
  n    int not null default 0
);

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  receipt_no    text not null unique,
  student_id    uuid not null references public.students (id) on delete cascade,
  currency      text not null check (currency ~ '^[A-Z]{3}$'),   -- the student’s billing currency
  cents         bigint not null check (cents > 0),                -- credited, in the billing currency
  paid_currency text not null check (paid_currency ~ '^[A-Z]{3}$'),
  paid_cents    bigint not null check (paid_cents > 0),
  rate          numeric(18, 8) not null default 1 check (rate > 0),
  method        text not null check (method in ('cash', 'bank_transfer', 'online')),
  reference     text not null default '',
  note          text not null default '',
  paid_at       timestamptz not null,
  received_by   text not null default '',
  voided        boolean not null default false,
  void_reason   text not null default '',
  created_at    timestamptz not null default now()
);
create index payments_student on public.payments (student_id);
create index payments_paid_at on public.payments (paid_at);

create table public.parent_report_sends (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  subject_id text not null check (subject_id in ('chem', 'phys', 'math')),
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  channel    text not null check (channel in ('whatsapp', 'email')),
  to_address text not null,
  by_name    text not null default '',
  at         timestamptz not null default now(),
  hash       text not null default '',
  summary    jsonb not null default '{}'
);
create index parent_sends_lookup on public.parent_report_sends (student_id, subject_id, month);

-- ---------------------------------------------------------------- WhatsApp log
create table public.messages (
  id             uuid primary key default gen_random_uuid(),
  ts             timestamptz not null default now(),
  by_name        text not null default '',
  kind           text not null,
  student_id     uuid references public.students (id) on delete set null,
  class_id       uuid references public.classes (id) on delete set null,
  recipient_role text not null default '',
  recipient_name text not null default '',
  to_number      text not null default '',
  body           text not null default '',
  status         text not null default 'sent'
);
create index messages_ts on public.messages (ts desc);

-- ---------------------------------------------------------------- study resources
create table public.resources (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  subject_id   text not null check (subject_id in ('chem', 'phys', 'math')),
  type         text not null check (type in ('notes', 'worksheet', 'question_paper', 'model_paper', 'presentation', 'image', 'video', 'other')),
  exam_type    text not null default 'none' check (exam_type in ('none', 'class_test', 'term_exam', 'mock_exam', 'final_exam', 'assignment', 'revision')),
  batch_ids    uuid[] not null default '{}',
  url          text not null check (url ~* '^https://'),
  topic        text not null default '',
  date         date not null default current_date,
  description  text not null default '',
  instructions text not null default '',
  tags         text[] not null default '{}',
  class_id     uuid references public.classes (id) on delete set null,
  status       text not null default 'active' check (status in ('active', 'removed')),
  by_id        uuid references accounts.users (id) on delete set null,
  by_name      text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default ''
);
create table public.resource_history (
  id          bigint generated always as identity primary key,
  resource_id uuid not null references public.resources (id) on delete cascade,
  action      text not null,
  by_name     text not null default '',
  at          timestamptz not null default now(),
  changes     jsonb,
  note        text not null default ''
);
create index resource_history_res on public.resource_history (resource_id);

-- ---------------------------------------------------------------- Instagram Reels
create table public.reels (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  subject_id   text not null check (subject_id in ('chem', 'phys', 'math')),
  batch_id     uuid not null references public.batches (id),
  topic        text not null default '',
  teacher_name text not null default '',
  clip_url     text not null default '' ,
  clip_path    text,                                   -- set when the clip lives in Supabase Storage (bucket "clips")
  clip_len     numeric,
  yt_url       text not null default '',
  yt_start     int  not null default 0,
  caption      text not null default '',
  appears      text check (appears in ('none', 'students')),
  appearing    uuid[] not null default '{}',
  rev          int  not null default 1,
  submitted    boolean not null default false,
  submitted_at timestamptz,
  discarded    boolean not null default false,
  recording_id uuid,
  by_id        uuid references accounts.users (id) on delete set null,
  by_name      text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.reel_decisions (               -- only admins (and the pipeline) write here
  reel_id      uuid primary key references public.reels (id) on delete cascade,
  state        text not null check (state in ('approved', 'rejected', 'published', 'failed', 'deleted')),
  rev          int,
  scheduled_at timestamptz,
  note         text not null default '',
  error        text not null default '',
  prev         text not null default '',
  ig_url       text not null default '',
  ig_media_id  text,
  published_at timestamptz,
  appears      text,
  metrics      jsonb,
  by_name      text not null default '',
  at           timestamptz not null default now()
);

create table public.reel_history (
  id      bigint generated always as identity primary key,
  reel_id uuid not null references public.reels (id) on delete cascade,
  scope   text not null default 'draft' check (scope in ('draft', 'decision')),
  action  text not null,
  by_name text not null default '',
  at      timestamptz not null default now(),
  note    text not null default ''
);
create index reel_history_reel on public.reel_history (reel_id);

create table public.consent (
  student_id uuid primary key references public.students (id) on delete cascade,
  status     text not null check (status in ('granted', 'denied', 'unknown')),
  note       text not null default '',
  by_name    text not null default '',
  at         timestamptz not null default now()
);
create table public.consent_log (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.students (id) on delete cascade,
  name       text not null,
  status     text not null,
  note       text not null default '',
  by_name    text not null default '',
  at         timestamptz not null default now()
);

-- ---------------------------------------------------------------- recording -> YouTube -> 60 s clip -> Instagram pipeline
create table public.recordings (
  id               uuid primary key default gen_random_uuid(),
  class_id         uuid references public.classes (id) on delete set null,
  title            text not null,
  subject_id       text not null check (subject_id in ('chem', 'phys', 'math')),
  batch_id         uuid not null references public.batches (id),
  topic            text not null default '',
  teacher_name     text not null default '',
  -- where the full recording comes from: our storage bucket, or a Zoom cloud recording
  source_path      text,
  source_url       text,
  source_kind      text not null default 'upload' check (source_kind in ('upload', 'zoom')),
  source_size      bigint,
  source_mime      text not null default 'video/mp4',
  appears          text check (appears in ('none', 'students')),
  appearing        uuid[] not null default '{}',
  trim_start_sec   int not null default 0 check (trim_start_sec >= 0),
  trim_len_sec     int not null default 60 check (trim_len_sec between 5 and 90),
  publish_mode     text not null default 'auto' check (publish_mode in ('auto', 'approval', 'off')),
  yt_privacy       text not null default 'unlisted' check (yt_privacy in ('private', 'unlisted', 'public')),
  stage            text not null default 'uploading'
                   check (stage in ('uploading', 'queued', 'youtube', 'trim', 'instagram', 'completed', 'held', 'failed', 'cancelled')),
  yt_session_uri   text,
  yt_offset        bigint not null default 0,
  yt_video_id      text,
  yt_url           text not null default '',
  clip_path        text,
  reel_id          uuid references public.reels (id) on delete set null,
  ig_container_id  text,
  ig_media_id      text,
  ig_url           text not null default '',
  hold_released    boolean not null default false,
  attempts         int  not null default 0,
  last_error       text not null default '',
  next_attempt_at  timestamptz not null default now(),
  locked_until     timestamptz,
  steps            jsonb not null default '[]',
  original_deleted boolean not null default false,
  by_id            uuid references accounts.users (id) on delete set null,
  by_name          text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index recordings_stage on public.recordings (stage, next_attempt_at);
alter table public.reels add constraint reels_recording_fk foreign key (recording_id) references public.recordings (id) on delete set null;

-- OAuth tokens and other secrets for YouTube / Instagram. No policy => only the service role can touch it.
create table public.integrations (
  key        text primary key,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
