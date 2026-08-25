-- New is an initial-only status and cannot be restored after work begins.
create or replace function public.prevent_lead_status_reset_to_new()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'new' and new.status = 'new' then
    raise exception 'A lead cannot be changed back to New after activity has started.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_lead_status_reset_to_new on public.leads;
create trigger prevent_lead_status_reset_to_new
before update of status on public.leads
for each row execute procedure public.prevent_lead_status_reset_to_new();
