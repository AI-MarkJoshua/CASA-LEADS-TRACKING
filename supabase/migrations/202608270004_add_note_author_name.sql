-- Store the author's display name so note history can show who added each note.
alter table public.lead_notes
add column if not exists created_by_name text;

update public.lead_notes
set created_by_name = coalesce(nullif(trim(profiles.full_name), ''), 'Unknown user')
from public.profiles
where profiles.id = lead_notes.created_by
  and nullif(trim(lead_notes.created_by_name), '') is null;

create or replace function public.set_lead_note_author_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(nullif(trim(profiles.full_name), ''), 'Unknown user')
  into new.created_by_name
  from public.profiles
  where profiles.id = new.created_by;

  new.created_by_name := coalesce(new.created_by_name, 'Unknown user');
  return new;
end;
$$;

drop trigger if exists set_lead_note_author_name on public.lead_notes;
create trigger set_lead_note_author_name
before insert on public.lead_notes
for each row execute function public.set_lead_note_author_name();
