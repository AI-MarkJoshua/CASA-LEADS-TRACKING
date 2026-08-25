-- A newly imported lead has no activity until its status is changed.
alter table public.leads
  alter column status_updated_at drop not null,
  alter column status_updated_at drop default;

update public.leads
set status_updated_at = null
where status = 'new'
  and not exists (
    select 1
    from public.lead_status_history
    where lead_status_history.lead_id = leads.id
  );
