-- Supervisors can move all leads from one sales owner to one or more sales owners.
create or replace function public.reassign_sales_leads(source_owner uuid, target_owners uuid[])
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
  if source_owner is null or coalesce(cardinality(target_owners), 0) = 0 then
    raise exception 'A source owner and at least one target owner are required.';
  end if;
  if source_owner = any(target_owners) then
    raise exception 'The source owner cannot also be a target owner.';
  end if;

  select count(*) into valid_target_count
  from public.profiles
  where id = any(target_owners) and role = 'sales' and is_active = true;
  if valid_target_count <> cardinality(target_owners) then
    raise exception 'Every target must be an active sales owner.';
  end if;

  with ranked as (
    select id, row_number() over (order by created_at, id) as row_number
    from public.leads
    where owner_id = source_owner
  )
  update public.leads as leads
  set owner_id = target_owners[((ranked.row_number - 1) % cardinality(target_owners) + 1)::integer]
  from ranked
  where leads.id = ranked.id;

  get diagnostics moved_count = row_count;
  return moved_count;
end;
$$;

revoke all on function public.reassign_sales_leads(uuid, uuid[]) from public;
grant execute on function public.reassign_sales_leads(uuid, uuid[]) to authenticated;
