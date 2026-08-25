-- Keep lead notes as a history instead of overwriting the previous note.
create table if not exists public.lead_notes (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  note text not null check (length(trim(note)) > 0),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.lead_notes enable row level security;
revoke all on public.lead_notes from anon;
grant select, insert on public.lead_notes to authenticated;

create policy "Users can view notes for accessible leads"
on public.lead_notes for select to authenticated
using (
  exists (
    select 1 from public.leads
    where leads.id = lead_notes.lead_id
      and (leads.owner_id = (select auth.uid()) or (select public.is_supervisor()))
  )
);

create policy "Users can add notes to accessible leads"
on public.lead_notes for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.leads
    where leads.id = lead_notes.lead_id
      and (leads.owner_id = (select auth.uid()) or (select public.is_supervisor()))
  )
);

insert into public.lead_notes (lead_id, note, created_by, created_at)
select leads.id, leads.note, leads.created_by, leads.created_at
from public.leads
where nullif(trim(leads.note), '') is not null
  and not exists (
    select 1 from public.lead_notes where lead_notes.lead_id = leads.id
  );
