-- MABusy[ex]Students_life — schema
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- The core rule: nobody (admin included) can read other people's content
-- before calls.reveal_at. This is enforced here, by the database, not by the site.

-- ── Members (allowlist) ─────────────────────────────────────────────────────
create table if not exists public.members (
  email    text primary key,
  name     text not null,
  is_admin boolean not null default false,
  sort     int not null default 0
);

create or replace function public.my_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where lower(email) = public.my_email())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where lower(email) = public.my_email() and is_admin)
$$;

-- ── Calls ───────────────────────────────────────────────────────────────────
create table if not exists public.calls (
  id         bigint generated always as identity primary key,
  number     int not null unique,
  title      text not null default '',
  questions  jsonb not null default '[]',   -- [{ "id": "q1", "text": "…" }]
  is_open    boolean not null default false, -- admin opens/closes uploads
  reveal_at  timestamptz not null,           -- everything unlocks at this moment
  created_at timestamptz not null default now()
);

create or replace function public.call_revealed(cid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from calls where id = cid and reveal_at <= now())
$$;

create or replace function public.call_accepting(cid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from calls where id = cid and is_open and reveal_at > now())
$$;

-- ── Submissions: one per person per call ───────────────────────────────────
create table if not exists public.submissions (
  call_id      bigint not null references public.calls on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  author_email text not null default public.my_email(),
  selfie       jsonb,                        -- { path, thumb, w, h }
  answers      jsonb not null default '{}',  -- { "q1": "…" }
  body         text not null default '',     -- free text
  links        jsonb not null default '[]',  -- [{ url, label }]
  updated_at   timestamptz not null default now(),
  primary key (call_id, user_id)
);

-- ── Photos ──────────────────────────────────────────────────────────────────
create table if not exists public.photos (
  id           uuid primary key default gen_random_uuid(),
  call_id      bigint not null references public.calls on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  author_email text not null default public.my_email(),
  path         text not null,
  thumb        text not null,
  w            int,
  h            int,
  caption      text not null default '',
  position     int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists photos_call_idx on public.photos (call_id);

-- ── Row level security ─────────────────────────────────────────────────────
alter table public.members     enable row level security;
alter table public.calls       enable row level security;
alter table public.submissions enable row level security;
alter table public.photos      enable row level security;

drop policy if exists members_read on public.members;
create policy members_read on public.members for select using (public.is_member());

drop policy if exists calls_read  on public.calls;
drop policy if exists calls_admin on public.calls;
create policy calls_read  on public.calls for select using (public.is_member());
create policy calls_admin on public.calls for all
  using (public.is_admin()) with check (public.is_admin());

-- Submissions & photos: your own always; everyone else's only after reveal.
-- Writes only while the call is open and not yet revealed.
do $$
declare t text;
begin
  foreach t in array array['submissions', 'photos'] loop
    execute format('drop policy if exists %1$s_read   on public.%1$s', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format($p$create policy %1$s_read on public.%1$s for select using (
      public.is_member() and (user_id = auth.uid() or public.call_revealed(call_id)))$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$s for insert with check (
      public.is_member() and user_id = auth.uid() and author_email = public.my_email()
      and public.call_accepting(call_id))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$s for update
      using (user_id = auth.uid() and public.call_accepting(call_id))
      with check (user_id = auth.uid() and author_email = public.my_email()
      and public.call_accepting(call_id))$p$, t);
    execute format($p$create policy %1$s_delete on public.%1$s for delete using (
      user_id = auth.uid() and public.call_accepting(call_id))$p$, t);
  end loop;
end $$;

-- Who is ready (names only, no content) — usable before the reveal.
create or replace function public.call_progress(cid bigint)
returns table (name text, ready boolean, photos int)
language sql stable security definer set search_path = public as $$
  select m.name,
         s.user_id is not null,
         (select count(*)::int from photos p where p.call_id = cid and lower(p.author_email) = lower(m.email))
  from members m
  left join submissions s on s.call_id = cid and lower(s.author_email) = lower(m.email)
  where public.is_member()
  order by m.sort, m.name
$$;

-- ── Storage: private bucket, path = {call_id}/{user_id}/{file} ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 5242880, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.media_call_id(object_name text) returns bigint
language sql immutable as $$
  select case when split_part(object_name, '/', 1) ~ '^\d+$'
              then split_part(object_name, '/', 1)::bigint end
$$;

drop policy if exists media_read   on storage.objects;
drop policy if exists media_insert on storage.objects;
drop policy if exists media_delete on storage.objects;

create policy media_read on storage.objects for select using (
  bucket_id = 'media' and public.is_member() and (
    split_part(name, '/', 2) = auth.uid()::text
    or public.call_revealed(public.media_call_id(name))));

create policy media_insert on storage.objects for insert with check (
  bucket_id = 'media' and public.is_member()
  and split_part(name, '/', 2) = auth.uid()::text
  and public.call_accepting(public.media_call_id(name)));

create policy media_delete on storage.objects for delete using (
  bucket_id = 'media' and (
    (split_part(name, '/', 2) = auth.uid()::text and public.call_accepting(public.media_call_id(name)))
    or public.is_admin()));
