-- MABusy[ex]Students_life — call notes: summary + transcript for each call.
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- Any member can read and edit them, but only once the call is unlocked
-- (same time-lock rule as everything else).

create table if not exists public.call_notes (
  call_id      bigint primary key references public.calls on delete cascade,
  summary      text not null default '',
  transcript   text not null default '',
  updated_by   text not null default public.my_email(),
  updated_at   timestamptz not null default now()
);

alter table public.call_notes enable row level security;

drop policy if exists notes_read   on public.call_notes;
drop policy if exists notes_insert on public.call_notes;
drop policy if exists notes_update on public.call_notes;
create policy notes_read   on public.call_notes for select
  using (public.is_member() and public.call_revealed(call_id));
create policy notes_insert on public.call_notes for insert
  with check (public.is_member() and public.call_revealed(call_id));
create policy notes_update on public.call_notes for update
  using (public.is_member() and public.call_revealed(call_id))
  with check (public.is_member() and public.call_revealed(call_id));
-- No delete policy: clearing the fields is enough; rows go away with their call.

-- Who edited last is always the person logged in, not what the browser sends.
create or replace function public.call_notes_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_by := public.my_email();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists call_notes_stamp on public.call_notes;
create trigger call_notes_stamp before insert or update on public.call_notes
  for each row execute function public.call_notes_stamp();

grant select, insert, update on public.call_notes to authenticated;
