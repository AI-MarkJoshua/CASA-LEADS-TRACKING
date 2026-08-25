-- New leads with no recorded status change have no activity.
update public.leads
set status_updated_at = null
where status = 'new'
  and not exists (
    select 1
    from public.lead_status_history
    where lead_status_history.lead_id = leads.id
  );
