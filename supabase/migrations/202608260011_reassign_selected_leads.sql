create or replace function public.reassign_selected_leads(lead_ids uuid[], target_owners uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved_count integer;
  valid_target_count integer;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisor access is required.';
  end if;
  if coalesce(cardinality(lead_ids), 0) = 0 or coalesce(cardinality(target_owners), 0) = 0 then
    raise exception 'At least one lead and one target owner are required.';
  end if;
  select count(*) into valid_target_count
  from public.profiles
  where id = any(target_owners) and role = 'sales' and is_active = true;
  if valid_target_count <> cardinality(target_owners) then
    raise exception 'Every target must be an active sales owner.';
  end if;

  with ranked as (
    select id, row_number() over (order by created_at, id) as row_number
    from public.leads where id = any(lead_ids)
  )
  update public.leads as leads
  set owner_id = target_owners[((ranked.row_number - 1) % cardinality(target_owners) + 1)::integer]
  from ranked where leads.id = ranked.id;
  get diagnostics moved_count = row_count;
  return moved_count;
end;
$$;

revoke all on function public.reassign_selected_leads(uuid[], uuid[]) from public;
grant execute on function public.reassign_selected_leads(uuid[], uuid[]) to authenticated;
