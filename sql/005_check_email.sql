-- Lets the login page check an address against the members list before sending
-- a login email (answers only yes/no). Run once in the SQL Editor.
create or replace function public.is_allowed_email(addr text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where lower(email) = lower(trim(addr)))
$$;
grant execute on function public.is_allowed_email(text) to anon, authenticated;
