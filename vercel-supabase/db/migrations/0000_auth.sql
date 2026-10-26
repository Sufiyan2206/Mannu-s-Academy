-- Accounts and database roles for a plain PostgreSQL server (no Supabase).
-- The app connects as the database owner and, for every request made by a signed-in person, switches to the
-- "authenticated" role for that one transaction and records who they are in request.jwt.claim.sub.
-- The row level security policies in 0002 then decide what that person may read or change.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

create schema if not exists auth;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  password_hash      text not null,
  raw_user_meta_data jsonb not null default '{}',
  banned             boolean not null default false,
  created_at         timestamptz not null default now()
);
create unique index auth_users_email on auth.users (lower(email));

-- who is making this request (set per transaction by the app)
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- the password hashes are never readable by the signed-in role: no grant on auth.users

alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
