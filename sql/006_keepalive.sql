-- Keep the free project awake: a tiny daily write instead of a read.
-- (Read-only pings every 3 days were not enough: the project was paused anyway.)
-- Run once in the SQL Editor.
create table if not exists public.heartbeat (
  id int primary key default 1 check (id = 1),
  at timestamptz not null default now()
);
alter table public.heartbeat enable row level security;  -- no policies: only the function below touches it

create or replace function public.keepalive() returns timestamptz
language sql volatile security definer set search_path = public as $$
  insert into heartbeat (id, at) values (1, now())
  on conflict (id) do update set at = excluded.at
  returning at
$$;
grant execute on function public.keepalive() to anon, authenticated;
