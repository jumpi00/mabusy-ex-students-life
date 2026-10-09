-- Typed questions (text / photo / link, required or optional) + explicit Submit.
-- Run once in the SQL Editor (after 001–003).
--
-- calls.questions items now look like:
--   { "id": "selfie", "text": "Selfie", "type": "photo", "required": true, "multiple": false }

-- Photos belong to a photo question ("selfie" for the selfie).
alter table public.photos add column if not exists question_id text not null default '';

-- Set when the person presses Submit; cleared if they later remove a required answer.
alter table public.submissions add column if not exists submitted_at timestamptz;

drop function if exists public.call_progress(bigint);
create function public.call_progress(cid bigint)
returns table (name text, started boolean, ready boolean)
language sql stable security definer set search_path = public as $$
  select m.name,
         s.user_id is not null
           or exists (select 1 from photos p where p.call_id = cid and lower(p.author_email) = lower(m.email)),
         coalesce(s.submitted_at is not null, false)
  from members m
  left join submissions s on s.call_id = cid and lower(s.author_email) = lower(m.email)
  where public.is_member()
  order by m.sort, m.name
$$;
