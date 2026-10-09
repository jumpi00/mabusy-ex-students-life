-- Selfie + at least one photo are required to count as "ready".
-- Adds an optional monthly theme for the photo. Run once in the SQL Editor.

alter table public.calls add column if not exists photo_prompt text not null default '';

drop function if exists public.call_progress(bigint);
create function public.call_progress(cid bigint)
returns table (name text, has_selfie boolean, photos int, ready boolean)
language sql stable security definer set search_path = public as $$
  select x.name, x.has_selfie, x.photos, x.has_selfie and x.photos > 0
  from (
    select m.name, m.sort,
           coalesce(s.selfie ? 'path', false) as has_selfie,
           (select count(*)::int from photos p
             where p.call_id = cid and lower(p.author_email) = lower(m.email)) as photos
    from members m
    left join submissions s on s.call_id = cid and lower(s.author_email) = lower(m.email)
    where public.is_member()
  ) x
  order by x.sort, x.name
$$;
