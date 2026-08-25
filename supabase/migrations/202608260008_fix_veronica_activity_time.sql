-- Correct the imported activity time for this contacted lead.
update public.leads
set status_updated_at = '2026-08-26 04:28:00+08'::timestamptz
where lower(trim(lead_name)) = lower('Veronica Riccasola')
  and status = 'contacted'
  and status_updated_at >= '2026-08-26 00:00:00+08'::timestamptz
  and status_updated_at < '2026-08-27 00:00:00+08'::timestamptz;
