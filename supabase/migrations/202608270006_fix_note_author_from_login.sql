-- Capture the note author's email directly from the authenticated login session.
alter table public.lead_notes
add column if not exists created_by_name text;

create or replace function public.set_lead_note_author_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Prefer server-side Auth data and use the session value sent by the app only as a fallback.
  new.created_by := auth.uid();
  new.created_by_name := coalesce(
    (select nullif(trim(auth_users.email), '')
     from auth.users as auth_users
     where auth_users.id = auth.uid()),
    nullif(trim(auth.jwt() ->> 'email'), ''),
    nullif(trim(new.created_by_name), ''),
    'Email unavailable'
  );
  return new;
end;
$$;

drop trigger if exists set_lead_note_author_name on public.lead_notes;
create trigger set_lead_note_author_name
before insert on public.lead_notes
for each row execute function public.set_lead_note_author_name();

-- Repair older fallback labels when their Auth user still exists.
update public.lead_notes
set created_by_name = auth_users.email
from auth.users as auth_users
where auth_users.id = lead_notes.created_by
  and lead_notes.created_by_name = 'Email unavailable'
  and nullif(trim(auth_users.email), '') is not null;
