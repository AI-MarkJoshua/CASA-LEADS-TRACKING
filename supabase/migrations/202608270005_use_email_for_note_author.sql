-- Use the author's account email as the traceable note-author label.
-- The existing column name is retained to avoid breaking deployed clients.
alter table public.lead_notes
add column if not exists created_by_name text;

update public.lead_notes
set created_by_name = auth_users.email
from auth.users as auth_users
where auth_users.id = lead_notes.created_by
  and nullif(trim(auth_users.email), '') is not null;

create or replace function public.set_lead_note_author_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select nullif(trim(auth_users.email), '')
  into new.created_by_name
  from auth.users as auth_users
  where auth_users.id = new.created_by;

  new.created_by_name := coalesce(new.created_by_name, 'Email unavailable');
  return new;
end;
$$;

drop trigger if exists set_lead_note_author_name on public.lead_notes;
create trigger set_lead_note_author_name
before insert on public.lead_notes
for each row execute function public.set_lead_note_author_name();
