-- Support the complete lead follow-up workflow.
alter table public.leads
drop constraint if exists leads_status_check;

alter table public.leads
add constraint leads_status_check
check (status in ('new', 'qualified', 'unqualified', 'voicemail', 'contacted', 'call_no_answer'));
