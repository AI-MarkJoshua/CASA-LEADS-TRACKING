-- Track status changes and owner reassignments with the acting user's name.
create table if not exists public.lead_activity_history (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null check (event_type in ('status_change', 'reassignment')),
  old_status text,
  new_status text,
  old_owner_id uuid references public.profiles(id),
  new_owner_id uuid references public.profiles(id),
  old_owner_name text,
  new_owner_name text,
  changed_by uuid references auth.users(id),
  changed_by_name text not null default 'System user',
  changed_at timestamptz not null default now()
);

alter table public.lead_activity_history enable row level security;
revoke all on public.lead_activity_history from anon;
revoke insert, update, delete on public.lead_activity_history from authenticated;
grant select on public.lead_activity_history to authenticated;

create policy "Users can view activity for accessible leads"
on public.lead_activity_history for select to authenticated
using (
  exists (
    select 1 from public.leads
    where leads.id = lead_activity_history.lead_id
      and (leads.owner_id = (select auth.uid()) or (select public.is_supervisor()))
  )
);

create or replace function public.record_lead_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_name text;
  old_owner_name_value text;
  new_owner_name_value text;
begin
  select full_name into actor_name from public.profiles where id = auth.uid();
  actor_name := coalesce(nullif(actor_name, ''), 'System user');

  if old.status is distinct from new.status then
    insert into public.lead_activity_history
      (lead_id, event_type, old_status, new_status, changed_by, changed_by_name, changed_at)
    values
      (new.id, 'status_change', old.status, new.status, auth.uid(), actor_name, now());
  end if;

  if old.owner_id is distinct from new.owner_id then
    select full_name into old_owner_name_value from public.profiles where id = old.owner_id;
    select full_name into new_owner_name_value from public.profiles where id = new.owner_id;
    insert into public.lead_activity_history
      (lead_id, event_type, old_owner_id, new_owner_id, old_owner_name, new_owner_name, changed_by, changed_by_name, changed_at)
    values
      (new.id, 'reassignment', old.owner_id, new.owner_id, old_owner_name_value, new_owner_name_value, auth.uid(), actor_name, now());
  end if;
  return new;
end;
$$;

drop trigger if exists record_lead_activity on public.leads;
create trigger record_lead_activity
after update of status, owner_id on public.leads
for each row execute procedure public.record_lead_activity();

insert into public.lead_activity_history
  (lead_id, event_type, old_status, new_status, changed_by, changed_by_name, changed_at)
select
  history.lead_id,
  'status_change',
  history.old_status,
  history.new_status,
  history.changed_by,
  coalesce(nullif(profiles.full_name, ''), 'System user'),
  history.changed_at
from public.lead_status_history as history
left join public.profiles as profiles on profiles.id = history.changed_by
where not exists (
  select 1 from public.lead_activity_history as activity
  where activity.lead_id = history.lead_id
    and activity.event_type = 'status_change'
    and activity.changed_at = history.changed_at
);
