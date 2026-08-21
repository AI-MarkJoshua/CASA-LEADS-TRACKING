-- Run in Supabase SQL Editor to enable lead import, assignment, and status tracking.
create or replace function public.is_supervisor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'supervisor' and is_active = true
  );
$$;

grant execute on function public.is_supervisor() to authenticated;

drop policy if exists "Supervisors can view profiles" on public.profiles;
create policy "Supervisors can view profiles"
on public.profiles for select to authenticated
using ((select public.is_supervisor()));

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_name text not null,
  interest text,
  email text not null,
  phone text,
  timezone text not null default 'Unknown',
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'unqualified')),
  status_updated_at timestamptz not null default now(),
  owner_id uuid not null constraint leads_owner_id_fkey references public.profiles(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.leads enable row level security;
revoke all on public.leads from anon;
revoke update, delete on public.leads from authenticated;
grant select, insert on public.leads to authenticated;
grant update (status, status_updated_at) on public.leads to authenticated;

create policy "Supervisors can view all leads"
on public.leads for select to authenticated
using ((select public.is_supervisor()));

create policy "Sales can view assigned leads"
on public.leads for select to authenticated
using (owner_id = (select auth.uid()));

create policy "Supervisors can import leads"
on public.leads for insert to authenticated
with check ((select public.is_supervisor()));

create policy "Owners and supervisors can update lead status"
on public.leads for update to authenticated
using (owner_id = (select auth.uid()) or (select public.is_supervisor()))
with check (owner_id = (select auth.uid()) or (select public.is_supervisor()));

create table if not exists public.lead_status_history (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

alter table public.lead_status_history enable row level security;
revoke all on public.lead_status_history from anon;
revoke insert, update, delete on public.lead_status_history from authenticated;
grant select on public.lead_status_history to authenticated;

create policy "Users can view history for accessible leads"
on public.lead_status_history for select to authenticated
using (exists (select 1 from public.leads where leads.id = lead_status_history.lead_id));

create or replace function public.record_lead_status_change()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    new.status_updated_at = now();
    insert into public.lead_status_history (lead_id, old_status, new_status, changed_by, changed_at)
    values (new.id, old.status, new.status, auth.uid(), new.status_updated_at);
  end if;
  return new;
end;
$$;

drop trigger if exists on_lead_status_changed on public.leads;
create trigger on_lead_status_changed
before update of status on public.leads
for each row execute procedure public.record_lead_status_change();
