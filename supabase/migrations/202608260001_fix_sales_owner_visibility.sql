-- Ensure every Auth account has a profile and supervisors can list active sales owners.
insert into public.profiles (id, full_name, role, is_active)
select
  users.id,
  coalesce(users.raw_user_meta_data ->> 'full_name', users.email, ''),
  case
    when users.raw_user_meta_data ->> 'role' in ('supervisor', 'sales')
      then users.raw_user_meta_data ->> 'role'
    else 'sales'
  end,
  true
from auth.users as users
on conflict (id) do update
set
  full_name = case
    when public.profiles.full_name = '' then excluded.full_name
    else public.profiles.full_name
  end;

create or replace function public.is_supervisor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'supervisor'
      and is_active = true
  );
$$;

revoke all on function public.is_supervisor() from public;
grant execute on function public.is_supervisor() to authenticated;
grant select on public.profiles to authenticated;

drop policy if exists "Supervisors can view profiles" on public.profiles;
create policy "Supervisors can view profiles"
on public.profiles
for select
to authenticated
using ((select public.is_supervisor()));
