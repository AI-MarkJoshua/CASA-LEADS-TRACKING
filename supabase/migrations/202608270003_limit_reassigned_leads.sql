-- Allow supervisors to choose how many matching leads to move.
drop function if exists public.reassign_sales_leads(uuid, uuid[], text);

create function public.reassign_sales_leads(source_owner uuid, target_owners uuid[], source_status text, move_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved_count integer;
  valid_target_count integer;
begin
  if not public.is_supervisor() then raise exception 'Supervisor access is required.'; end if;
  if source_owner is null or coalesce(cardinality(target_owners), 0) = 0 then
    raise exception 'A source owner and at least one target owner are required.';
  end if;
  if source_owner = any(target_owners) then raise exception 'The source owner cannot also be a target owner.'; end if;
  if move_limit is null or move_limit < 1 then raise exception 'The number of leads to move must be positive.'; end if;
  if source_status is not null and source_status not in
    ('new', 'qualified', 'unqualified', 'voicemail', 'contacted', 'call_no_answer') then
    raise exception 'Invalid lead status.';
  end if;
  select count(*) into valid_target_count from public.profiles
  where id = any(target_owners) and role = 'sales' and is_active = true;
  if valid_target_count <> cardinality(target_owners) then raise exception 'Every target must be an active sales owner.'; end if;

  with ranked as (
    select id, row_number() over (order by created_at, id) as row_number
    from public.leads
    where owner_id = source_owner and (source_status is null or status = source_status)
    order by created_at, id
    limit move_limit
  )
  update public.leads as leads
  set owner_id = target_owners[((ranked.row_number - 1) % cardinality(target_owners) + 1)::integer]
  from ranked where leads.id = ranked.id;
  get diagnostics moved_count = row_count;
  return moved_count;
end;
$$;

revoke all on function public.reassign_sales_leads(uuid, uuid[], text, integer) from public;
grant execute on function public.reassign_sales_leads(uuid, uuid[], text, integer) to authenticated;
